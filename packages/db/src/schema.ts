/**
 * Drizzle ORM schema — the typed query layer over the authoritative DDL in
 * migrations/0001_init.sql. Columns/types mirror that file exactly; an
 * integration test migrates with the SQL then round-trips through these tables
 * to guarantee the two never drift. Money columns are `bigint` in kobo.
 */
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const verticalEnum = pgEnum("vertical", ["rent", "school", "ajo", "generic"]);
export const vaStatusEnum = pgEnum("va_status", ["active", "suspended"]);
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "open",
  "partially_paid",
  "settled",
  "overpaid",
]);
export const paymentClassificationEnum = pgEnum("payment_classification", [
  "exact",
  "underpayment",
  "overpayment",
  "duplicate",
  "orphan",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "reconciled",
  "in_exception",
  "refunded",
]);
export const ledgerDirectionEnum = pgEnum("ledger_direction", ["debit", "credit"]);
export const exceptionReasonEnum = pgEnum("exception_reason", [
  "orphan",
  "ambiguous_invoice",
  "amount_mismatch_review",
]);
export const refundStatusEnum = pgEnum("refund_status", [
  "pending_approval",
  "approved",
  "sent",
  "failed",
]);
export const operatorRoleEnum = pgEnum("operator_role", ["maker", "checker"]);
export const ruleKindEnum = pgEnum("rule_kind", ["charge", "discount"]);
export const ruleValueTypeEnum = pgEnum("rule_value_type", ["fixed", "percent"]);
export const ruleRecurrenceEnum = pgEnum("rule_recurrence", [
  "one_time",
  "monthly",
  "termly",
  "annually",
]);

const money = (name: string) => bigint(name, { mode: "bigint" });

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountRef: text("account_ref").notNull().unique(),
    name: text("name").notNull(),
    vertical: verticalEnum("vertical").notNull().default("generic"),
    // School layer: billing cohort + free-form metadata tags (rules match on these).
    cohort: text("cohort"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("customers_cohort_idx").on(t.cohort)],
);

export const virtualAccounts = pgTable(
  "virtual_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    bankAccountNumber: text("bank_account_number").notNull().unique(),
    bankAccountName: text("bank_account_name").notNull(),
    bankName: text("bank_name").notNull(),
    accountHolderId: text("account_holder_id"),
    status: vaStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("virtual_accounts_customer_idx").on(t.customerId)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    reference: text("reference").notNull(),
    amountExpected: money("amount_expected").notNull(),
    amountSettled: money("amount_settled").notNull().default(0n),
    status: invoiceStatusEnum("status").notNull().default("open"),
    period: text("period"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invoices_customer_idx").on(t.customerId, t.createdAt)],
);

export const rawEvents = pgTable(
  "raw_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: text("session_id").unique(),
    requestId: text("request_id"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("raw_events_received_idx").on(t.receivedAt)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: text("session_id").notNull().unique(),
    requestId: text("request_id"),
    rawEventId: uuid("raw_event_id")
      .notNull()
      .references(() => rawEvents.id),
    virtualAccountId: uuid("virtual_account_id").references(() => virtualAccounts.id),
    customerId: uuid("customer_id").references(() => customers.id),
    grossAmount: money("gross_amount").notNull(),
    fee: money("fee").notNull().default(0n),
    netAmount: money("net_amount").notNull(),
    senderName: text("sender_name"),
    senderBank: text("sender_bank"),
    senderAccountNumber: text("sender_account_number"),
    senderBankCode: text("sender_bank_code"),
    classification: paymentClassificationEnum("classification").notNull(),
    matchedInvoiceId: uuid("matched_invoice_id").references(() => invoices.id),
    status: paymentStatusEnum("status").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payments_customer_idx").on(t.customerId),
    index("payments_invoice_idx").on(t.matchedInvoiceId),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: credit-application entries (credit → receivable) carry no payment.
    paymentId: uuid("payment_id").references(() => payments.id),
    account: text("account").notNull(),
    direction: ledgerDirectionEnum("direction").notNull(),
    amount: money("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_payment_idx").on(t.paymentId),
    index("ledger_entries_account_idx").on(t.account),
  ],
);

export const exceptions = pgTable(
  "exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    reason: exceptionReasonEnum("reason").notNull(),
    materiality: money("materiality").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
  },
  (t) => [index("exceptions_opened_idx").on(t.openedAt)],
);

export const pendingRefunds = pgTable("pending_refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  amount: money("amount").notNull(),
  merchantTxRef: text("merchant_tx_ref").notNull().unique(),
  status: refundStatusEnum("status").notNull().default("pending_approval"),
  proposedBy: text("proposed_by"),
  approvedBy: text("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const operators = pgTable("operators", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: operatorRoleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// School billing: one Rule primitive for charges + discounts, targeted by metadata.
// `value` is kobo for fixed, integer basis points for percent (2000 = 20.00%).
export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: ruleKindEnum("kind").notNull(),
    valueType: ruleValueTypeEnum("value_type").notNull(),
    value: money("value").notNull(),
    recurrence: ruleRecurrenceEnum("recurrence").notNull(),
    cohort: text("cohort"),
    match: jsonb("match").$type<Record<string, unknown>>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rules_cohort_idx").on(t.cohort)],
);

// A one-time rule is consumed (per student) only when it was actually applied.
export const ruleConsumptions = pgTable(
  "rule_consumptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => rules.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rule_consumptions_customer_idx").on(t.customerId)],
);

export const schema = {
  customers,
  virtualAccounts,
  invoices,
  rawEvents,
  payments,
  ledgerEntries,
  exceptions,
  pendingRefunds,
  operators,
  rules,
  ruleConsumptions,
};
