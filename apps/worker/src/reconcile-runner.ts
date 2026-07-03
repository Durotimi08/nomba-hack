/**
 * Event runner — the transactional bridge between Nomba webhooks and the ledger.
 * Dispatches each raw_event by type:
 *   - inbound VA credit  → reconcile against the FIFO invoice (the core path),
 *   - payout_*           → finalise the matching pending_refund,
 *   - payment_reversal   → unwind the original credit with contra postings.
 * Every branch is idempotent and runs in one transaction: all of it commits or
 * none of it does. Idempotency anchors are `payments.session_id` (credits) and
 * the terminal status of the affected row (payouts/reversals).
 */
import { reconcile, type OpenInvoice } from "@kobo/core";
import {
  customers,
  exceptions,
  invoices,
  ledgerEntries,
  payments,
  pendingRefunds,
  rawEvents,
  virtualAccounts,
  type Db,
} from "@kobo/db";
import { normalizeInboundPayment } from "@kobo/nomba";
import {
  InboundPaymentSchema,
  WebhookEnvelopeSchema,
  isInboundVirtualAccountCredit,
  type WebhookEnvelope,
} from "@kobo/shared";
import { and, eq, inArray } from "drizzle-orm";

export interface ReconcileOutcome {
  status: "reconciled" | "duplicate" | "skipped" | "exception" | "payout" | "reversed";
  classification?: string;
  paymentId?: string;
}

const PAYOUT_EVENTS = new Set([
  "payout_success",
  "payout_failed",
  "payout_refund",
  "transfer.success",
  "transfer.failed",
]);
const PAYOUT_SUCCESS_EVENTS = new Set(["payout_success", "transfer.success"]);

export async function processRawEvent(db: Db, rawEventId: string): Promise<ReconcileOutcome> {
  const [evt] = await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)).limit(1);
  if (!evt) throw new Error(`raw_event ${rawEventId} not found`);
  if (evt.processedAt) return { status: "skipped" };

  const markProcessed = (tx: Db) =>
    tx.update(rawEvents).set({ processedAt: new Date() }).where(eq(rawEvents.id, rawEventId));

  if (!evt.signatureValid) {
    await markProcessed(db);
    return { status: "skipped" };
  }

  const envelope = WebhookEnvelopeSchema.parse(evt.payload);

  if (isInboundVirtualAccountCredit(envelope)) {
    return reconcileInboundCredit(db, evt.payload, rawEventId);
  }
  if (PAYOUT_EVENTS.has(envelope.event_type)) {
    return finalisePayout(db, envelope, rawEventId);
  }
  if (envelope.event_type === "payment_reversal") {
    return reverseCredit(db, envelope, rawEventId);
  }

  await markProcessed(db);
  return { status: "skipped" };
}

// ── Inbound credit → reconcile ────────────────────────────────────────────────
async function reconcileInboundCredit(
  db: Db,
  payload: unknown,
  rawEventId: string,
): Promise<ReconcileOutcome> {
  const normalized = normalizeInboundPayment(InboundPaymentSchema.parse(payload));

  return db.transaction(async (tx) => {
    // (1) Idempotency gate — the hard guarantee against double-credit.
    const existing = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.sessionId, normalized.sessionId))
      .limit(1);
    if (existing.length > 0) {
      await tx.update(rawEvents).set({ processedAt: new Date() }).where(eq(rawEvents.id, rawEventId));
      return { status: "duplicate", classification: "duplicate" };
    }

    // (2) Resolve identity: accountRef (primary) → VA number (fallback).
    let customerId: string | null = null;
    let virtualAccountId: string | null = null;
    if (normalized.accountRef) {
      const [c] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.accountRef, normalized.accountRef))
        .limit(1);
      customerId = c?.id ?? null;
    }
    if (normalized.virtualAccountNumber) {
      const [va] = await tx
        .select({ id: virtualAccounts.id, customerId: virtualAccounts.customerId })
        .from(virtualAccounts)
        .where(eq(virtualAccounts.bankAccountNumber, normalized.virtualAccountNumber))
        .limit(1);
      if (va) {
        virtualAccountId = va.id;
        customerId ??= va.customerId;
      }
    }

    // (3) Lock ALL open invoices oldest-first so the payment can waterfall across
    // them, and so two payments for the same customer serialise.
    let openInvoices: OpenInvoice[] = [];
    if (customerId) {
      openInvoices = await tx
        .select({
          id: invoices.id,
          amountExpected: invoices.amountExpected,
          amountSettled: invoices.amountSettled,
        })
        .from(invoices)
        .where(
          and(eq(invoices.customerId, customerId), inArray(invoices.status, ["open", "partially_paid"])),
        )
        .orderBy(invoices.createdAt)
        .for("update");
    }

    // (4) Pure decision.
    const result = reconcile({
      payment: { sessionId: normalized.sessionId, customerId, gross: normalized.gross, fee: normalized.fee },
      openInvoices,
    });

    // (5) Persist payment + balanced ledger + side effects.
    const [pay] = await tx
      .insert(payments)
      .values({
        sessionId: normalized.sessionId,
        requestId: normalized.requestId,
        rawEventId,
        virtualAccountId,
        customerId,
        grossAmount: normalized.gross,
        fee: normalized.fee,
        netAmount: normalized.gross - normalized.fee,
        senderName: normalized.senderName,
        senderBank: normalized.senderBank,
        senderAccountNumber: normalized.senderAccountNumber,
        senderBankCode: normalized.senderBankCode,
        classification: result.classification,
        matchedInvoiceId: result.matchedInvoiceId,
        status: result.status,
        occurredAt: normalized.occurredAt ? new Date(normalized.occurredAt) : null,
      })
      .returning({ id: payments.id });
    const paymentId = pay!.id;

    if (result.postings.length > 0) {
      await tx.insert(ledgerEntries).values(
        result.postings.map((p) => ({
          paymentId,
          account: p.account,
          direction: p.direction,
          amount: p.amount,
        })),
      );
    }
    for (const u of result.invoiceUpdates) {
      await tx
        .update(invoices)
        .set({ amountSettled: u.amountSettled, status: u.status })
        .where(eq(invoices.id, u.invoiceId));
    }
    if (result.exception) {
      await tx.insert(exceptions).values({
        paymentId,
        reason: result.exception.reason,
        materiality: result.exception.materiality,
      });
    }
    if (result.refund && customerId) {
      await tx.insert(pendingRefunds).values({
        paymentId,
        customerId,
        amount: result.refund.amount,
        merchantTxRef: `REFUND-${normalized.sessionId}`,
        status: "pending_approval",
      });
    }

    await tx.update(rawEvents).set({ processedAt: new Date() }).where(eq(rawEvents.id, rawEventId));
    return {
      status: result.status === "in_exception" ? "exception" : "reconciled",
      classification: result.classification,
      paymentId,
    };
  });
}

