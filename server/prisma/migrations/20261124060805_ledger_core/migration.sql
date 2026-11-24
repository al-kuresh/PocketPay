-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('CUSTOMER', 'AGENT', 'MERCHANT', 'SYSTEM_FEES', 'SYSTEM_FLOAT');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SEND_MONEY', 'CASH_IN', 'CASH_OUT', 'PAYMENT', 'FLOAT_TOPUP');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('COMPLETED', 'REVERSED');

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "type" "WalletType" NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "trx_id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "amount" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL DEFAULT 0,
    "from_wallet_id" UUID NOT NULL,
    "to_wallet_id" UUID NOT NULL,
    "initiated_by" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "transaction_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_rules" (
    "type" "TransactionType" NOT NULL,
    "flat_fee" BIGINT NOT NULL DEFAULT 0,
    "percent_bp" INTEGER NOT NULL DEFAULT 0,
    "agent_commission_bp" INTEGER NOT NULL DEFAULT 0,
    "min_amount_for_fee" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fee_rules_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "limit_rules" (
    "type" "TransactionType" NOT NULL,
    "min_amount" BIGINT NOT NULL,
    "max_per_txn" BIGINT,
    "max_count_day" INTEGER,
    "max_count_month" INTEGER,
    "max_amount_day" BIGINT,
    "max_amount_month" BIGINT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "limit_rules_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_trx_id_key" ON "transactions"("trx_id");

-- CreateIndex
CREATE INDEX "transactions_created_at_idx" ON "transactions"("created_at");

-- CreateIndex
CREATE INDEX "transactions_from_wallet_id_created_at_idx" ON "transactions"("from_wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "transactions_to_wallet_id_created_at_idx" ON "transactions"("to_wallet_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_from_wallet_id_idempotency_key_key" ON "transactions"("from_wallet_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_seq_key" ON "ledger_entries"("seq");

-- CreateIndex
CREATE INDEX "ledger_entries_wallet_id_seq_idx" ON "ledger_entries"("wallet_id", "seq");

-- CreateIndex
CREATE INDEX "ledger_entries_wallet_id_created_at_idx" ON "ledger_entries"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_from_wallet_id_fkey" FOREIGN KEY ("from_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_wallet_id_fkey" FOREIGN KEY ("to_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Database guards (hand-written; Prisma can't express these). docs/plans/2026-11-24-phase-4-wallet-ledger.md, Task 1 =====

-- 1. Only the float wallet may go negative (it represents e-money issued against company cash).
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_non_negative"
  CHECK ("type" = 'SYSTEM_FLOAT' OR "balance" >= 0);
-- 2. User wallets have a user; system wallets don't.
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_owner_matches_type"
  CHECK (("type" IN ('SYSTEM_FEES', 'SYSTEM_FLOAT')) = ("user_id" IS NULL));
-- 3. Exactly one wallet per system type.
CREATE UNIQUE INDEX "wallets_system_type_key" ON "wallets" ("type") WHERE "user_id" IS NULL;
-- 4. Money amounts on transactions are positive; fees are never negative.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_fee_non_negative" CHECK ("fee" >= 0);
-- 5. The ledger is append-only.
CREATE FUNCTION ledger_entries_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (% blocked)', TG_OP USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER ledger_entries_no_update_delete BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();
-- 6. Every transaction's entries sum to zero, checked at COMMIT.
CREATE FUNCTION ledger_entries_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO total FROM "ledger_entries"
  WHERE transaction_id = NEW.transaction_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'unbalanced transaction %: entries sum to %', NEW.transaction_id, total
      USING ERRCODE = 'P0002';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entries_sum_zero AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_entries_balanced();
-- 7. Backfill: every existing non-admin user gets a wallet (the dev DB already has users).
INSERT INTO "wallets" ("id", "user_id", "type")
SELECT gen_random_uuid(), u."id", u."role"::text::"WalletType" FROM "users" u
WHERE u."role" <> 'ADMIN' AND NOT EXISTS (SELECT 1 FROM "wallets" w WHERE w."user_id" = u."id");
