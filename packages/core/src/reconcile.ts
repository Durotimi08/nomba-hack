/**
 * The reconciliation engine — pure, deterministic, side-effect free.
 *
 * Given a normalised inbound payment and the customer's target invoice (already
 * resolved by the caller), it returns a classification, a set of balanced
 * double-entry ledger postings, and the invoice / exception / refund intents the
 * caller must persist atomically. It does NO IO and does NO duplicate detection —
 * idempotency is the caller's DB gate (`session_id UNIQUE`); a confirmed
 * duplicate never reaches this function.
 *
 * Ledger model (every inbound payment, balances at `gross`):
 *   debit  cash:nomba_wallet      net   (= gross − fee, what actually landed)
 *   debit  expense:fees           fee   (Nomba's cut, merchant-side cost)
 *   credit <destination(s)>       gross (receivable + customer_credit, or suspense)
 * Isolating the fee keeps gross-vs-net honest and surfaces the Fee-Leakage KPI.
 */
import {
  LedgerAccount,
  type ExceptionReason,
  type InvoiceStatus,
  type Kobo,
  type LedgerDirection,
  type PaymentClassification,
  type PaymentStatus,
} from "@kobo/shared";

export interface NormalizedPayment {
  sessionId: string;
  /** Resolved customer; `null` means the money is unattributable (orphan). */
  customerId: string | null;
  /** Amount the customer sent (kobo). */
  gross: Kobo;
  /** Fee Nomba took on the inbound credit (kobo). */
  fee: Kobo;
}

export interface OpenInvoice {
  id: string;
  amountExpected: Kobo;
  amountSettled: Kobo;
}

export interface ReconcileInput {
  payment: NormalizedPayment;
  /**
   * The customer's open/partially-paid invoices, **oldest-first** (FIFO). The
   * payment waterfalls across them: it fully settles the oldest, flows into the
   * next, and so on. Empty when the customer has nothing outstanding (the money
   * becomes a prepayment credit). Parents pay any amount, anytime — so a single
   * payment may touch several invoices, or none.
   */
  openInvoices: OpenInvoice[];
}

export interface Posting {
  account: string;
  direction: LedgerDirection;
  amount: Kobo;
}

export interface InvoiceUpdate {
  invoiceId: string;
  amountSettled: Kobo;
  status: InvoiceStatus;
}

export interface ExceptionIntent {
  reason: ExceptionReason;
  materiality: Kobo;
}

export interface RefundIntent {
  amount: Kobo;
}

export interface ReconcileResult {
  classification: PaymentClassification;
  status: PaymentStatus;
  /** The first (oldest) invoice the payment touched, or null. */
  matchedInvoiceId: string | null;
  postings: Posting[];
  /** One update per invoice the waterfall touched, oldest-first. */
  invoiceUpdates: InvoiceUpdate[];
  exception?: ExceptionIntent;
  refund?: RefundIntent;
}

/** Accumulates postings, dropping zero amounts (the ledger CHECK requires amount > 0). */
class PostingBuilder {
  private readonly postings: Posting[] = [];

  debit(account: string, amount: Kobo): this {
    if (amount > 0n) this.postings.push({ account, direction: "debit", amount });
    return this;
  }

  credit(account: string, amount: Kobo): this {
    if (amount > 0n) this.postings.push({ account, direction: "credit", amount });
    return this;
  }

  /** Returns the postings after asserting debits and credits balance exactly. */
  build(): Posting[] {
    const debits = this.sum("debit");
    const credits = this.sum("credit");
    if (debits !== credits) {
      throw new Error(`Unbalanced postings: debits=${debits} credits=${credits}`);
    }
    return this.postings;
  }

  private sum(direction: LedgerDirection): Kobo {
    return this.postings
      .filter((p) => p.direction === direction)
      .reduce((acc, p) => acc + p.amount, 0n);
  }
}

export function reconcile({ payment, openInvoices }: ReconcileInput): ReconcileResult {
  const { gross, fee, customerId } = payment;

  if (gross <= 0n) {
    throw new RangeError(`reconcile: gross must be positive, got ${gross}`);
  }
  const net = gross - fee;
  if (net < 0n) {
    throw new RangeError(`reconcile: fee ${fee} exceeds gross ${gross}`);
  }

  // ── Orphan: no customer to attribute the money to ────────────────────────
  if (customerId === null) {
    const postings = new PostingBuilder()
      .debit(LedgerAccount.cashNombaWallet, net)
      .debit(LedgerAccount.expenseFees, fee)
      .credit(LedgerAccount.suspenseUnmatched, gross)
      .build();
    return {
      classification: "orphan",
      status: "in_exception",
      matchedInvoiceId: null,
      postings,
      invoiceUpdates: [],
      exception: { reason: "orphan", materiality: gross },
    };
  }

  // ── Waterfall the payment across open invoices, oldest-first ──────────────
  const invoiceUpdates: InvoiceUpdate[] = [];
  let remaining = gross;
  let receivableApplied = 0n;
  let totalOutstanding = 0n;

  for (const inv of openInvoices) {
    const outstanding = inv.amountExpected - inv.amountSettled;
    if (outstanding <= 0n) continue; // defensive: caller passes only open invoices
    totalOutstanding += outstanding;
    if (remaining <= 0n) continue; // keep tallying totalOutstanding for classification

    const apply = remaining < outstanding ? remaining : outstanding;
    const newSettled = inv.amountSettled + apply;
    invoiceUpdates.push({
      invoiceId: inv.id,
      amountSettled: newSettled,
      status: newSettled >= inv.amountExpected ? "settled" : "partially_paid",
    });
    remaining -= apply;
    receivableApplied += apply;
  }

  const surplus = remaining; // ≥ 0 — money left after clearing every open invoice
  const touchedInvoice = invoiceUpdates.length > 0;

  // Classification by totals (internal; the operator sees a derived balance).
  let classification: PaymentClassification;
  if (!touchedInvoice || gross > totalOutstanding) classification = "overpayment";
  else if (gross < totalOutstanding) classification = "underpayment";
  else classification = "exact";

  const postings = new PostingBuilder()
    .debit(LedgerAccount.cashNombaWallet, net)
    .debit(LedgerAccount.expenseFees, fee)
    .credit(LedgerAccount.customerReceivable(customerId), receivableApplied)
    .credit(LedgerAccount.customerCredit(customerId), surplus)
    .build();

  return {
    classification,
    status: "reconciled",
    matchedInvoiceId: invoiceUpdates[0]?.invoiceId ?? null,
    postings,
    invoiceUpdates,
    // Surplus over REAL invoices is refund-eligible (maker-checker). A pure
    // prepayment (no invoice touched) is just a credit, not a refund.
    ...(surplus > 0n && touchedInvoice ? { refund: { amount: surplus } } : {}),
  };
}