// ── payout_* → finalise the matching pending_refund ───────────────────────────
function payoutRef(envelope: WebhookEnvelope): string | null {
  const tx = envelope.data.transaction as { merchantTxRef?: unknown; meta?: { merchantTxRef?: unknown } } | undefined;
  const ref = tx?.merchantTxRef ?? tx?.meta?.merchantTxRef;
  return typeof ref === "string" ? ref : null;
}

async function finalisePayout(
  db: Db,
  envelope: WebhookEnvelope,
  rawEventId: string,
): Promise<ReconcileOutcome> {
  const ref = payoutRef(envelope);
  return db.transaction(async (tx) => {
    if (ref) {
      // success → sent; failed / auto-refund → failed.
      const nextStatus = PAYOUT_SUCCESS_EVENTS.has(envelope.event_type) ? "sent" : "failed";
      await tx
        .update(pendingRefunds)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(and(eq(pendingRefunds.merchantTxRef, ref), inArray(pendingRefunds.status, ["approved", "sent"])));
    }
    await tx.update(rawEvents).set({ processedAt: new Date() }).where(eq(rawEvents.id, rawEventId));
    return { status: "payout", classification: envelope.event_type };
  });
}

// ── payment_reversal → unwind the original credit with contra postings ────────
async function reverseCredit(
  db: Db,
  envelope: WebhookEnvelope,
  rawEventId: string,
): Promise<ReconcileOutcome> {
  const sessionId = envelope.data.transaction?.sessionId;
  return db.transaction(async (tx) => {
    const markDone = () =>
      tx.update(rawEvents).set({ processedAt: new Date() }).where(eq(rawEvents.id, rawEventId));

    if (!sessionId) {
      await markDone();
      return { status: "skipped" };
    }
    const [pay] = await tx
      .select()
      .from(payments)
      .where(eq(payments.sessionId, sessionId))
      .limit(1)
      .for("update");
    if (!pay || pay.status === "refunded") {
      await markDone();
      return { status: "skipped" };
    }

    // Post inverse entries for every original posting (append-only unwind).
    const original = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, pay.id));
    const contra = original.filter((e) => !e.account.startsWith("reversal:")); // never re-reverse
    if (contra.length > 0) {
      await tx.insert(ledgerEntries).values(
        contra.map((e) => ({
          paymentId: pay.id,
          account: e.account,
          direction: e.direction === "debit" ? ("credit" as const) : ("debit" as const),
          amount: e.amount,
        })),
      );
    }

    // Roll back the invoice settlement by the amount that hit receivable.
    if (pay.matchedInvoiceId) {
      const settled = contra
        .filter((e) => e.direction === "credit" && /:receivable$/.test(e.account))
        .reduce((acc, e) => acc + e.amount, 0n);
      if (settled > 0n) {
        const [inv] = await tx
          .select({ amountSettled: invoices.amountSettled })
          .from(invoices)
          .where(eq(invoices.id, pay.matchedInvoiceId))
          .limit(1)
          .for("update");
        if (inv) {
          const next = inv.amountSettled - settled;
          await tx
            .update(invoices)
            .set({ amountSettled: next < 0n ? 0n : next, status: next > 0n ? "partially_paid" : "open" })
            .where(eq(invoices.id, pay.matchedInvoiceId));
        }
      }
    }

    await tx.update(payments).set({ status: "refunded" }).where(eq(payments.id, pay.id));
    await markDone();
    return { status: "reversed", paymentId: pay.id };
  });
}
