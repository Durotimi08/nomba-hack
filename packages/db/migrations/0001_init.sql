-- Kobo — initial schema. Authoritative DDL.
-- Money is ALWAYS integer kobo (bigint). Ledger is append-only; raw_events immutable.
-- The Drizzle schema in src/schema.ts mirrors this exactly; an integration test
-- guards against drift by migrating with this file then querying via Drizzle.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ── Enums ──────────────────────────────────────────────────────────────────
CREATE TYPE vertical              AS ENUM ('rent', 'school', 'ajo', 'generic');
CREATE TYPE va_status             AS ENUM ('active', 'suspended');
CREATE TYPE invoice_status        AS ENUM ('open', 'partially_paid', 'settled', 'overpaid');
CREATE TYPE payment_classification AS ENUM ('exact', 'underpayment', 'overpayment', 'duplicate', 'orphan');
CREATE TYPE payment_status        AS ENUM ('reconciled', 'in_exception', 'refunded');
CREATE TYPE ledger_direction      AS ENUM ('debit', 'credit');
CREATE TYPE exception_reason      AS ENUM ('orphan', 'ambiguous_invoice', 'amount_mismatch_review');
CREATE TYPE refund_status         AS ENUM ('pending_approval', 'approved', 'sent', 'failed');
CREATE TYPE operator_role         AS ENUM ('maker', 'checker');

-- ── customers ──────────────────────────────────────────────────────────────
CREATE TABLE customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_ref text NOT NULL UNIQUE,                 -- our key → Nomba accountRef (16–64)
  name        text NOT NULL,
  vertical    vertical NOT NULL DEFAULT 'generic',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_ref_len CHECK (char_length(account_ref) BETWEEN 16 AND 64)
);

-- ── virtual_accounts ───────────────────────────────────────────────────────
CREATE TABLE virtual_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  bank_account_number text NOT NULL UNIQUE,
  bank_account_name   text NOT NULL,                -- "<merchant>/<customer>" — parse, don't trust
  bank_name           text NOT NULL,
  account_holder_id   text,                         -- Nomba accountHolderId
  status              va_status NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX virtual_accounts_customer_idx ON virtual_accounts(customer_id);

-- ── invoices ───────────────────────────────────────────────────────────────
CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  reference       text NOT NULL,                    -- e.g. RENT-2026-07
  amount_expected bigint NOT NULL,                  -- kobo
  amount_settled  bigint NOT NULL DEFAULT 0,        -- kobo, running total
  status          invoice_status NOT NULL DEFAULT 'open',
  period          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_amounts_nonneg CHECK (amount_expected >= 0 AND amount_settled >= 0),
  CONSTRAINT invoice_ref_unique UNIQUE (customer_id, reference)
);
-- FIFO settlement reads the oldest open/partially_paid invoice per customer.
CREATE INDEX invoices_open_fifo_idx
  ON invoices(customer_id, created_at)
  WHERE status IN ('open', 'partially_paid');

-- ── raw_events (immutable audit of every webhook) ──────────────────────────
CREATE TABLE raw_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      text UNIQUE,                      -- NIBSS session — primary idempotency key (null for non-tx events)
  request_id      text,                             -- Nomba requestId — secondary dedupe
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz                       -- set when ingestion completes; null = sweeper re-enqueues
);
CREATE INDEX raw_events_unprocessed_idx ON raw_events(received_at) WHERE processed_at IS NULL;

-- ── payments (one per real inbound transfer) ───────────────────────────────
CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         text NOT NULL UNIQUE,          -- HARD idempotency anchor → no double-credit
  request_id         text,
  raw_event_id       uuid NOT NULL REFERENCES raw_events(id) ON DELETE RESTRICT,
  virtual_account_id uuid REFERENCES virtual_accounts(id) ON DELETE RESTRICT,
  customer_id        uuid REFERENCES customers(id) ON DELETE RESTRICT,
  gross_amount       bigint NOT NULL,               -- kobo, = transactionAmount
  fee                bigint NOT NULL DEFAULT 0,      -- kobo
  net_amount         bigint NOT NULL,               -- kobo, gross − fee
  sender_name          text,
  sender_bank          text,
  sender_account_number text,                       -- for computing overpayment refunds
  sender_bank_code     text,
  classification     payment_classification NOT NULL,
  matched_invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  status             payment_status NOT NULL,
  occurred_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_amounts_nonneg CHECK (gross_amount >= 0 AND fee >= 0 AND net_amount >= 0),
  CONSTRAINT payment_net_balances   CHECK (net_amount = gross_amount - fee)
);
CREATE INDEX payments_customer_idx ON payments(customer_id);
CREATE INDEX payments_invoice_idx  ON payments(matched_invoice_id);

-- ── ledger_entries (append-only double-entry — never UPDATE/DELETE) ─────────
CREATE TABLE ledger_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  account     text NOT NULL,                        -- e.g. cash:nomba_wallet
  direction   ledger_direction NOT NULL,
  amount      bigint NOT NULL,                      -- kobo, strictly positive
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_amount_positive CHECK (amount > 0)
);
CREATE INDEX ledger_entries_payment_idx ON ledger_entries(payment_id);
CREATE INDEX ledger_entries_account_idx ON ledger_entries(account);
-- Append-only enforcement: block UPDATE and DELETE at the DB level.
CREATE OR REPLACE FUNCTION kobo_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION kobo_block_mutation();
CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION kobo_block_mutation();

-- ── exceptions (aging + materiality) ───────────────────────────────────────
CREATE TABLE exceptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  reason      exception_reason NOT NULL,
  materiality bigint NOT NULL,                       -- kobo at risk
  opened_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,                                  -- operator id (maker-checker)
  CONSTRAINT materiality_nonneg CHECK (materiality >= 0)
);
CREATE INDEX exceptions_open_idx ON exceptions(opened_at) WHERE resolved_at IS NULL;

-- ── pending_refunds (overpayment → maker-checker payout) ───────────────────
CREATE TABLE pending_refunds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount          bigint NOT NULL,                   -- kobo surplus
  merchant_tx_ref text NOT NULL UNIQUE,              -- idempotency key for the payout
  status          refund_status NOT NULL DEFAULT 'pending_approval',
  proposed_by     text,
  approved_by     text,                              -- must differ from proposed_by (enforced in app)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_amount_positive CHECK (amount > 0)
);

-- ── operators (auth + maker-checker identities) ────────────────────────────
CREATE TABLE operators (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,                       -- argon2id
  role          operator_role NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
