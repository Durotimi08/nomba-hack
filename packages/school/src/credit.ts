/**
 * Apply a customer's standing credit to their open invoices (the IO wrapper around
 * @kobo/core's pure `applyCredit`). A platform capability, not school-specific:
 * used both by the school billing run (auto-offset a new term) and by the operator
 * "apply credit" action. Pure ledger move — no cash. Postings carry no payment_id.
 */
import { applyCredit } from "@kobo/core";
import { invoices, ledgerEntries, pendingRefunds, type Db } from "@kobo/db";
import { LedgerAccount } from "@kobo/shared";
import { and, eq, inArray, sql } from "drizzle-orm";

export async function applyCustomerCredit(tx: Db, customerId: string): Promise<{ applied: bigint }> {
  const creditAccount = LedgerAccount.customerCredit(customerId);

  // Ledger credit balance = credits − debits on the customer's credit account.
  const [bal] = await tx
    .select({
      credit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'credit' THEN ${ledgerEntries.amount} ELSE 0 END), 0)`,
      debit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'debit' THEN ${ledgerEntries.amount} ELSE 0 END), 0)`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.account, creditAccount));
  const ledgerBalance = BigInt(bal?.credit ?? "0") - BigInt(bal?.debit ?? "0");

  // A refund's surplus lives in customer_credit until the payout posts its
  // reversing debit. Reserve every refund that could still pay out
  // (pending_approval/approved/failed — a failed one is re-approvable) so we never
  // apply money that a later payout will draw down. Keeps credit ≥ owed refunds.
  const [ref] = await tx
    .select({ reserved: sql<string>`COALESCE(SUM(${pendingRefunds.amount}), 0)` })
    .from(pendingRefunds)
    .where(
      and(
        eq(pendingRefunds.customerId, customerId),
        inArray(pendingRefunds.status, ["pending_approval", "approved", "failed"]),
      ),
    );
  const available = ledgerBalance - BigInt(ref?.reserved ?? "0");
  if (available <= 0n) return { applied: 0n };

  const open = await tx
    .select({ id: invoices.id, amountExpected: invoices.amountExpected, amountSettled: invoices.amountSettled })
    .from(invoices)
    .where(and(eq(invoices.customerId, customerId), inArray(invoices.status, ["open", "partially_paid"])))
    .orderBy(invoices.createdAt)
    .for("update");
  if (open.length === 0) return { applied: 0n };

  const result = applyCredit({ customerId, availableCredit: available, openInvoices: open });
  if (result.applied <= 0n) return { applied: 0n };

  await tx
    .insert(ledgerEntries)
    .values(
      result.postings.map((p) => ({ paymentId: null, account: p.account, direction: p.direction, amount: p.amount })),
    );
  for (const u of result.invoiceUpdates) {
    await tx
      .update(invoices)
      .set({ amountSettled: u.amountSettled, status: u.status })
      .where(eq(invoices.id, u.invoiceId));
  }
  return { applied: result.applied };
}
