/**
 * Refund payout. A pending_refund only reaches here AFTER a checker has approved
 * it (maker-checker, enforced in the API). We pay the overpayment surplus back to
 * the original sender's account using the stored `merchant_tx_ref` as the
 * idempotency key — so a retried job never double-pays. A PROCESSING/PENDING
 * result is left for the payout webhook to finalise.
 */
import { payments, pendingRefunds, type Db } from "@kobo/db";
import { koboToNaira, type Logger } from "@kobo/shared";
import type { NombaClient } from "@kobo/nomba";
import { eq } from "drizzle-orm";

export interface PayoutDeps {
  db: Db;
  nomba: NombaClient;
  merchantName: string;
  log?: Logger;
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

  const [pay] = await db.select().from(payments).where(eq(payments.id, refund.paymentId)).limit(1);
  if (!pay?.senderAccountNumber || !pay.senderBankCode) {
    await db
      .update(pendingRefunds)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(pendingRefunds.id, refundId));
    log?.warn({ refundId }, "refund failed: missing sender bank details");
    return { status: "failed" };
  }

  const result = await nomba.transferToBank({
    amount: refund.amount,
    accountNumber: pay.senderAccountNumber,
    accountName: pay.senderName ?? "Customer Refund",
    bankCode: pay.senderBankCode,
    merchantTxRef: refund.merchantTxRef,
    senderName: merchantName,
    narration: `Refund of overpayment (${koboToNaira(refund.amount)} NGN)`,
  });

  const failed = result.status === "FAILED" || result.status === "REFUND";
  const nextStatus = failed ? "failed" : "sent";
  await db
    .update(pendingRefunds)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(pendingRefunds.id, refundId));

  log?.info({ refundId, transferStatus: result.status }, "refund payout submitted");
  return { status: nextStatus };
}
