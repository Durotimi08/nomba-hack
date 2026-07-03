import { describe, expect, it } from "vitest";
import { computeNetFee, type DiscountInput } from "./fee.js";

// ₦55,000 in kobo.
const FEE = 5_500_000n;

describe("computeNetFee — charges", () => {
  it("sums multiple charges into the base", () => {
    const r = computeNetFee([{ amount: 5_500_000n }, { amount: 1_000_000n }], []);
    expect(r.base).toBe(6_500_000n);
    expect(r.net).toBe(6_500_000n);
    expect(r.appliedDiscountId).toBeNull();
  });

  it("is zero with no charges", () => {
    expect(computeNetFee([], []).net).toBe(0n);
  });
});

describe("computeNetFee — single discount", () => {
  it("applies a fixed discount", () => {
    const r = computeNetFee([{ amount: FEE }], [{ id: "d", valueType: "fixed", value: 500_000n }]);
    expect(r.discountAmount).toBe(500_000n);
    expect(r.net).toBe(5_000_000n);
    expect(r.appliedDiscountId).toBe("d");
  });

  it("applies a percentage discount (basis points), flooring division", () => {
    // 20% of ₦55,000 = ₦11,000.
    const r = computeNetFee([{ amount: FEE }], [{ id: "p", valueType: "percent", value: 2000n }]);
    expect(r.discountAmount).toBe(1_100_000n);
    expect(r.net).toBe(4_400_000n);
  });
});

describe("computeNetFee — highest wins (no stacking)", () => {
  it("applies only the single largest discount", () => {
    const discounts: DiscountInput[] = [
      { id: "scholarship", valueType: "percent", value: 2000n }, // ₦11,000
      { id: "sibling", valueType: "fixed", value: 500_000n }, //     ₦5,000
      { id: "hardship", valueType: "percent", value: 5000n }, //     ₦27,500
    ];
    const r = computeNetFee([{ amount: FEE }], discounts);
    expect(r.appliedDiscountId).toBe("hardship");
    expect(r.discountAmount).toBe(2_750_000n);
    expect(r.net).toBe(2_750_000n);
  });

  it("breaks ties in favour of the earliest discount", () => {
    const r = computeNetFee([{ amount: FEE }], [
      { id: "first", valueType: "fixed", value: 1_000_000n },
      { id: "second", valueType: "percent", value: 2000n }, // also ₦10,000? no → ₦11,000
    ]);
    // second is actually larger here, so it wins — adjust to a real tie:
    const tie = computeNetFee([{ amount: FEE }], [
      { id: "first", valueType: "fixed", value: 1_100_000n },
      { id: "second", valueType: "percent", value: 2000n }, // == ₦11,000
    ]);
    expect(r.appliedDiscountId).toBe("second");
    expect(tie.appliedDiscountId).toBe("first");
  });
});

describe("computeNetFee — floors at zero, never creates credit", () => {
  it("clamps a fixed discount larger than the base", () => {
    const r = computeNetFee([{ amount: FEE }], [{ id: "x", valueType: "fixed", value: 9_000_000n }]);
    expect(r.discountAmount).toBe(FEE);
    expect(r.net).toBe(0n);
  });

  it("clamps a 100% discount to the base", () => {
    const r = computeNetFee([{ amount: FEE }], [{ id: "full", valueType: "percent", value: 10_000n }]);
    expect(r.net).toBe(0n);
    expect(r.appliedDiscountId).toBe("full");
  });

  it("ignores a zero-value discount (not 'applied')", () => {
    const r = computeNetFee([{ amount: FEE }], [{ id: "z", valueType: "fixed", value: 0n }]);
    expect(r.net).toBe(FEE);
    expect(r.appliedDiscountId).toBeNull();
  });
});
