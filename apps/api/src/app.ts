/**
 * Fastify application. Composes security middleware, auth, the webhook receiver,
 * and the reporting/operator REST surface. `buildApp` is pure wiring over an
 * injected runtime so it can be exercised in integration tests.
 *
 * Webhook contract (critical path): verify the `nomba-signature` → persist the
 * immutable raw_event → enqueue → return 200 FAST. Reconciliation never runs
 * inline (a slow ack triggers Nomba's retry storm).
 */
import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { customers, invoices, ledgerEntries, payments, rawEvents, virtualAccounts } from "@kobo/db";
import {
  LedgerAccount,
  VERTICALS,
  isInboundVirtualAccountCredit,
  nairaToKobo,
  WebhookEnvelopeSchema,
} from "@kobo/shared";
import { verifyWebhook } from "@kobo/nomba";
import { applyCustomerCredit } from "@kobo/school";
import { eq, sql } from "drizzle-orm";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";
import { verifyOperator, type OperatorClaims } from "./auth.js";
import {
  getBreakdown,
  getKpis,
  getStatement,
  getTimeseries,
  listCustomers,
  listOpenExceptions,
  listRefunds,
} from "./queries.js";
import type { ApiRuntime } from "./runtime.js";
import { registerSchoolRoutes } from "./school.js";
import { exceptions, pendingRefunds } from "@kobo/db";

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const CreateCustomerBody = z.object({
  name: z.string().min(2).max(64),
  vertical: z.enum(VERTICALS),
  accountRef: z.string().min(16).max(64).optional(),
});
const ReattributeBody = z.object({ customerId: z.string().uuid() });
const CreateInvoiceBody = z.object({
  reference: z.string().min(1).max(64),
  // Expected amount in NAIRA (major units); converted to integer kobo at the boundary.
  amountExpected: z.number().positive().finite(),
  period: z.string().max(32).optional(),
});

