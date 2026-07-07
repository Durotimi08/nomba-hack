/**
 * Refund payout. A pending_refund only reaches here AFTER a checker has approved
 * it (maker-checker, enforced in the API). We pay the overpayment surplus back to
 * the original sender's account using the stored `merchant_tx_ref` as the
 * idempotency key — so a retried job never double-pays.
 *
 * Failure handling (money path — never leave a refund silently stranded):
 *   • transient error (timeout / 429 / 5xx) → rethrow so BullMQ retries w/ backoff
 *   • terminal error (4xx, e.g. INSUFFICIENT_BALANCE) or FAILED result → mark the
 *     refund `failed` so it's visible and re-approvable (not stuck as `approved`)
 *   • success → mark `sent` AND post the reversing ledger entry (debit customer
 *     credit, credit cash) so the credit liability is drawn down when cash leaves
 */
import { ledgerEntries, payments, pendingRefunds, type Db } from "@kobo/db";
import { LedgerAccount, koboToNaira, type Logger } from "@kobo/shared";
import type { NombaClient } from "@kobo/nomba";
import { eq } from "drizzle-orm";

export interface PayoutDeps {
  db: Db;
  nomba: NombaClient;
  merchantName: string;
  log?: Logger;
}

/** A retry can only help transient failures; a 4xx is a terminal business error. */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: unknown }).status;
  if (typeof status !== "number") return true; // network/unknown error → retry
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

export async function processApprovedRefund(
  deps: PayoutDeps,
  refundId: string,
): Promise<{ status: "sent" | "failed" | "skipped" }> {
  const { db, nomba, merchantName, log } = deps;

  const [refund] = await db
    .select()
    .from(pendingRefunds)
    .where(eq(pendingRefunds.id, refundId))
    .limit(1);
  if (!refund) throw new Error(`pending_refund ${refundId} not found`);
  if (refund.status !== "approved") {
    // Only approved refunds are payable; anything else is a no-op (idempotent).
    return { status: "skipped" };
  }

  const markFailed = async (): Promise<void> => {
    await db
      .update(pendingRefunds)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(pendingRefunds.id, refundId));
  };

  const [pay] = await db.select().from(payments).where(eq(payments.id, refund.paymentId)).limit(1);
  if (!pay?.senderAccountNumber || !pay.senderBankCode) {
    await markFailed();
    log?.warn({ refundId }, "refund failed: missing sender bank details");
    return { status: "failed" };
  }

  let result;
  try {
    result = await nomba.transferToBank({
      amount: refund.amount,
      accountNumber: pay.senderAccountNumber,
      accountName: pay.senderName ?? "Customer Refund",
      bankCode: pay.senderBankCode,
      merchantTxRef: refund.merchantTxRef,
      senderName: merchantName,
      narration: `Refund of overpayment (${koboToNaira(refund.amount)} NGN)`,
    });
  } catch (err) {
    if (isTransient(err)) {
      // Leave status `approved` and rethrow — BullMQ retries with backoff.
      log?.warn({ refundId, err: (err as Error).message }, "refund payout transient error — will retry");
      throw err;
    }
    // Terminal (e.g. 400 INSUFFICIENT_BALANCE): no money moved. Mark failed so an
    // operator can re-approve after funding the wallet, instead of it stranding.
    await markFailed();
    log?.warn({ refundId, err: (err as Error).message }, "refund payout failed (terminal) — marked failed");
    return { status: "failed" };
  }

  if (result.status === "FAILED" || result.status === "REFUND") {
    await markFailed();
    log?.warn({ refundId, transferStatus: result.status }, "refund payout rejected — marked failed");
    return { status: "failed" };
  }

  // Success (SUCCESS / PROCESSING / PENDING): cash is leaving the wallet. Flip the
  // refund to `sent` and post the reversing entry atomically so the customer's
  // credit liability is drawn down by exactly what we paid out.
  await db.transaction(async (tx) => {
    await tx
      .update(pendingRefunds)
      .set({ status: "sent", updatedAt: new Date() })
      .where(eq(pendingRefunds.id, refundId));
    await tx.insert(ledgerEntries).values([
      { paymentId: refund.paymentId, account: LedgerAccount.customerCredit(refund.customerId), direction: "debit", amount: refund.amount },
      { paymentId: refund.paymentId, account: LedgerAccount.cashNombaWallet, direction: "credit", amount: refund.amount },
    ]);
  });

  log?.info({ refundId, transferStatus: result.status }, "refund payout submitted");
  return { status: "sent" };
}
