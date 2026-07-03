/**
 * End-to-end reconciliation integration tests against a real Postgres.
 * Proves the guarantees the hackathon is judged on: balanced double-entry,
 * correct under/over/orphan classification, and — the headline demo —
 * a webhook replayed 5× credits the ledger exactly once.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, runMigrations, type DbHandle } from "@kobo/db";
import { customers, exceptions, invoices, ledgerEntries, payments, pendingRefunds, rawEvents } from "@kobo/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { processRawEvent } from "./reconcile-runner.js";

let container: StartedPostgreSqlContainer;
let handle: DbHandle;

const ACCOUNT_REF = "KOBO-TEST-CUSTOMER-0001";
const VA_NUMBER = "9900009999";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  await runMigrations(container.getConnectionUri());
  handle = createDb(container.getConnectionUri());
}, 120_000);

afterAll(async () => {
  await handle?.close();
  await container?.stop();
});

let customerId: string;

beforeEach(async () => {
  const { db } = handle;
  // Clean slate each test (ledger is append-only, so DELETE via TRUNCATE CASCADE).
  await db.execute(
    sql`TRUNCATE ledger_entries, exceptions, pending_refunds, payments, raw_events, invoices, virtual_accounts, customers RESTART IDENTITY CASCADE`,
  );
  const [c] = await db
    .insert(customers)
    .values({ accountRef: ACCOUNT_REF, name: "Test Customer", vertical: "rent" })
    .returning({ id: customers.id });
  customerId = c!.id;
  await db.insert(invoices).values({
    customerId,
    reference: "RENT-2026-07",
    amountExpected: 5_000_000n, // ₦50,000
  });
});

/** Insert a raw_event row (as the API webhook receiver would) and return its id. */
async function insertEvent(args: {
  sessionId: string;
  grossNaira: number;
  feeNaira?: number;
  accountRef?: string;
  storeSessionId?: boolean;
}): Promise<string> {
  const payload = {
    event_type: "payment_success",
    requestId: `req-${args.sessionId}`,
    data: {
      merchant: { userId: "u1", walletId: "w1" },
      transaction: {
        sessionId: args.sessionId,
        type: "vact_transfer",
        aliasAccountType: "VIRTUAL",
        aliasAccountNumber: VA_NUMBER,
        aliasAccountReference: args.accountRef ?? ACCOUNT_REF,
        transactionAmount: args.grossNaira,
        fee: args.feeNaira ?? 0,
        responseCode: "",
        time: "2026-06-24T10:00:00Z",
      },
      customer: { senderName: "JOHN DOE", bankName: "Opay", bankCode: "305", accountNumber: "0123456789" },
    },
  };
  const [row] = await handle.db
    .insert(rawEvents)
    .values({
      // storeSessionId=false lets us simulate a redelivery the API didn't dedupe.
      sessionId: args.storeSessionId === false ? null : args.sessionId,
      requestId: `req-${args.sessionId}`,
      eventType: "payment_success",
      payload,
      signatureValid: true,
    })
    .returning({ id: rawEvents.id });
  return row!.id;
}

async function ledgerBalances(): Promise<{ debits: bigint; credits: bigint }> {
  const rows = await handle.db
    .select({ direction: ledgerEntries.direction, total: sql<string>`sum(${ledgerEntries.amount})` })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.direction);
  const get = (d: string) => BigInt(rows.find((r) => r.direction === d)?.total ?? "0");
  return { debits: get("debit"), credits: get("credit") };
}

describe("exact payment", () => {
  it("settles the invoice with balanced postings", async () => {
    const id = await insertEvent({ sessionId: "S-EXACT", grossNaira: 50_000, feeNaira: 0.6 });
    const outcome = await processRawEvent(handle.db, id);

    expect(outcome.classification).toBe("exact");
    const [inv] = await handle.db.select().from(invoices).where(eq(invoices.customerId, customerId));
    expect(inv!.status).toBe("settled");
    expect(inv!.amountSettled).toBe(5_000_000n);

    const { debits, credits } = await ledgerBalances();
    expect(debits).toBe(credits);
    expect(credits).toBe(5_000_000n); // gross flows through credits
  });
});

