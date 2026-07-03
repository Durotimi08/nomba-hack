import { LedgerAccount } from "@kobo/shared";
import { describe, expect, it } from "vitest";
import { reconcile, type OpenInvoice, type Posting, type ReconcileInput } from "./reconcile.js";

const CUSTOMER = "11111111-1111-1111-1111-111111111111";
const INVOICE = "22222222-2222-2222-2222-222222222222";
const INV2 = "33333333-3333-3333-3333-333333333333";
const INV3 = "44444444-4444-4444-4444-444444444444";

/** Every result must have balanced postings — the core ledger invariant. */
function assertBalanced(postings: Posting[]): void {
  const debits = postings.filter((p) => p.direction === "debit").reduce((a, p) => a + p.amount, 0n);
  const credits = postings
    .filter((p) => p.direction === "credit")
    .reduce((a, p) => a + p.amount, 0n);
  expect(debits).toBe(credits);
}

function amountOn(postings: Posting[], account: string, direction: "debit" | "credit"): bigint {
  return postings
    .filter((p) => p.account === account && p.direction === direction)
    .reduce((a, p) => a + p.amount, 0n);
}

function invoice(id: string, expected: bigint, settled = 0n): OpenInvoice {
  return { id, amountExpected: expected, amountSettled: settled };
}

function input(over: Partial<ReconcileInput["payment"]>, openInvoices: OpenInvoice[]): ReconcileInput {
  return {
    payment: { sessionId: "s1", customerId: CUSTOMER, gross: 0n, fee: 0n, ...over },
    openInvoices,
  };
}

describe("reconcile — exact payment", () => {
  it("settles the invoice and balances", () => {
    const r = reconcile(input({ gross: 50_000_00n, fee: 60n }, [invoice(INVOICE, 50_000_00n)]));
    expect(r.classification).toBe("exact");
    expect(r.status).toBe("reconciled");
    expect(r.matchedInvoiceId).toBe(INVOICE);
    expect(r.invoiceUpdates).toEqual([
      { invoiceId: INVOICE, amountSettled: 50_000_00n, status: "settled" },
    ]);
    expect(r.refund).toBeUndefined();
    assertBalanced(r.postings);
    expect(amountOn(r.postings, LedgerAccount.cashNombaWallet, "debit")).toBe(50_000_00n - 60n);
    expect(amountOn(r.postings, LedgerAccount.expenseFees, "debit")).toBe(60n);
    expect(amountOn(r.postings, LedgerAccount.customerReceivable(CUSTOMER), "credit")).toBe(
      50_000_00n,
    );
  });
});

describe("reconcile — underpayment", () => {
  it("partially pays and keeps the invoice open with a running balance", () => {
    const r = reconcile(input({ gross: 45_000_00n, fee: 0n }, [invoice(INVOICE, 50_000_00n)]));
    expect(r.classification).toBe("underpayment");
    expect(r.invoiceUpdates).toEqual([
      { invoiceId: INVOICE, amountSettled: 45_000_00n, status: "partially_paid" },
    ]);
    expect(r.refund).toBeUndefined();
    assertBalanced(r.postings);
  });

  it("a second payment settles the remaining balance", () => {
    const r = reconcile(input({ gross: 5_000_00n, fee: 0n }, [invoice(INVOICE, 50_000_00n, 45_000_00n)]));
    expect(r.classification).toBe("exact");
    expect(r.invoiceUpdates[0]?.amountSettled).toBe(50_000_00n);
    expect(r.invoiceUpdates[0]?.status).toBe("settled");
    assertBalanced(r.postings);
  });
});

describe("reconcile — overpayment over a single invoice", () => {
  it("settles, books surplus as credit, and proposes a refund", () => {
    const r = reconcile(input({ gross: 60_000_00n, fee: 0n }, [invoice(INVOICE, 50_000_00n)]));
    expect(r.classification).toBe("overpayment");
    expect(r.invoiceUpdates[0]?.status).toBe("settled");
    expect(r.refund).toEqual({ amount: 10_000_00n });
    assertBalanced(r.postings);
    expect(amountOn(r.postings, LedgerAccount.customerReceivable(CUSTOMER), "credit")).toBe(
      50_000_00n,
    );
    expect(amountOn(r.postings, LedgerAccount.customerCredit(CUSTOMER), "credit")).toBe(10_000_00n);
  });
});

