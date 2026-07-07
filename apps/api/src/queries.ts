/**
 * Reporting reads. Aggregates use raw SQL for clarity and return money as kobo
 * STRINGS (numeric/int8 serialise as strings), which is exactly the wire shape
 * the dashboard expects — no bigint→JSON hazard.
 */
import type { Db } from "@kobo/db";
import { sql } from "drizzle-orm";

export interface CustomerRow {
  id: string;
  name: string;
  accountRef: string;
  vertical: string;
  bankAccountNumber: string | null;
  bankName: string | null;
  balanceKobo: string;
  openInvoiceCount: number;
}

/** Pagination request + response envelope shared by every list endpoint. */
export interface Page {
  limit: number;
  offset: number;
}
export interface Paginated<T> {
  items: T[];
  total: number;
}

async function countOf(db: Db, from: ReturnType<typeof sql>): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql`SELECT COUNT(*)::text AS total FROM ${from}`);
  return Number(rows[0]?.total ?? "0");
}

export async function listCustomers(db: Db, page: Page): Promise<Paginated<CustomerRow>> {
  const { rows } = await db.execute<{
    id: string;
    name: string;
    account_ref: string;
    vertical: string;
    bank_account_number: string | null;
    bank_name: string | null;
    balance_kobo: string;
    open_invoice_count: number;
  }>(sql`
    SELECT c.id, c.name, c.account_ref, c.vertical,
           va.bank_account_number, va.bank_name,
           COALESCE(SUM(CASE WHEN i.status IN ('open','partially_paid')
                             THEN i.amount_expected - i.amount_settled ELSE 0 END), 0)::text AS balance_kobo,
           COUNT(i.id) FILTER (WHERE i.status IN ('open','partially_paid'))::int AS open_invoice_count
    FROM customers c
    LEFT JOIN virtual_accounts va ON va.customer_id = c.id
    LEFT JOIN invoices i ON i.customer_id = c.id
    GROUP BY c.id, va.bank_account_number, va.bank_name
    ORDER BY c.created_at DESC
    LIMIT ${page.limit} OFFSET ${page.offset}
  `);
  const total = await countOf(db, sql`customers`);
  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      accountRef: r.account_ref,
      vertical: r.vertical,
      bankAccountNumber: r.bank_account_number,
      bankName: r.bank_name,
      balanceKobo: r.balance_kobo,
      openInvoiceCount: Number(r.open_invoice_count),
    })),
    total,
  };
}

export interface Statement {
  customer: { id: string; name: string; accountRef: string; vertical: string };
  virtualAccount: { bankAccountNumber: string; bankName: string } | null;
  invoices: Array<{
    id: string;
    reference: string;
    amountExpectedKobo: string;
    amountSettledKobo: string;
    status: string;
    period: string | null;
  }>;
  payments: Array<{
    id: string;
    sessionId: string;
    grossKobo: string;
    feeKobo: string;
    netKobo: string;
    classification: string;
    status: string;
    senderName: string | null;
    occurredAt: string | null;
  }>;
  ledger: Array<{ account: string; direction: string; amountKobo: string; createdAt: string }>;
  balances: { receivableKobo: string; creditKobo: string };
}

