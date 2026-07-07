/**
 * Billing run — generate one invoice per student in a cohort for a (year, term),
 * netting charges and discounts via the pure fee engine. Idempotent per
 * (student, reference) so re-running a term is safe. One-time rules are consumed
 * only when actually applied (the winning discount; any included one-time charge).
 *
 * This is the school layer orchestrating ON Kobo: it writes Kobo `invoices` that
 * the platform then reconciles. Credit application happens at settlement
 * (see @kobo/core waterfall), not here.
 */
import { customers, invoices, ruleConsumptions, rules as rulesTable, type Db } from "@kobo/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { applyCustomerCredit } from "./credit.js";
import { computeNetFee, type ChargeInput, type DiscountInput } from "./fee.js";
import { matchesMetadata } from "./match.js";

export type BillingFrequency = "monthly" | "termly" | "annually";

export interface RunBillingParams {
  cohort: string;
  /** Which recurring fees to charge this run. */
  frequency: BillingFrequency;
  /** Period label that identifies this run, e.g. "2026-T1", "2026-01", "2026". */
  period: string;
}

export interface BillingResult {
  reference: string;
  studentsBilled: number;
  invoicesCreated: number;
  invoicesSkipped: number; // already billed for this reference (idempotent)
  totalExpected: bigint; // kobo billed
  creditApplied: bigint; // kobo of standing credit auto-applied to the new invoices
}

export async function runBilling(db: Db, params: RunBillingParams): Promise<BillingResult> {
  const reference = `${params.cohort}-${params.period}`;

  return db.transaction(async (tx) => {
    const students = await tx.select().from(customers).where(eq(customers.cohort, params.cohort));

    // Active rules offered to this cohort (cohort-scoped or global NULL).
    const cohortRules = await tx
      .select()
      .from(rulesTable)
      .where(
        and(eq(rulesTable.active, true), or(eq(rulesTable.cohort, params.cohort), isNull(rulesTable.cohort))),
      );

    let invoicesCreated = 0;
    let invoicesSkipped = 0;
    let totalExpected = 0n;
    let creditApplied = 0n;

    for (const student of students) {
      // Idempotency: one invoice per student per reference.
      const existing = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.customerId, student.id), eq(invoices.reference, reference)))
        .limit(1);
      if (existing.length > 0) {
        invoicesSkipped++;
        continue;
      }

      const consumed = await tx
        .select({ ruleId: ruleConsumptions.ruleId })
        .from(ruleConsumptions)
        .where(eq(ruleConsumptions.customerId, student.id));
      const consumedIds = new Set(consumed.map((c) => c.ruleId));

      // Applicable = metadata match AND (this run's frequency, OR an unconsumed
      // one-time). A termly fee is skipped in a monthly run, and vice-versa.
      const applicable = cohortRules.filter(
        (r) =>
          matchesMetadata(r.match, student.metadata) &&
          (r.recurrence === params.frequency ||
            (r.recurrence === "one_time" && !consumedIds.has(r.id))),
      );
      // Charges are fixed kobo amounts; only discounts may be percentages.
      const charges: ChargeInput[] = applicable
        .filter((r) => r.kind === "charge")
        .map((r) => ({ amount: r.value }));
      const discounts: DiscountInput[] = applicable
        .filter((r) => r.kind === "discount")
        .map((r) => ({ id: r.id, valueType: r.valueType, value: r.value }));

      const fee = computeNetFee(charges, discounts);

      const [inv] = await tx
        .insert(invoices)
        .values({
          customerId: student.id,
          reference,
          amountExpected: fee.net,
          period: params.period,
          status: "open",
        })
        .returning({ id: invoices.id });

      // Consume one-time rules that were actually applied: every matched one-time
      // charge (always included in the base) + the one-time discount that WON.
      const appliedOneTime = applicable.filter(
        (r) =>
          r.recurrence === "one_time" &&
          (r.kind === "charge" || r.id === fee.appliedDiscountId),
      );
      if (appliedOneTime.length > 0) {
        await tx.insert(ruleConsumptions).values(
          appliedOneTime.map((r) => ({ ruleId: r.id, customerId: student.id, invoiceId: inv!.id })),
        );
      }

      invoicesCreated++;
      totalExpected += fee.net;

      // Auto-apply any standing credit (e.g. an early payment) to the new invoice.
      const credit = await applyCustomerCredit(tx, student.id);
      creditApplied += credit.applied;
    }

    return {
      reference,
      studentsBilled: students.length,
      invoicesCreated,
      invoicesSkipped,
      totalExpected,
      creditApplied,
    };
  });
}
