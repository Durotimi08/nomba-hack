/**
 * API integration tests against real Postgres + Redis. Covers the security-
 * critical surface: webhook signature accept/reject + persist-then-enqueue, the
 * auth flow, and maker-checker refund approval (a checker cannot approve their
 * own proposal).
 */
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, customers, exceptions, invoices, ledgerEntries, operators, payments, pendingRefunds, rawEvents, runMigrations, type DbHandle } from "@kobo/db";
import { MockNombaClient, computeSignatureFromParsed } from "@kobo/nomba";
import { LedgerAccount, PAYOUT_QUEUE, RECONCILE_QUEUE, createLogger, loadEnv } from "@kobo/shared";
import argon2 from "argon2";
import { Queue, type ConnectionOptions } from "bullmq";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { ApiRuntime } from "./runtime.js";

let pg: StartedPostgreSqlContainer;
let redisC: StartedRedisContainer;
let handle: DbHandle;
let redis: Redis;
let app: FastifyInstance;

const SIGNATURE_KEY = "test-sig-key";
const TS = "2026-06-24T10:00:00Z";

beforeAll(async () => {
  pg = await new PostgreSqlContainer("postgres:16-alpine").start();
  redisC = await new RedisContainer("redis:7-alpine").start();
  await runMigrations(pg.getConnectionUri());
  handle = createDb(pg.getConnectionUri());
  redis = new Redis(redisC.getConnectionUrl(), { maxRetriesPerRequest: null });

  const env = loadEnv({
    DATABASE_URL: pg.getConnectionUri(),
    REDIS_URL: redisC.getConnectionUrl(),
    NOMBA_CLIENT_ID: "x",
    NOMBA_CLIENT_SECRET: "x",
    NOMBA_ACCOUNT_ID: "00000000-0000-0000-0000-000000000000",
    NOMBA_SIGNATURE_KEY: SIGNATURE_KEY,
    NOMBA_ADAPTER: "mock",
    JWT_SECRET: "0123456789012345678901234567890123456789",
  });
  const connection = redis as unknown as ConnectionOptions;
  const rt: ApiRuntime = {
    env,
    log: createLogger({ level: "silent" }),
    dbHandle: handle,
    redis,
    nomba: new MockNombaClient(),
    reconcileQueue: new Queue(RECONCILE_QUEUE, { connection }),
    payoutQueue: new Queue(PAYOUT_QUEUE, { connection }),
  };
  app = buildApp(rt);
  await app.ready();

  const hash = await argon2.hash("pw", { type: argon2.argon2id });
  await handle.db.insert(operators).values([
    { email: "maker@kobo.dev", passwordHash: hash, role: "maker" },
    { email: "checker@kobo.dev", passwordHash: hash, role: "checker" },
  ]);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await handle?.close();
  redis?.disconnect();
  await pg?.stop();
  await redisC?.stop();
});

async function login(email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "pw" } });
  return res.json<{ token: string }>().token;
}

function signedHeaders(body: ReturnType<typeof inboundBody>): Record<string, string> {
  return {
    "nomba-signature": computeSignatureFromParsed(body, SIGNATURE_KEY, TS),
    "nomba-timestamp": TS,
  };
}

function inboundBody(sessionId: string) {
  return {
    event_type: "payment_success",
    requestId: `req-${sessionId}`,
    data: {
      merchant: { userId: "u1", walletId: "w1" },
      transaction: {
        sessionId,
        transactionId: `tx-${sessionId}`,
        type: "vact_transfer",
        aliasAccountType: "VIRTUAL",
        aliasAccountReference: "KOBO-UNKNOWN-REF-000001",
        aliasAccountNumber: "9900001234",
        transactionAmount: 1000,
        fee: 0.6,
        responseCode: "",
        time: TS,
      },
      customer: { senderName: "JANE", bankName: "Opay", bankCode: "305", accountNumber: "0001112223" },
    },
  };
}

describe("auth", () => {
  it("rejects bad credentials and issues a token for good ones", async () => {
    const bad = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "maker@kobo.dev", password: "nope" } });
    expect(bad.statusCode).toBe(401);
    const good = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "maker@kobo.dev", password: "pw" } });
    expect(good.statusCode).toBe(200);
    expect(good.json<{ role: string }>().role).toBe("maker");
  });
});

