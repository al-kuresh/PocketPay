-- This is an empty migration.
-- 8. A ledger entry always moves money; a zero entry is meaningless and
--    would let a single-entry transaction pass the zero-sum trigger.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_nonzero"
  CHECK ("amount" <> 0);