describe("underpayment", () => {
  it("partially pays and keeps the invoice open", async () => {
    const id = await insertEvent({ sessionId: "S-UNDER", grossNaira: 45_000 });
    const outcome = await processRawEvent(handle.db, id);
    expect(outcome.classification).toBe("underpayment");
    const [inv] = await handle.db.select().from(invoices).where(eq(invoices.customerId, customerId));
    expect(inv!.status).toBe("partially_paid");
    expect(inv!.amountSettled).toBe(4_500_000n);
    const { debits, credits } = await ledgerBalances();
    expect(debits).toBe(credits);
  });
});

describe("overpayment", () => {
  it("settles, books surplus as credit, and queues a pending refund", async () => {
    const id = await insertEvent({ sessionId: "S-OVER", grossNaira: 60_000 });
    const outcome = await processRawEvent(handle.db, id);
    expect(outcome.classification).toBe("overpayment");

    const [inv] = await handle.db.select().from(invoices).where(eq(invoices.customerId, customerId));
    expect(inv!.status).toBe("settled");

    const refunds = await handle.db.select().from(pendingRefunds);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.amount).toBe(1_000_000n); // ₦10,000 surplus
    expect(refunds[0]!.status).toBe("pending_approval");
    expect(refunds[0]!.merchantTxRef).toBe("REFUND-S-OVER");

    const { debits, credits } = await ledgerBalances();
    expect(debits).toBe(credits);
  });
});

describe("orphan", () => {
  it("parks unknown money in suspense and opens an exception", async () => {
    const id = await insertEvent({ sessionId: "S-ORPHAN", grossNaira: 1_000, accountRef: "UNKNOWN-REF-XXXXXXXXX" });
    const outcome = await processRawEvent(handle.db, id);
    expect(outcome.classification).toBe("orphan");
    expect(outcome.status).toBe("exception");

    const exc = await handle.db.select().from(exceptions);
    expect(exc).toHaveLength(1);
    expect(exc[0]!.reason).toBe("orphan");
    expect(exc[0]!.materiality).toBe(100_000n); // ₦1,000

    const { debits, credits } = await ledgerBalances();
    expect(debits).toBe(credits);
  });
});

describe("idempotency — replay credits once", () => {
  it("processing the same raw event 5× yields one payment and one set of postings", async () => {
    const id = await insertEvent({ sessionId: "S-REPLAY", grossNaira: 50_000, feeNaira: 0.6 });
    const outcomes = [];
    for (let i = 0; i < 5; i++) outcomes.push(await processRawEvent(handle.db, id));

    expect(outcomes[0]!.status).toBe("reconciled");
    expect(outcomes.slice(1).every((o) => o.status === "skipped")).toBe(true);

    const pays = await handle.db.select().from(payments).where(eq(payments.sessionId, "S-REPLAY"));
    expect(pays).toHaveLength(1);
  });

  it("a redelivered webhook (new raw_event, same sessionId) hits the payment gate", async () => {
    const first = await insertEvent({ sessionId: "S-DUP", grossNaira: 50_000 });
    await processRawEvent(handle.db, first);

    // Second delivery the API failed to dedupe: distinct raw_event row, same sessionId in payload.
    const second = await insertEvent({ sessionId: "S-DUP", grossNaira: 50_000, storeSessionId: false });
    const outcome = await processRawEvent(handle.db, second);
    expect(outcome.status).toBe("duplicate");

    const pays = await handle.db.select().from(payments).where(eq(payments.sessionId, "S-DUP"));
    expect(pays).toHaveLength(1);

    const { debits, credits } = await ledgerBalances();
    expect(debits).toBe(credits);
  });
});

async function insertRaw(eventType: string, payload: object): Promise<string> {
  const [row] = await handle.db
    .insert(rawEvents)
    .values({ sessionId: null, eventType, payload, signatureValid: true })
    .returning({ id: rawEvents.id });
  return row!.id;
}