export function buildApp(rt: ApiRuntime): FastifyInstance {
  const { env, log, dbHandle, redis, nomba, reconcileQueue, payoutQueue } = rt;
  const db = dbHandle.db;

  const app = Fastify({
    loggerInstance: log as unknown as FastifyBaseLogger,
    bodyLimit: 1_048_576,
  });

  // Preserve the raw JSON bytes alongside the parsed body — the raw-body HMAC
  // signature scheme needs the exact bytes Nomba signed, not a re-serialisation.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as unknown as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body === "" ? {} : JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  void app.register(helmet);
  void app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  void app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  void app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: env.JWT_TTL } });

  // Auth guards.
  const authenticate = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await req.jwtVerify();
    } catch {
      await reply.code(401).send({ error: "unauthorized" });
    }
  };
  const requireRole =
    (role: OperatorClaims["role"]) =>
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await authenticate(req, reply);
      if (!reply.sent && req.user.role !== role) {
        await reply.code(403).send({ error: `requires ${role} role` });
      }
    };

  // Pagination: ?limit&offset → a clamped page (default 20, max 100).
  const parsePage = (req: FastifyRequest): { limit: number; offset: number } => {
    const q = req.query as { limit?: string; offset?: string };
    return {
      limit: Math.min(Math.max(Number(q.limit) || 20, 1), 100),
      offset: Math.max(Number(q.offset) || 0, 0),
    };
  };

  // ── Health ────────────────────────────────────────────────────────────────
  app.get("/health", () => ({ status: "ok" }));
  app.get("/ready", async (_req, reply) => {
    try {
      await db.execute(sql`SELECT 1`);
      if (redis.status !== "ready" && redis.status !== "connecting") throw new Error("redis down");
      return { status: "ready" };
    } catch (err) {
      return reply.code(503).send({ status: "not_ready", error: (err as Error).message });
    }
  });

  // ── Auth ────────────────────────────────────────────────────────────────
  app.post("/auth/login", async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const claims = await verifyOperator(db, parsed.data.email, parsed.data.password);
    if (!claims) return reply.code(401).send({ error: "invalid credentials" });
    const token = app.jwt.sign(claims);
    return { token, role: claims.role, email: claims.email };
  });

  // Events the worker acts on (beyond the inbound-credit core path). Includes the
  // training-material payout names (transfer.success/failed) as well as the API
  // reference names, so we react correctly whichever the live wire format uses.
  const ACTIONABLE = new Set([
    "payout_success",
    "payout_failed",
    "payout_refund",
    "payment_reversal",
    "transfer.success",
    "transfer.failed",
  ]);

  // ── Webhook receiver (the trigger) ────────────────────────────────────────
  // Exempt from the global rate limit: Nomba can burst, and 429s would trigger
  // its retry storm. Idempotency (sessionId) protects us instead.
  app.post("/webhooks/nomba", { config: { rateLimit: false } }, async (req, reply) => {
    const signature = req.headers["nomba-signature"] as string | undefined;
    // Nomba validates a new webhook URL with an UNSIGNED probe POST before
    // activating it (and health checkers may POST too). Ack those with 200 but
    // process nothing — a request with no signature can never reach the ledger.
    if (!signature) return reply.code(200).send({ received: true });

    const verdict = verifyWebhook({
      rawBody: (req as unknown as { rawBody?: string }).rawBody,
      parsedBody: req.body,
      signatureHeader: signature,
      nombaTimestamp: req.headers["nomba-timestamp"] as string | undefined,
      secret: env.NOMBA_SIGNATURE_KEY,
    });
    if (!verdict.valid) {
      log.warn("rejected webhook: signature present but invalid");
      return reply.code(401).send({ error: "invalid signature" });
    }
    log.debug({ scheme: verdict.scheme }, "webhook signature verified");

    const envelope = WebhookEnvelopeSchema.parse(req.body);
    const sessionId = envelope.data.transaction?.sessionId ?? null;

    // Persist-before-enqueue: the raw_event is the durable record. Redis is only
    // delivery; if it dies, the backfill/sweeper recovers from raw_events.
    const [inserted] = await db
      .insert(rawEvents)
      .values({
        sessionId,
        requestId: envelope.requestId ?? null,
        eventType: envelope.event_type,
        payload: req.body,
        signatureValid: true,
      })
      .onConflictDoNothing({ target: rawEvents.sessionId })
      .returning({ id: rawEvents.id });

    // Enqueue brand-new events the worker acts on (inbound credits, payouts,
    // reversals). Dedup is guaranteed by the unique sessionId + the job id.
    if (inserted && (isInboundVirtualAccountCredit(envelope) || ACTIONABLE.has(envelope.event_type))) {
      await reconcileQueue.add("reconcile", { rawEventId: inserted.id }, { jobId: inserted.id });
    }
    return reply.code(200).send({ received: true });
  });

  // ── Customers ─────────────────────────────────────────────────────────────
  app.get("/customers", { preHandler: authenticate }, (req) => listCustomers(db, parsePage(req)));

  app.post("/customers", { preHandler: authenticate }, async (req, reply) => {
    const parsed = CreateCustomerBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const { name, vertical } = parsed.data;
    // accountRef must be 16–64 chars and unique; generate a stable one if absent.
    const accountRef = parsed.data.accountRef ?? `KOBO-${vertical}-${randomUUID()}`.slice(0, 64);
    const accountName = name.length >= 8 ? name : `${name} (${vertical})`;

    const va = await nomba.createVirtualAccount({ accountRef, accountName });
    const [customer] = await db
      .insert(customers)
      .values({ accountRef, name, vertical })
      .returning({ id: customers.id });
    await db.insert(virtualAccounts).values({
      customerId: customer!.id,
      bankAccountNumber: va.bankAccountNumber,
      bankAccountName: va.bankAccountName,
      bankName: va.bankName,
      accountHolderId: va.accountHolderId,
    });
    return reply.code(201).send({
      id: customer!.id,
      name,
      accountRef,
      vertical,
      bankAccountNumber: va.bankAccountNumber,
      bankName: va.bankName,
    });
  });

  app.get<{ Params: { id: string } }>(
    "/customers/:id/statement",
    { preHandler: authenticate },
    async (req, reply) => {
      const statement = await getStatement(db, req.params.id);
      if (!statement) return reply.code(404).send({ error: "customer not found" });
      return statement;
    },
  );

  // Apply a customer's standing credit (from prepayment/overpayment) to their
  // open invoices, oldest-first. A checker action — but low-risk: it's a pure
  // ledger offset (debit customer_credit, credit receivable), no cash moves.
  app.post<{ Params: { id: string } }>(
    "/customers/:id/apply-credit",
    { preHandler: requireRole("checker") },
    async (req, reply) => {
      const [customer] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, req.params.id))
        .limit(1);
      if (!customer) return reply.code(404).send({ error: "customer not found" });
      const { applied } = await db.transaction((tx) => applyCustomerCredit(tx, req.params.id));
      return { appliedKobo: applied.toString() };
    },
  );

  // Create an invoice for a customer. Amount is naira in; stored as integer kobo.
  app.post<{ Params: { id: string } }>(
    "/customers/:id/invoices",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = CreateInvoiceBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid body" });

      const [customer] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, req.params.id))
        .limit(1);
      if (!customer) return reply.code(404).send({ error: "customer not found" });

      const amountExpected = nairaToKobo(parsed.data.amountExpected);
      const [invoice] = await db
        .insert(invoices)
        .values({
          customerId: customer.id,
          reference: parsed.data.reference,
          amountExpected,
          ...(parsed.data.period ? { period: parsed.data.period } : {}),
        })
        .returning({
          id: invoices.id,
          reference: invoices.reference,
          status: invoices.status,
          period: invoices.period,
        });
      return reply.code(201).send({
        ...invoice,
        amountExpectedKobo: amountExpected.toString(),
      });
    },
  );

  // ── Operator console ──────────────────────────────────────────────────────
  app.get("/kpis", { preHandler: authenticate }, () => getKpis(db));

  // Daily inflow / reconciled / exception trend for the dashboard charts.
  app.get<{ Querystring: { days?: string } }>(
    "/kpis/timeseries",
    { preHandler: authenticate },
    (req) => {
      const days = Number.parseInt(req.query.days ?? "30", 10);
      return getTimeseries(db, Number.isFinite(days) ? days : 30);
    },
  );

  // Payment mix by reconciliation classification (powers the breakdown donut).
  app.get("/kpis/breakdown", { preHandler: authenticate }, () => getBreakdown(db));

  app.get("/exceptions", { preHandler: authenticate }, (req) => listOpenExceptions(db, parsePage(req)));

  app.post<{ Params: { id: string } }>(
    "/exceptions/:id/resolve",
    { preHandler: authenticate },
    async (req, reply) => {
      const res = await db
        .update(exceptions)
        .set({ resolvedAt: new Date(), resolvedBy: req.user.email })
        .where(eq(exceptions.id, req.params.id))
        .returning({ id: exceptions.id });
      if (res.length === 0) return reply.code(404).send({ error: "exception not found" });
      return { ok: true };
    },
  );

  // Re-attribute an orphan: move the parked money out of suspense into the named
  // customer's credit balance (balanced contra postings), then close the break.
  app.post<{ Params: { id: string } }>(
    "/exceptions/:id/reattribute",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = ReattributeBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
      const { customerId } = parsed.data;

      return db.transaction(async (tx) => {
        const [exc] = await tx
          .select({ id: exceptions.id, paymentId: exceptions.paymentId, reason: exceptions.reason, resolvedAt: exceptions.resolvedAt })
          .from(exceptions)
          .where(eq(exceptions.id, req.params.id))
          .limit(1)
          .for("update");
        if (!exc) return reply.code(404).send({ error: "exception not found" });
        if (exc.resolvedAt) return reply.code(409).send({ error: "exception already resolved" });
        if (exc.reason !== "orphan") return reply.code(409).send({ error: "only orphans are re-attributable" });

        const [cust] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1);
        if (!cust) return reply.code(404).send({ error: "customer not found" });

        const [pay] = await tx.select().from(payments).where(eq(payments.id, exc.paymentId)).limit(1);
        if (!pay) return reply.code(404).send({ error: "payment not found" });

        await tx.insert(ledgerEntries).values([
          { paymentId: pay.id, account: LedgerAccount.suspenseUnmatched, direction: "debit", amount: pay.grossAmount },
          { paymentId: pay.id, account: LedgerAccount.customerCredit(customerId), direction: "credit", amount: pay.grossAmount },
        ]);
        await tx.update(payments).set({ customerId, status: "reconciled" }).where(eq(payments.id, pay.id));
        await tx
          .update(exceptions)
          .set({ resolvedAt: new Date(), resolvedBy: req.user.email })
          .where(eq(exceptions.id, exc.id));
        return { ok: true };
      });
    },
  );

  // ── School product (built on Kobo) ────────────────────────────────────────
  registerSchoolRoutes(app, { db, nomba, authenticate });

  // Filterable by ?status (default pending_approval). `failed` lets operators
  // find and re-approve payouts that were rejected (e.g. insufficient balance).
  const REFUND_STATUSES = new Set(["pending_approval", "approved", "sent", "failed"]);
  app.get("/refunds", { preHandler: authenticate }, (req) => {
    const q = (req.query as { status?: string }).status;
    const status = q && REFUND_STATUSES.has(q) ? q : "pending_approval";
    return listRefunds(db, parsePage(req), status);
  });

  // Maker-checker: only a checker approves, and never a refund they proposed.
  app.post<{ Params: { id: string } }>(
    "/refunds/:id/approve",
    { preHandler: requireRole("checker") },
    async (req, reply) => {
      const [refund] = await db
        .select()
        .from(pendingRefunds)
        .where(eq(pendingRefunds.id, req.params.id))
        .limit(1);
      if (!refund) return reply.code(404).send({ error: "refund not found" });
      // Allow re-approving a `failed` payout (e.g. after funding the wallet) — the
      // merchant_tx_ref idempotency key means Nomba never double-pays on a retry.
      if (refund.status !== "pending_approval" && refund.status !== "failed") {
        return reply.code(409).send({ error: `refund is ${refund.status}` });
      }
      if (refund.proposedBy && refund.proposedBy === req.user.email) {
        return reply.code(409).send({ error: "maker-checker: approver must differ from proposer" });
      }
      await db
        .update(pendingRefunds)
        .set({ status: "approved", approvedBy: req.user.email, updatedAt: new Date() })
        .where(eq(pendingRefunds.id, req.params.id));
      // Unique jobId per approval so a retry of a previously-failed refund actually
      // enqueues (BullMQ dedups on jobId). Transient payout errors retry w/ backoff.
      await payoutQueue.add(
        "payout",
        { refundId: refund.id },
        { jobId: `payout-${refund.id}-${Date.now()}`, attempts: 5, backoff: { type: "exponential", delay: 5000 } },
      );
      return { ok: true };
    },
  );

  return app;
}
