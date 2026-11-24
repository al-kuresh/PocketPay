-- ===== Database guard 9 (hand-written; Prisma can't express it). docs/design.md §8.5 =====

-- 9. A posted transaction is history: only its "status" may change (e.g. a later REVERSED).
--    postTransaction's idempotency replay trusts the stored type, amount and to_wallet_id, and
--    receipts and limit sums trust the rest, so editing any other column would silently rewrite
--    what already happened. Mistakes are fixed with a new transaction, as for ledger_entries.
CREATE FUNCTION transactions_status_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'transactions: only status may change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transactions_status_only BEFORE UPDATE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION transactions_status_only();