export async function getStatement(db: Db, customerId: string): Promise<Statement | null> {
  const customer = await db.execute<{ id: string; name: string; account_ref: string; vertical: string }>(
    sql`SELECT id, name, account_ref, vertical FROM customers WHERE id = ${customerId}`,
  );
  const c = customer.rows[0];
  if (!c) return null;

  const va = await db.execute<{ bank_account_number: string; bank_name: string }>(
    sql`SELECT bank_account_number, bank_name FROM virtual_accounts WHERE customer_id = ${customerId} LIMIT 1`,
  );
  const inv = await db.execute<{
    id: string;
    reference: string;
    amount_expected: string;
    amount_settled: string;
    status: string;
    period: string | null;
  }>(
    sql`SELECT id, reference, amount_expected::text, amount_settled::text, status, period
        FROM invoices WHERE customer_id = ${customerId} ORDER BY created_at`,
  );
  const pay = await db.execute<{
    id: string;
    session_id: string;
    gross_amount: string;
    fee: string;
    net_amount: string;
    classification: string;
    status: string;
    sender_name: string | null;
    occurred_at: string | null;
  }>(
    sql`SELECT id, session_id, gross_amount::text, fee::text, net_amount::text, classification, status,
               sender_name, occurred_at
        FROM payments WHERE customer_id = ${customerId} ORDER BY created_at DESC`,
  );
  // Audit trail: entries from the customer's payments, PLUS any entry on one of the
  // customer's own accounts (credit-application postings carry no payment_id).
  const customerAccount = `%${customerId}%`;
  const led = await db.execute<{ account: string; direction: string; amount: string; created_at: string }>(
    sql`SELECT le.account, le.direction, le.amount::text, le.created_at
        FROM ledger_entries le
        LEFT JOIN payments p ON p.id = le.payment_id
        WHERE p.customer_id = ${customerId} OR le.account LIKE ${customerAccount}
        ORDER BY le.created_at DESC`,
  );
  // Credit balance keys on the account name only — so applied credit (which debits
  // this account with no payment_id) correctly draws the balance down.
  const creditAccount = `liability:customer_credit:${customerId}`;
  const bal = await db.execute<{ receivable_kobo: string; credit_kobo: string }>(sql`
    SELECT
      (SELECT COALESCE(SUM(amount_expected - amount_settled), 0)::text
         FROM invoices WHERE customer_id = ${customerId} AND status IN ('open','partially_paid')) AS receivable_kobo,
      (SELECT COALESCE(SUM(CASE WHEN le.direction='credit' THEN le.amount ELSE -le.amount END), 0)::text
         FROM ledger_entries le
         WHERE le.account = ${creditAccount}) AS credit_kobo
  `);

  return {
    customer: { id: c.id, name: c.name, accountRef: c.account_ref, vertical: c.vertical },
    virtualAccount: va.rows[0]
      ? { bankAccountNumber: va.rows[0].bank_account_number, bankName: va.rows[0].bank_name }
      : null,
    invoices: inv.rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      amountExpectedKobo: r.amount_expected,
      amountSettledKobo: r.amount_settled,
      status: r.status,
      period: r.period,
    })),
    payments: pay.rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      grossKobo: r.gross_amount,
      feeKobo: r.fee,
      netKobo: r.net_amount,
      classification: r.classification,
      status: r.status,
      senderName: r.sender_name,
      occurredAt: r.occurred_at,
    })),
    ledger: led.rows.map((r) => ({
      account: r.account,
      direction: r.direction,
      amountKobo: r.amount,
      createdAt: r.created_at,
    })),
    balances: {
      receivableKobo: bal.rows[0]?.receivable_kobo ?? "0",
      creditKobo: bal.rows[0]?.credit_kobo ?? "0",
    },
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

export async function getKpis(db: Db): Promise<Kpis> {
  const { rows } = await db.execute<{
    total: number;
    reconciled: number;
    open_breaks: number;
    exposure: string;
    fee_leakage: string;
  }>(sql`
    SELECT
      (SELECT COUNT(*) FROM payments)::int AS total,
      (SELECT COUNT(*) FROM payments WHERE status = 'reconciled')::int AS reconciled,
      (SELECT COUNT(*) FROM exceptions WHERE resolved_at IS NULL)::int AS open_breaks,
      (SELECT COALESCE(SUM(materiality), 0)::text FROM exceptions WHERE resolved_at IS NULL) AS exposure,
      (SELECT COALESCE(SUM(fee), 0)::text FROM payments) AS fee_leakage
  `);
  const r = rows[0]!;
  const total = Number(r.total);
  const reconciled = Number(r.reconciled);
  return {
    autoMatchRate: total === 0 ? 1 : reconciled / total,
    openBreaks: Number(r.open_breaks),
    unreconciledExposureKobo: r.exposure,
    feeLeakageKobo: r.fee_leakage,
    totalPayments: total,
    reconciledPayments: reconciled,
  };
}

export interface TimeseriesPoint {
  date: string;
  inflowKobo: string;
  paymentCount: number;
  reconciledCount: number;
  exceptionCount: number;
}

/**
 * Daily payment activity for the last `days` days, gap-filled with zero rows via
 * generate_series so the dashboard area chart is continuous (no missing buckets).
 * Buckets on created_at (always present) rather than occurred_at (nullable).
 */
