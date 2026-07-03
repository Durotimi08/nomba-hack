-- ── Per-frequency fees ──────────────────────────────────────────────────────
-- A recurring fee now carries its own frequency (monthly / termly / annually)
-- instead of a single "recurring". A billing run charges only the fees matching
-- the period it is run for (plus any pending one-time fees). Existing "recurring"
-- rules become "termly" (the school default). Recreate the enum transactionally.
ALTER TABLE rules ALTER COLUMN recurrence TYPE text USING recurrence::text;
UPDATE rules SET recurrence = 'termly' WHERE recurrence = 'recurring';
DROP TYPE rule_recurrence;
CREATE TYPE rule_recurrence AS ENUM ('one_time', 'monthly', 'termly', 'annually');
ALTER TABLE rules ALTER COLUMN recurrence TYPE rule_recurrence USING recurrence::rule_recurrence;
