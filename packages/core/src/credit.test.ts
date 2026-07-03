import { LedgerAccount } from "@kobo/shared";
import { describe, expect, it } from "vitest";
import { applyCredit } from "./credit.js";
import type { OpenInvoice } from "./reconcile.js";

const CUSTOMER = "11111111-1111-1111-1111-111111111111";
const INV1 = "22222222-2222-2222-2222-222222222222";
const INV2 = "33333333-3333-3333-3333-333333333333";

function inv(id: string, expected: bigint, settled = 0n): OpenInvoice {
  return { id, amountExpected: expected, amountSettled: settled };
}

describe("applyCredit", () => {
  it("does nothing with no credit", () => {
    const r = applyCredit({ customerId: CUSTOMER, availableCredit: 0n, openInvoices: [inv(INV1, 5_500_000n)] });
    expect(r.applied).toBe(0n);
    expect(r.postings).toEqual([]);
    expect(r.invoiceUpdates).toEqual([]);
  });

  it("part-pays an invoice when credit is less than outstanding", () => {
    const r = applyCredit({ customerId: CUSTOMER, availableCredit: 2_000_000n, openInvoices: [inv(INV1, 5_500_000n)] });
    expect(r.applied).toBe(2_000_000n);
    expect(r.invoiceUpdates).toEqual([
      { invoiceId: INV1, amountSettled: 2_000_000n, status: "partially_paid" },
    ]);
    // balanced: debit credit-account, credit receivable.
    expect(r.postings).toEqual([
      { account: LedgerAccount.customerCredit(CUSTOMER), direction: "debit", amount: 2_000_000n },
      { account: LedgerAccount.customerReceivable(CUSTOMER), direction: "credit", amount: 2_000_000n },
    ]);
  });

  it("settles and waterfalls across invoices, leaving leftover credit unspent", () => {
    const r = applyCredit({
      customerId: CUSTOMER,
      availableCredit: 7_000_000n,
      openInvoices: [inv(INV1, 5_500_000n), inv(INV2, 5_500_000n)],
    });
    // 5.5M settles INV1, 1.5M part-pays INV2 → 7M applied, 0 leftover spent.
    expect(r.applied).toBe(7_000_000n);
    expect(r.invoiceUpdates).toEqual([
      { invoiceId: INV1, amountSettled: 5_500_000n, status: "settled" },
      { invoiceId: INV2, amountSettled: 1_500_000n, status: "partially_paid" },
    ]);
  });

  it("never applies more than the invoices need (excess credit stays)", () => {
    const r = applyCredit({ customerId: CUSTOMER, availableCredit: 9_000_000n, openInvoices: [inv(INV1, 5_500_000n)] });
    expect(r.applied).toBe(5_500_000n); // only what the invoice needed
    expect(r.invoiceUpdates[0]?.status).toBe("settled");
  });
});
