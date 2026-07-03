export interface Paginated<T> {
  items: T[];
  total: number;
}
export interface PageParams {
  limit?: number;
  offset?: number;
}

export type Role = "maker" | "checker";

export type Vertical = "rent" | "school" | "ajo" | "generic";

export type InvoiceStatus =
  | "settled"
  | "partially_paid"
  | "open"
  | "overpaid"
  | string;

export type Classification =
  | "exact"
  | "underpayment"
  | "overpayment"
  | "duplicate"
  | "orphan"
  | string;

export interface LoginResponse {
  token: string;
  role: Role;
  email: string;
}

export interface Customer {
  id: string;
  name: string;
  accountRef: string;
  vertical: Vertical;
  bankAccountNumber: string | null;
  bankName: string | null;
  balanceKobo: string;
  openInvoiceCount: number;
}

export interface CreateCustomerInput {
  name: string;
  vertical: Vertical;
  accountRef?: string;
}

export interface CreateInvoiceInput {
  reference: string;
  /** Expected amount in naira (major units). */
  amountExpected: number;
  period?: string;
}

export interface StatementInvoice {
  id: string;
  reference: string;
  amountExpectedKobo: string;
  amountSettledKobo: string;
  status: InvoiceStatus;
  period: string;
}

export interface StatementPayment {
  id: string;
  sessionId: string;
  grossKobo: string;
  feeKobo: string;
  netKobo: string;
  classification: Classification;
  status: string;
  senderName: string | null;
  occurredAt: string;
}

export interface LedgerEntry {
  account: string;
  direction: "debit" | "credit";
  amountKobo: string;
  createdAt: string;
}

export interface Statement {
  customer: {
    id: string;
    name: string;
    accountRef: string;
    vertical: Vertical;
  };
  virtualAccount: {
    bankAccountNumber: string;
    bankName: string;
  } | null;
  invoices: StatementInvoice[];
  payments: StatementPayment[];
  ledger: LedgerEntry[];
  balances: {
    receivableKobo: string;
    creditKobo: string;
  };
}

export interface Kpis {
  autoMatchRate: number;
  openBreaks: number;
  unreconciledExposureKobo: string;
  feeLeakageKobo: string;
  totalPayments: number;
  reconciledPayments: number;
}

export interface TimeseriesPoint {
  date: string;
  inflowKobo: string;
  paymentCount: number;
  reconciledCount: number;
  exceptionCount: number;
}

export interface BreakdownSlice {
  classification: Classification;
  count: number;
  valueKobo: string;
}

export interface Exception {
  id: string;
  paymentId: string;
  reason: string;
  materialityKobo: string;
  openedAt: string;
  ageHours: number;
  senderName: string | null;
  grossKobo: string;
}

export interface Refund {
  id: string;
  customerId: string;
  customerName: string;
  amountKobo: string;
  status: string;
  merchantTxRef: string;
  createdAt: string;
}

// ── School product ──────────────────────────────────────────────────────────
export interface RosterStudentInput {
  name: string;
  cohort: string;
  metadata?: Record<string, unknown>;
}
export interface RosterResult {
  created: number;
  failed: number;
  students: { id: string; name: string; cohort: string; bankAccountNumber: string }[];
  errors: { name: string; error: string }[];
}

export type RuleKind = "charge" | "discount";
export type RuleValueType = "fixed" | "percent";
export type RuleRecurrence = "one_time" | "monthly" | "termly" | "annually";
export type BillingFrequency = "monthly" | "termly" | "annually";
export interface SchoolRule {
  id: string;
  name: string;
  kind: RuleKind;
  valueType: RuleValueType;
  /** kobo for fixed, basis points for percent (serialized string). */
  value: string;
  recurrence: RuleRecurrence;
  cohort: string | null;
  match: Record<string, unknown>;
  active: boolean;
}
export interface CreateRuleInput {
  name: string;
  kind: RuleKind;
  valueType: RuleValueType;
  /** naira for fixed; percentage (0–100) for percent. */
  amount: number;
  recurrence: RuleRecurrence;
  cohort?: string;
  match?: Record<string, unknown>;
}
export interface BillingRunInput {
  cohort: string;
  frequency: BillingFrequency;
  period: string;
}
export interface BillingRunResult {
  reference: string;
  studentsBilled: number;
  invoicesCreated: number;
  invoicesSkipped: number;
  totalExpectedKobo: string;
}
export interface Defaulters {
  cohort: string;
  billedKobo: string;
  collectedKobo: string;
  collectionRate: number;
  defaultersTotal: number;
  defaulters: { id: string; name: string; outstandingKobo: string }[];
}
export interface SchoolStudent {
  id: string;
  name: string;
  cohort: string | null;
  bankAccountNumber: string | null;
}