describe("payout webhook finalises the refund", () => {
  it("marks an approved refund sent on success and failed on refund", async () => {
    const [pay] = await handle.db
      .insert(payments)
      .values({
        sessionId: "S-PAYOUT",
        rawEventId: await insertRaw("seed", {}),
        customerId,
        grossAmount: 100000n,
        fee: 0n,
        netAmount: 100000n,
        classification: "overpayment",
        status: "reconciled",
      })
      .returning({ id: payments.id });
    await handle.db.insert(pendingRefunds).values({
      paymentId: pay!.id,
      customerId,
      amount: 100000n,
      merchantTxRef: "REFUND-PAYOUT",
      status: "approved",
    });

    const okId = await insertRaw("payout_success", {
      event_type: "payout_success",
      data: { transaction: { merchantTxRef: "REFUND-PAYOUT" } },
    });
    const out = await processRawEvent(handle.db, okId);
    expect(out.status).toBe("payout");
    let [r] = await handle.db.select().from(pendingRefunds).where(eq(pendingRefunds.merchantTxRef, "REFUND-PAYOUT"));
    expect(r!.status).toBe("sent");

    // A subsequent payout_refund (auto-refund) flips it to failed.
    const failId = await insertRaw("payout_refund", {
      event_type: "payout_refund",
      data: { transaction: { merchantTxRef: "REFUND-PAYOUT" } },
    });
    await processRawEvent(handle.db, failId);
    [r] = await handle.db.select().from(pendingRefunds).where(eq(pendingRefunds.merchantTxRef, "REFUND-PAYOUT"));
    expect(r!.status).toBe("failed");
  });
});

describe("payment_reversal unwinds the credit", () => {
  it("posts contra entries, rolls back the invoice, and keeps the ledger balanced", async () => {
    const creditId = await insertEvent({ sessionId: "S-REV", grossNaira: 50_000, feeNaira: 0.6 });
    await processRawEvent(handle.db, creditId);
    const [settled] = await handle.db.select().from(invoices).where(eq(invoices.customerId, customerId));
    expect(settled!.status).toBe("settled");

    const reversalId = await insertRaw("payment_reversal", {
      event_type: "payment_reversal",
      data: { transaction: { sessionId: "S-REV" } },
    });
    const out = await processRawEvent(handle.db, reversalId);
    expect(out.status).toBe("reversed");

    const [pay] = await handle.db.select().from(payments).where(eq(payments.sessionId, "S-REV"));
    expect(pay!.status).toBe("refunded");
    const [inv] = await handle.db.select().from(invoices).where(eq(invoices.customerId, customerId));
    expect(inv!.status).toBe("open");
    expect(inv!.amountSettled).toBe(0n);

    // Original + contra postings still balance globally.
    const { debits, credits } = await ledgerBalances();
    expect(debits).toBe(credits);
  });
});

describe("waterfall across multiple invoices", () => {
  it("a lump sum settles the oldest in full and part-pays the next", async () => {
    // A second, newer invoice for the same customer (₦50,000).
    await handle.db.insert(invoices).values({
      customerId,
      reference: "RENT-2026-08",
      amountExpected: 5_000_000n,
      createdAt: new Date(Date.now() + 60_000),
    });

    // Parent sends ₦70,000 in one transfer.
    const id = await insertEvent({ sessionId: "S-WATERFALL", grossNaira: 70_000, feeNaira: 0 });
    const out = await processRawEvent(handle.db, id);
    expect(out.status).toBe("reconciled");

    const rows = await handle.db.select().from(invoices).orderBy(invoices.createdAt);
    expect(rows[0]!.reference).toBe("RENT-2026-07");
    expect(rows[0]!.status).toBe("settled");
    expect(rows[0]!.amountSettled).toBe(5_000_000n);
    expect(rows[1]!.reference).toBe("RENT-2026-08");
    expect(rows[1]!.status).toBe("partially_paid");
    expect(rows[1]!.amountSettled).toBe(2_000_000n); // remaining ₦20,000

    const { debits, credits } = await ledgerBalances();
    expect(debits).toBe(credits);
  });
});

describe("append-only ledger", () => {
  it("rejects any UPDATE to ledger_entries at the database level", async () => {
    const id = await insertEvent({ sessionId: "S-IMMUT", grossNaira: 50_000 });
    await processRawEvent(handle.db, id);
    await expect(
      handle.db.execute(sql`UPDATE ledger_entries SET amount = amount + 1`),
    ).rejects.toThrow(/append-only/);
  });
});
