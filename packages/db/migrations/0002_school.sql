-- ── School billing layer ───────────────────────────────────────────────────
-- Adds the school domain on top of the Kobo platform: cohort + metadata tags on
-- students (customers), and a single `rules` primitive (charges + discounts,
-- fixed/percent, recurring/one-time) targeted by metadata. Money stays integer
-- kobo; percentages are stored as integer BASIS POINTS (2000 = 20.00%).

ALTER TABLE customers ADD COLUMN cohort   text;
ALTER TABLE customers ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX customers_cohort_idx ON customers(cohort);

CREATE TYPE rule_kind       AS ENUM ('charge', 'discount');
CREATE TYPE rule_value_type AS ENUM ('fixed', 'percent');
CREATE TYPE rule_recurrence AS ENUM ('recurring', 'one_time');

-- A Rule applies to students by metadata `match` within a `cohort`.
-- Breadth is controlled by tagging (one student or many) — not by the rule.
CREATE TABLE rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        rule_kind NOT NULL,
  value_type  rule_value_type NOT NULL,
  value       bigint NOT NULL,                 -- fixed → kobo; percent → basis points
  recurrence  rule_recurrence NOT NULL,
  cohort      text,                            -- offered to this cohort (NULL = any)
  match       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- metadata predicate; {} = all in cohort
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rules_value_nonneg CHECK (value >= 0),
  -- a percentage cannot exceed 100% (10,000 bp)
  CONSTRAINT rules_percent_bounded CHECK (value_type <> 'percent' OR value <= 10000)
);
CREATE INDEX rules_cohort_idx ON rules(cohort);

-- A one-time rule is consumed (per student) only when it was actually applied.
CREATE TABLE rule_consumptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     uuid NOT NULL REFERENCES rules(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  invoice_id  uuid REFERENCES invoices(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rule_consumptions_once UNIQUE (rule_id, customer_id)
);
CREATE INDEX rule_consumptions_customer_idx ON rule_consumptions(customer_id);
