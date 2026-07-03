-- ── Credit auto-apply ───────────────────────────────────────────────────────
-- A credit-application moves a customer's standing credit onto an open invoice
-- (debit liability:customer_credit / credit customer:…:receivable). It carries no
-- cash event, so it has no originating payment. Allow ledger entries without a
-- payment_id; they remain append-only and attributable to the customer by account
-- name (the statement query already keys on that for credit/audit).
ALTER TABLE ledger_entries ALTER COLUMN payment_id DROP NOT NULL;
