/**
 * Credit application — pure, side-effect free. A platform capability: move a
 * customer's standing credit (from prior overpayment/prepayment) onto their open
 * invoices, oldest-first, until the credit or the invoices run out.
 *
 * Postings (balanced, no cash event):
 *   debit  liability:customer_credit:{id}   applied
 *   credit customer:{id}:receivable          applied
 */
import { LedgerAccount, type Kobo } from "@kobo/shared";
import type { InvoiceUpdate, OpenInvoice, Posting } from "./reconcile.js";

export interface ApplyCreditInput {
  customerId: string;
  /** Available credit balance (kobo, ≥ 0). */
  availableCredit: Kobo;
  /** Open invoices, oldest-first. */
  openInvoices: OpenInvoice[];
}

export interface ApplyCreditResult {
  applied: Kobo;
  postings: Posting[];
  invoiceUpdates: InvoiceUpdate[];
}

export function applyCredit({
  customerId,
  availableCredit,
  openInvoices,
}: ApplyCreditInput): ApplyCreditResult {
  if (availableCredit < 0n) {
    throw new RangeError(`applyCredit: availableCredit must be ≥ 0, got ${availableCredit}`);
  }

  let remaining = availableCredit;
  let applied = 0n;
  const invoiceUpdates: InvoiceUpdate[] = [];

  for (const inv of openInvoices) {
    if (remaining <= 0n) break;
    const outstanding = inv.amountExpected - inv.amountSettled;
    if (outstanding <= 0n) continue;
    const use = remaining < outstanding ? remaining : outstanding;
    const newSettled = inv.amountSettled + use;
    invoiceUpdates.push({
      invoiceId: inv.id,
      amountSettled: newSettled,
      status: newSettled >= inv.amountExpected ? "settled" : "partially_paid",
    });
    remaining -= use;
    applied += use;
  }

  const postings: Posting[] =
    applied > 0n
      ? [
          { account: LedgerAccount.customerCredit(customerId), direction: "debit", amount: applied },
          { account: LedgerAccount.customerReceivable(customerId), direction: "credit", amount: applied },
        ]
      : [];

  return { applied, postings, invoiceUpdates };
}