describe("reconcile — waterfall across multiple invoices", () => {
  it("a lump sum settles the oldest in full and part-pays the next", () => {
    // Two ₦55,000 terms, parent sends ₦100,000.
    const r = reconcile(
      input({ gross: 100_000_00n, fee: 0n }, [
        invoice(INVOICE, 55_000_00n),
        invoice(INV2, 55_000_00n),
      ]),
    );
    expect(r.classification).toBe("underpayment"); // ₦100k < ₦110k total still owing
    expect(r.matchedInvoiceId).toBe(INVOICE);
    expect(r.invoiceUpdates).toEqual([
      { invoiceId: INVOICE, amountSettled: 55_000_00n, status: "settled" },
      { invoiceId: INV2, amountSettled: 45_000_00n, status: "partially_paid" },
    ]);
    expect(r.refund).toBeUndefined();
    assertBalanced(r.postings);
    expect(amountOn(r.postings, LedgerAccount.customerReceivable(CUSTOMER), "credit")).toBe(
      100_000_00n,
    );
  });

  it("only touches as many invoices as the money reaches", () => {
    const r = reconcile(
      input({ gross: 30_000_00n, fee: 0n }, [
        invoice(INVOICE, 55_000_00n),
        invoice(INV2, 55_000_00n),
      ]),
    );
    expect(r.invoiceUpdates).toHaveLength(1);
    expect(r.invoiceUpdates[0]).toEqual({
      invoiceId: INVOICE,
      amountSettled: 30_000_00n,
      status: "partially_paid",
    });
    expect(r.classification).toBe("underpayment");
  });

  it("clears every invoice exactly", () => {
    const r = reconcile(
      input({ gross: 100_000_00n, fee: 0n }, [
        invoice(INVOICE, 55_000_00n),
        invoice(INV2, 45_000_00n),
      ]),
    );
    expect(r.classification).toBe("exact");
    expect(r.invoiceUpdates.every((u) => u.status === "settled")).toBe(true);
    expect(r.refund).toBeUndefined();
    assertBalanced(r.postings);
  });

  it("clears all invoices and books the remainder as refundable surplus", () => {
    const r = reconcile(
      input({ gross: 50_000_00n, fee: 0n }, [
        invoice(INVOICE, 10_000_00n),
        invoice(INV2, 20_000_00n),
      ]),
    );
    expect(r.classification).toBe("overpayment");
    expect(r.invoiceUpdates).toHaveLength(2);
    expect(r.invoiceUpdates.every((u) => u.status === "settled")).toBe(true);
    expect(r.refund).toEqual({ amount: 20_000_00n }); // 50k − 30k
    assertBalanced(r.postings);
    expect(amountOn(r.postings, LedgerAccount.customerCredit(CUSTOMER), "credit")).toBe(20_000_00n);
    void INV3;
  });
});

describe("reconcile — orphan", () => {
  it("parks money in suspense and opens an exception at full materiality", () => {
    const r = reconcile(input({ gross: 12_000n, fee: 60n, customerId: null }, []));
    expect(r.classification).toBe("orphan");
    expect(r.status).toBe("in_exception");
    expect(r.matchedInvoiceId).toBeNull();
    expect(r.exception).toEqual({ reason: "orphan", materiality: 12_000n });
    expect(r.invoiceUpdates).toEqual([]);
    assertBalanced(r.postings);
    expect(amountOn(r.postings, LedgerAccount.suspenseUnmatched, "credit")).toBe(12_000n);
  });
});

describe("reconcile — customer known, no open invoice (prepayment)", () => {
  it("books the whole amount as a usable customer credit, no refund", () => {
    const r = reconcile(input({ gross: 20_000_00n, fee: 100n }, []));
    expect(r.classification).toBe("overpayment");
    expect(r.status).toBe("reconciled");
    expect(r.matchedInvoiceId).toBeNull();
    expect(r.invoiceUpdates).toEqual([]);
    expect(r.refund).toBeUndefined();
    assertBalanced(r.postings);
    expect(amountOn(r.postings, LedgerAccount.customerCredit(CUSTOMER), "credit")).toBe(20_000_00n);
  });
});

describe("reconcile — fee edge cases", () => {
  it("handles fee equal to gross (net zero): drops the zero cash posting but still balances", () => {
    const r = reconcile(input({ gross: 100n, fee: 100n }, [invoice(INVOICE, 100n)]));
    assertBalanced(r.postings);
    expect(amountOn(r.postings, LedgerAccount.cashNombaWallet, "debit")).toBe(0n);
    expect(amountOn(r.postings, LedgerAccount.expenseFees, "debit")).toBe(100n);
    expect(amountOn(r.postings, LedgerAccount.customerReceivable(CUSTOMER), "credit")).toBe(100n);
  });

  it("handles zero fee: no expense posting emitted", () => {
    const r = reconcile(input({ gross: 100n, fee: 0n }, [invoice(INVOICE, 100n)]));
    expect(r.postings.some((p) => p.account === LedgerAccount.expenseFees)).toBe(false);
  });
});

describe("reconcile — guards", () => {
  it("rejects non-positive gross", () => {
    expect(() => reconcile(input({ gross: 0n }, [invoice(INVOICE, 100n)]))).toThrow(
      /gross must be positive/,
    );
  });

  it("rejects fee exceeding gross", () => {
    expect(() => reconcile(input({ gross: 100n, fee: 101n }, [invoice(INVOICE, 100n)]))).toThrow(
      /exceeds gross/,
    );
  });
});
