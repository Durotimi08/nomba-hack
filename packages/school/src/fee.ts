/**
 * Pure fee engine — the brain of the school billing layer (the billing-side
 * analogue of @kobo/core's reconciliation engine). Given a student's applicable
 * charges and discounts, it computes the net amount expected, with NO IO.
 *
 * Rules:
 *   - Charges SUM into the base fee.
 *   - Among all applicable discounts, only the SINGLE LARGEST applies
 *     ("take the highest") — discounts never stack. Net floors at ₦0; a discount
 *     never creates credit.
 * Money is integer kobo (bigint). Percentages are integer BASIS POINTS
 * (2000 = 20.00%), so the math stays exact with no floating point.
 */
import type { Kobo } from "@kobo/shared";

export type RuleValueType = "fixed" | "percent";

/** A charge is a fixed kobo amount (a fee is an amount, not a percentage). */
export interface ChargeInput {
  amount: Kobo;
}

export interface DiscountInput {
  /** Stable id so the caller can consume the one-time rule that actually applied. */
  id: string;
  valueType: RuleValueType;
  /** fixed → kobo; percent → basis points (2000 = 20.00%). */
  value: bigint;
}

export interface FeeBreakdown {
  base: Kobo;
  /** The discount that actually applied (highest value), or null if none reduced the bill. */
  appliedDiscountId: string | null;
  discountAmount: Kobo;
  net: Kobo;
}

const BASIS_POINTS = 10_000n;

/** Kobo a discount removes from `base`, clamped to [0, base]. */
function discountValue(base: Kobo, d: DiscountInput): Kobo {
  const raw = d.valueType === "fixed" ? d.value : (base * d.value) / BASIS_POINTS; // floor division
  if (raw < 0n) return 0n;
  return raw > base ? base : raw;
}

/**
 * Net fee for one student. Deterministic and order-stable: on a tie, the discount
 * passed earliest wins (we only replace on a strictly greater value).
 */
export function computeNetFee(charges: ChargeInput[], discounts: DiscountInput[]): FeeBreakdown {
  const base = charges.reduce((acc, c) => acc + c.amount, 0n);

  let best: { id: string; amount: Kobo } | null = null;
  for (const d of discounts) {
    const amount = discountValue(base, d);
    if (best === null || amount > best.amount) best = { id: d.id, amount };
  }

  const discountAmount = best?.amount ?? 0n;
  return {
    base,
    // Only treat it as "applied" if it actually reduced the bill (drives one-time consumption).
    appliedDiscountId: best && best.amount > 0n ? best.id : null,
    discountAmount,
    net: base - discountAmount, // discountAmount ≤ base, so net ≥ 0
  };
}
