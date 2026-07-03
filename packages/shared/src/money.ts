/**
 * Money in Kobo.
 *
 * The entire money path is integer **kobo** as `bigint`. No floating point ever
 * touches a balance or a ledger amount. The only place naira-decimals exist is
 * the Nomba API boundary, and they are converted here on the way in/out.
 *
 * ⚠️ UNITS ASSUMPTION (inbound direction):
 * Nomba serializes inbound amounts as **naira (major units)** decimals — the inbound
 * webhook shows `transactionAmount: 120` with `fee: 0.6` (= 60 kobo). If a live
 * sandbox transfer proves amounts are already minor units, flip ONLY the two
 * boundary functions below — nothing else in the system changes.
 */

export type Kobo = bigint;

const KOBO_PER_NAIRA = 100;

/**
 * Convert a Nomba naira amount (JSON number, may be a decimal like 0.6) to integer kobo.
 * Rounds to the nearest kobo; `Math.round` absorbs IEEE-754 noise (0.6 * 100 = 60.0000…1 → 60).
 * Rejects non-finite or negative input — money must never be NaN or negative at the boundary.
 */
export function nairaToKobo(naira: number): Kobo {
  if (!Number.isFinite(naira)) {
    throw new RangeError(`nairaToKobo: amount is not a finite number: ${String(naira)}`);
  }
  if (naira < 0) {
    throw new RangeError(`nairaToKobo: amount is negative: ${naira}`);
  }
  return BigInt(Math.round(naira * KOBO_PER_NAIRA));
}

/**
 * Convert integer kobo to a naira number for the Nomba payout API.
 * Safe for any realistic payout amount (kobo well under Number.MAX_SAFE_INTEGER).
 */
export function koboToNaira(kobo: Kobo): number {
  return Number(kobo) / KOBO_PER_NAIRA;
}

/** Human-readable display, e.g. 1234567n → "₦12,345.67". Presentation only. */
export function formatNaira(kobo: Kobo): string {
  const negative = kobo < 0n;
  const abs = negative ? -kobo : kobo;
  const naira = abs / 100n;
  const remainder = abs % 100n;
  const nairaStr = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const koboStr = remainder.toString().padStart(2, "0");
  return `${negative ? "-" : ""}₦${nairaStr}.${koboStr}`;
}

/** Sum a list of kobo amounts. */
export function sumKobo(amounts: readonly Kobo[]): Kobo {
  return amounts.reduce((acc, n) => acc + n, 0n);
}
