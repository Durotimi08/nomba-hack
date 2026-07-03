/**
 * Domain vocabulary shared across the engine, persistence, API, and dashboard.
 * These string-literal unions are the single source of truth; the DB enums and
 * Zod schemas are derived from them so the wire, the store, and the code agree.
 */

export const PAYMENT_CLASSIFICATIONS = [
  "exact",
  "underpayment",
  "overpayment",
  "duplicate",
  "orphan",
] as const;
export type PaymentClassification = (typeof PAYMENT_CLASSIFICATIONS)[number];

export const PAYMENT_STATUSES = ["reconciled", "in_exception", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const INVOICE_STATUSES = ["open", "partially_paid", "settled", "overpaid"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const EXCEPTION_REASONS = [
  "orphan",
  "ambiguous_invoice",
  "amount_mismatch_review",
] as const;
export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];

export const LEDGER_DIRECTIONS = ["debit", "credit"] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

export const REFUND_STATUSES = ["pending_approval", "approved", "sent", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const VIRTUAL_ACCOUNT_STATUSES = ["active", "suspended"] as const;
export type VirtualAccountStatus = (typeof VIRTUAL_ACCOUNT_STATUSES)[number];

export const VERTICALS = ["rent", "school", "ajo", "generic"] as const;
export type Vertical = (typeof VERTICALS)[number];

export const OPERATOR_ROLES = ["maker", "checker"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

/**
 * Ledger account naming. Accounts are addressed by string so the chart of
 * accounts is open-ended and auditable. Customer-scoped accounts embed the id.
 */
export const LedgerAccount = {
  /** Cash held in the Nomba settlement wallet (asset). */
  cashNombaWallet: "cash:nomba_wallet",
  /** Money received that we cannot attribute yet (asset/holding). */
  suspenseUnmatched: "suspense:unmatched",
  /** Fees taken by Nomba on inbound credits (expense). */
  expenseFees: "expense:fees",
  /** Per-customer amount owed to us (asset / contra as it settles). */
  customerReceivable: (customerId: string) => `customer:${customerId}:receivable`,
  /** Per-customer surplus we owe back to them (liability). */
  customerCredit: (customerId: string) => `liability:customer_credit:${customerId}`,
} as const;
