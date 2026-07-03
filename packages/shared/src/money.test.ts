import { describe, expect, it } from "vitest";
import { formatNaira, koboToNaira, nairaToKobo, sumKobo } from "./money.js";

describe("nairaToKobo", () => {
  it("converts whole naira to kobo", () => {
    expect(nairaToKobo(120)).toBe(12000n);
  });

  it("converts the documented 0.6 naira fee to 60 kobo without float drift", () => {
    // 0.6 * 100 === 60.00000000000001 in IEEE-754; rounding must absorb it.
    expect(nairaToKobo(0.6)).toBe(60n);
  });

  it("handles classic float-hazard values", () => {
    expect(nairaToKobo(0.1)).toBe(10n);
    expect(nairaToKobo(0.29)).toBe(29n);
    expect(nairaToKobo(1.005)).toBe(BigInt(Math.round(1.005 * 100)));
  });

  it("accepts zero", () => {
    expect(nairaToKobo(0)).toBe(0n);
  });

  it("rejects negative amounts", () => {
    expect(() => nairaToKobo(-1)).toThrow(/negative/);
  });

  it("rejects non-finite amounts", () => {
    expect(() => nairaToKobo(Number.NaN)).toThrow(/finite/);
    expect(() => nairaToKobo(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});

describe("koboToNaira", () => {
  it("round-trips with nairaToKobo for 2-dp values", () => {
    for (const naira of [0, 0.6, 1, 12.34, 150, 49999.99]) {
      expect(koboToNaira(nairaToKobo(naira))).toBeCloseTo(naira, 2);
    }
  });
});

describe("formatNaira", () => {
  it("formats with thousands separators and two decimals", () => {
    expect(formatNaira(1234567n)).toBe("₦12,345.67");
    expect(formatNaira(60n)).toBe("₦0.60");
    expect(formatNaira(0n)).toBe("₦0.00");
  });

  it("formats negatives", () => {
    expect(formatNaira(-5000n)).toBe("-₦50.00");
  });
});

describe("sumKobo", () => {
  it("sums bigints exactly", () => {
    expect(sumKobo([100n, 200n, 300n])).toBe(600n);
    expect(sumKobo([])).toBe(0n);
  });
});