export async function getTimeseries(db: Db, days: number): Promise<TimeseriesPoint[]> {
  const span = Math.max(1, Math.min(days, 365)) - 1;
  const { rows } = await db.execute<{
    date: string;
    inflow_kobo: string;
    payment_count: number;
    reconciled_count: number;
    exception_count: number;
  }>(sql`
    WITH series AS (
      SELECT generate_series(current_date - ${span}::int, current_date, interval '1 day')::date AS day
    )
    SELECT
      to_char(s.day, 'YYYY-MM-DD') AS date,
      COALESCE(SUM(p.gross_amount), 0)::text AS inflow_kobo,
      COUNT(p.id)::int AS payment_count,
      COUNT(p.id) FILTER (WHERE p.status = 'reconciled')::int AS reconciled_count,
      COUNT(p.id) FILTER (WHERE p.status = 'in_exception')::int AS exception_count
    FROM series s
    LEFT JOIN payments p ON (p.created_at AT TIME ZONE 'UTC')::date = s.day
    GROUP BY s.day
    ORDER BY s.day
  `);
  return rows.map((r) => ({
    date: r.date,
    inflowKobo: r.inflow_kobo,
    paymentCount: Number(r.payment_count),
    reconciledCount: Number(r.reconciled_count),
    exceptionCount: Number(r.exception_count),
  }));
}

export interface BreakdownSlice {
  classification: string;
  count: number;
  valueKobo: string;
}

/** Payment count + gross value grouped by reconciliation classification. */
export async function getBreakdown(db: Db): Promise<BreakdownSlice[]> {
  const { rows } = await db.execute<{
    classification: string;
    count: number;
    value_kobo: string;
  }>(sql`
    SELECT classification,
           COUNT(*)::int AS count,
           COALESCE(SUM(gross_amount), 0)::text AS value_kobo
    FROM payments
    GROUP BY classification
    ORDER BY count DESC
  `);
  return rows.map((r) => ({
    classification: r.classification,
    count: Number(r.count),
    valueKobo: r.value_kobo,
  }));
}

export interface ExceptionRow {
  id: string;
  paymentId: string;
  reason: string;
  materialityKobo: string;
  openedAt: string;
  ageHours: number;
  senderName: string | null;
  grossKobo: string;
}

export async function listOpenExceptions(db: Db, page: Page): Promise<Paginated<ExceptionRow>> {
  const { rows } = await db.execute<{
    id: string;
    payment_id: string;
    reason: string;
    materiality: string;
    opened_at: string;
    age_hours: number;
    sender_name: string | null;
    gross_amount: string;
  }>(sql`
    SELECT e.id, e.payment_id, e.reason, e.materiality::text, e.opened_at,
           EXTRACT(EPOCH FROM (now() - e.opened_at)) / 3600 AS age_hours,
           p.sender_name, p.gross_amount::text
    FROM exceptions e JOIN payments p ON p.id = e.payment_id
    WHERE e.resolved_at IS NULL
    ORDER BY e.opened_at ASC
    LIMIT ${page.limit} OFFSET ${page.offset}
  `);
  const total = await countOf(db, sql`exceptions WHERE resolved_at IS NULL`);
  return {
    items: rows.map((r) => ({
      id: r.id,
      paymentId: r.payment_id,
      reason: r.reason,
      materialityKobo: r.materiality,
      openedAt: r.opened_at,
      ageHours: Math.round(Number(r.age_hours) * 10) / 10,
      senderName: r.sender_name,
      grossKobo: r.gross_amount,
    })),
    total,
  };
}

export interface RefundRow {
  id: string;
  customerId: string;
  customerName: string;
  amountKobo: string;
  status: string;
  merchantTxRef: string;
  createdAt: string;
}

export async function listRefunds(
  db: Db,
  page: Page,
  status: string,
): Promise<Paginated<RefundRow>> {
  const { rows } = await db.execute<{
    id: string;
    customer_id: string;
    customer_name: string;
    amount: string;
    status: string;
    merchant_tx_ref: string;
    created_at: string;
  }>(sql`
    SELECT r.id, r.customer_id, c.name AS customer_name, r.amount::text, r.status, r.merchant_tx_ref, r.created_at
    FROM pending_refunds r JOIN customers c ON c.id = r.customer_id
    WHERE r.status = ${status}
    ORDER BY r.created_at ASC
    LIMIT ${page.limit} OFFSET ${page.offset}
  `);
  const total = await countOf(db, sql`pending_refunds WHERE status = ${status}`);
  return {
    items: rows.map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      amountKobo: r.amount,
      status: r.status,
      merchantTxRef: r.merchant_tx_ref,
      createdAt: r.created_at,
    })),
    total,
  };
}