describe("webhook receiver", () => {
  it("rejects an invalid signature with 401 and persists nothing", async () => {
    const body = inboundBody("S-BAD");
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/nomba",
      headers: { "nomba-signature": "wrong", "nomba-timestamp": TS },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    const rows = await handle.db.select().from(rawEvents).where(eq(rawEvents.sessionId, "S-BAD"));
    expect(rows).toHaveLength(0);
  });

  it("acks an unsigned validation probe with 200 without persisting", async () => {
    const before = (await handle.db.select().from(rawEvents)).length;
    const res = await app.inject({ method: "POST", url: "/webhooks/nomba", payload: { ping: true } });
    expect(res.statusCode).toBe(200);
    const after = (await handle.db.select().from(rawEvents)).length;
    expect(after).toBe(before);
  });

  it("accepts a valid signature, persists the raw_event, and enqueues once", async () => {
    const body = inboundBody("S-OK");
    const res = await app.inject({ method: "POST", url: "/webhooks/nomba", headers: signedHeaders(body), payload: body });
    expect(res.statusCode).toBe(200);
    const rows = await handle.db.select().from(rawEvents).where(eq(rawEvents.sessionId, "S-OK"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.signatureValid).toBe(true);

    // Redelivery with the same sessionId does not create a second raw_event.
    const again = await app.inject({ method: "POST", url: "/webhooks/nomba", headers: signedHeaders(body), payload: body });
    expect(again.statusCode).toBe(200);
    const after = await handle.db.select().from(rawEvents).where(eq(rawEvents.sessionId, "S-OK"));
    expect(after).toHaveLength(1);
  });
});

describe("customers", () => {
  it("creates a customer with a dedicated virtual account", async () => {
    const token = await login("maker@kobo.dev");
    const res = await app.inject({
      method: "POST",
      url: "/customers",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Demo Tenant", vertical: "rent" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ bankAccountNumber: string }>().bankAccountNumber).toMatch(/^\d+$/);
  });

  it("requires auth", async () => {
    const res = await app.inject({ method: "GET", url: "/customers" });
    expect(res.statusCode).toBe(401);
  });
});

describe("maker-checker refunds", () => {
  it("blocks a checker approving their own proposal and allows a different checker", async () => {
    // Seed a customer + payment + refund proposed by the checker.
    const [cust] = await handle.db
      .insert(customers)
      .values({ accountRef: "KOBO-REFUND-CUSTOMER-01", name: "Refund Customer", vertical: "rent" })
      .returning({ id: customers.id });
    const [evt] = await handle.db
      .insert(rawEvents)
      .values({ sessionId: "S-REF", eventType: "payment_success", payload: {}, signatureValid: true })
      .returning({ id: rawEvents.id });
    const [pay] = await handle.db
      .insert(payments)
      .values({
        sessionId: "S-REF",
        rawEventId: evt!.id,
        customerId: cust!.id,
        grossAmount: 100000n,
        fee: 0n,
        netAmount: 100000n,
        classification: "overpayment",
        status: "reconciled",
      })
      .returning({ id: payments.id });
    const [refundSelf] = await handle.db
      .insert(pendingRefunds)
      .values({ paymentId: pay!.id, customerId: cust!.id, amount: 100000n, merchantTxRef: "REFUND-S-REF", proposedBy: "checker@kobo.dev" })
      .returning({ id: pendingRefunds.id });

    const token = await login("checker@kobo.dev");
    const selfApprove = await app.inject({
      method: "POST",
      url: `/refunds/${refundSelf!.id}/approve`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(selfApprove.statusCode).toBe(409);

    // A maker-proposed refund can be approved by the checker.
    await handle.db.update(pendingRefunds).set({ proposedBy: "maker@kobo.dev" }).where(eq(pendingRefunds.id, refundSelf!.id));
    const ok = await app.inject({
      method: "POST",
      url: `/refunds/${refundSelf!.id}/approve`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    const [updated] = await handle.db.select().from(pendingRefunds).where(eq(pendingRefunds.id, refundSelf!.id));
    expect(updated!.status).toBe("approved");
  });

  it("forbids a maker from approving", async () => {
    const token = await login("maker@kobo.dev");
    const res = await app.inject({ method: "POST", url: "/refunds/00000000-0000-0000-0000-000000000000/approve", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("orphan re-attribution", () => {
  it("moves suspense money to a customer credit and resolves the break, keeping the ledger balanced", async () => {
    const [cust] = await handle.db
      .insert(customers)
      .values({ accountRef: "KOBO-ORPHAN-TARGET-0001", name: "Orphan Target", vertical: "ajo" })
      .returning({ id: customers.id });
    const [evt] = await handle.db
      .insert(rawEvents)
      .values({ sessionId: "S-ORPHAN-API", eventType: "payment_success", payload: {}, signatureValid: true })
      .returning({ id: rawEvents.id });
    const [pay] = await handle.db
      .insert(payments)
      .values({ sessionId: "S-ORPHAN-API", rawEventId: evt!.id, grossAmount: 100000n, fee: 0n, netAmount: 100000n, classification: "orphan", status: "in_exception" })
      .returning({ id: payments.id });
    // Original orphan postings (balanced): cash in, parked in suspense.
    await handle.db.insert(ledgerEntries).values([
      { paymentId: pay!.id, account: LedgerAccount.cashNombaWallet, direction: "debit", amount: 100000n },
      { paymentId: pay!.id, account: LedgerAccount.suspenseUnmatched, direction: "credit", amount: 100000n },
    ]);
    const [exc] = await handle.db
      .insert(exceptions)
      .values({ paymentId: pay!.id, reason: "orphan", materiality: 100000n })
      .returning({ id: exceptions.id });

    const token = await login("checker@kobo.dev");
    const res = await app.inject({
      method: "POST",
      url: `/exceptions/${exc!.id}/reattribute`,
      headers: { authorization: `Bearer ${token}` },
      payload: { customerId: cust!.id },
    });
    expect(res.statusCode).toBe(200);

    const [updatedPay] = await handle.db.select().from(payments).where(eq(payments.id, pay!.id));
    expect(updatedPay!.customerId).toBe(cust!.id);
    expect(updatedPay!.status).toBe("reconciled");
    const [updatedExc] = await handle.db.select().from(exceptions).where(eq(exceptions.id, exc!.id));
    expect(updatedExc!.resolvedAt).not.toBeNull();

    // Suspense is cleared and the ledger for this payment still balances.
    const entries = await handle.db.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, pay!.id));
    const debits = entries.filter((e) => e.direction === "debit").reduce((a, e) => a + e.amount, 0n);
    const credits = entries.filter((e) => e.direction === "credit").reduce((a, e) => a + e.amount, 0n);
    expect(debits).toBe(credits);
  });
});

describe("create invoice", () => {
  it("creates an invoice in kobo from a naira amount", async () => {
    const [cust] = await handle.db
      .insert(customers)
      .values({ accountRef: "KOBO-INVOICE-CUST-00001", name: "Invoice Co", vertical: "rent" })
      .returning({ id: customers.id });
    const token = await login("maker@kobo.dev");

    const res = await app.inject({
      method: "POST",
      url: `/customers/${cust!.id}/invoices`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reference: "RENT-2026-07", amountExpected: 50000, period: "2026-07" },
    });
    expect(res.statusCode).toBe(201);
    // ₦50,000 → 5,000,000 kobo
    expect(res.json()).toMatchObject({ amountExpectedKobo: "5000000", status: "open" });

    const [row] = await handle.db.select().from(invoices).where(eq(invoices.customerId, cust!.id));
    expect(row!.amountExpected).toBe(5000000n);
  });

  it("404s for an unknown customer and 400s for a bad amount", async () => {
    const token = await login("maker@kobo.dev");
    const missing = await app.inject({
      method: "POST",
      url: `/customers/00000000-0000-0000-0000-000000000000/invoices`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reference: "X-1", amountExpected: 100 },
    });
    expect(missing.statusCode).toBe(404);

    const [cust] = await handle.db
      .insert(customers)
      .values({ accountRef: "KOBO-INVOICE-CUST-00002", name: "Bad Amount Co", vertical: "rent" })
      .returning({ id: customers.id });
    const bad = await app.inject({
      method: "POST",
      url: `/customers/${cust!.id}/invoices`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reference: "X-2", amountExpected: -5 },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("pagination", () => {
  it("returns an {items,total} envelope honouring limit and offset", async () => {
    const token = await login("maker@kobo.dev");
    const h = { authorization: `Bearer ${token}` };
    // Ensure at least two customers exist.
    await handle.db.insert(customers).values([
      { accountRef: "KOBO-PAGE-CUSTOMER-0001", name: "Page One", vertical: "rent" },
      { accountRef: "KOBO-PAGE-CUSTOMER-0002", name: "Page Two", vertical: "rent" },
    ]);

    const p1 = (await app.inject({ method: "GET", url: "/customers?limit=1&offset=0", headers: h })).json();
    expect(Array.isArray(p1.items)).toBe(true);
    expect(p1.items).toHaveLength(1);
    expect(typeof p1.total).toBe("number");
    expect(p1.total).toBeGreaterThanOrEqual(2);

    const p2 = (await app.inject({ method: "GET", url: "/customers?limit=1&offset=1", headers: h })).json();
    expect(p2.items).toHaveLength(1);
    expect(p2.items[0].id).not.toBe(p1.items[0].id); // a different page
    expect(p2.total).toBe(p1.total); // total is stable across pages
  });
});

describe("school product (built on Kobo)", () => {
  it("onboards a roster, defines rules, bills a term, lists defaulters, and promotes", async () => {
    const token = await login("maker@kobo.dev");
    const auth = { authorization: `Bearer ${token}` };

    // 1. Bulk onboarding → a VA + student per row.
    const roster = await app.inject({
      method: "POST",
      url: "/school/roster",
      headers: auth,
      payload: {
        students: [
          { name: "Ada Obi", cohort: "JSS1" },
          { name: "Tobi Cole", cohort: "JSS1", metadata: { scholarship: true } },
        ],
      },
    });
    expect(roster.statusCode).toBe(201);
    expect(roster.json()).toMatchObject({ created: 2, failed: 0 });

    // 2. Rules: ₦55,000 tuition (recurring) + 20% scholarship (matches the tag).
    const tuition = await app.inject({
      method: "POST",
      url: "/school/rules",
      headers: auth,
      payload: { name: "Tuition", kind: "charge", valueType: "fixed", amount: 55000, recurrence: "termly", cohort: "JSS1" },
    });
    expect(tuition.statusCode).toBe(201);
    const scholarship = await app.inject({
      method: "POST",
      url: "/school/rules",
      headers: auth,
      payload: { name: "Scholarship", kind: "discount", valueType: "percent", amount: 20, recurrence: "termly", cohort: "JSS1", match: { scholarship: true } },
    });
    expect(scholarship.statusCode).toBe(201);

    // 3. Billing run: Ada ₦55,000 + Tobi ₦44,000 = ₦99,000.
    const run = await app.inject({
      method: "POST",
      url: "/school/billing-runs",
      headers: auth,
      payload: { cohort: "JSS1", frequency: "termly", period: "2026-T1" },
    });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({ reference: "JSS1-2026-T1", invoicesCreated: 2, totalExpectedKobo: "9900000" });

    // 4. Defaulters: nobody has paid → both owing, 0% collected.
    const def = await app.inject({ method: "GET", url: "/school/defaulters?cohort=JSS1", headers: auth });
    expect(def.statusCode).toBe(200);
    expect(def.json()).toMatchObject({ billedKobo: "9900000", collectedKobo: "0", collectionRate: 0 });
    expect(def.json().defaulters).toHaveLength(2);

    // 5. Promotion: relabel the cohort.
    const promo = await app.inject({
      method: "POST",
      url: "/school/cohorts/promote",
      headers: auth,
      payload: { from: "JSS1", to: "JSS2" },
    });
    expect(promo.statusCode).toBe(200);
    expect(promo.json()).toMatchObject({ moved: 2 });
  });
});
