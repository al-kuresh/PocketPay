# Phase 4 — Wallets & Double-Entry Ledger: Implementation Plan

> **For Claude Code:** do the tasks in order. For each task: write the tests first, run them and show they fail, implement, run them and show they pass, run lint + typecheck, then stop and let the user review and commit. Explain each file as you create it. Don't add anything outside the task. Don't commit or push.
> Steps use checkboxes (`- [ ]`). Each task names its recommended **⚙️ effort**.

**Goal:** the accounting engine:
- every user has a wallet
- money only moves through one `postTransaction` function, which writes balanced double-entry ledger rows under row locks
- the database itself refuses unbalanced, negative or edited ledger data
- a reconciliation check proves no money was created or lost
- a seed script creates the system wallets, the fee and limit rules from the design, and demo accounts with real ledger-backed balances

**Architecture:**
- The **ledger module** (`server/src/modules/ledger/`) is pure accounting: it locks wallets, checks idempotency, checks balances and writes entries. It knows nothing about fees, limits, PINs or roles.
- **Phase 5** builds the money flows (Send Money, Cash Out…) on top of it, through a `guard` callback that runs inside the same locked transaction.
- Database guards (check constraints, triggers) are the last line of defence when application code has a bug.

**Spec:** `docs/design.md` §6.3–6.4 (fee and limit values), §8 (money rule, tables, ledger examples, transfer steps, reconciliation), §14 (Phase 4 row).

**Tested before writing this plan** (2026-11-24, Prisma 7.10.1, Postgres 16, a spike branch on this repo):
- raw-SQL guards in a migration work, and **Prisma does not try to drop them** in later migrations
- 20 parallel ৳100 spends from a ৳1,000 wallet → exactly 10 succeed, the final balance is ৳0
- 30 transfers A→B and B→A in parallel, with id-ordered locks → 0 deadlocks; **without** ordering → 9 of 10 deadlock (`40P01`)
- checking the idempotency key **after** taking the locks → 5 identical requests give 1 new transaction + 4 replays, and no errors
- `TRUNCATE` (used by `resetDb`) still works with the append-only trigger

## Global constraints
- **Money is `bigint` poisha everywhere** (৳1 = 100n). Never `number` for money, never floats. In JSON, money is a **string of poisha**: `"150050"` = ৳1,500.50 (design §8.1). Express's `res.json` **throws** on a raw `bigint`, so presenters must convert.
- **Only `postTransaction` writes `transactions`, `ledger_entries` or `wallets.balance`.** The one exception is wallet creation with balance 0.
- **Lock query (verified):**
  ```sql
  SELECT id, type::text AS type, balance FROM wallets
  WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE
  ```
  It runs with `tx.$queryRaw` inside `prisma.$transaction(async (tx) => …, LEDGER_TX_OPTIONS)`. `balance` comes back as `bigint`. `ORDER BY id` makes Postgres take the locks in id order, which is what prevents deadlocks. Never lock wallets one by one in "from, then to" order.
- `LEDGER_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 }`. Default isolation (READ COMMITTED) plus the row locks is correct; don't use SERIALIZABLE.
- **Idempotency is checked after the locks are taken** (verified above), and the `@@unique([fromWalletId, idempotencyKey])` index stays as the backstop.
- **Database guards go in raw SQL appended to a migration** created with `npm run db:migrate -- --create-only --name <name>`. Prisma leaves them alone in later migrations (verified). How their errors surface:
  - check-constraint or trigger violation → `code === 'P2039'`, with the Postgres code at `err.meta.driverAdapterError.cause.originalCode` (`23514` for a check, `P0001` for the append-only trigger)
  - a unique violation is `P2002` with `…cause.constraint.index`, as in Phase 3
  - the deferred zero-sum trigger fails **at COMMIT** with a `DriverAdapterError` (no `code`); that's a programming bug, so it becomes a 500
- **The ledger is append-only.** Mistakes are fixed with a new transaction, never by editing entries.
- `wallets.version` from design §8.2 is **dropped**: we use row locks, not optimistic versioning. Record this in design.md in Task 7.
- **Prisma 7 refuses `prisma migrate reset` when run by an AI agent** (it asks for the user's explicit consent). The **user** runs reset commands, never Claude Code.
- New error codes in this phase:

  | Code | HTTP | When |
  |---|---|---|
  | `INSUFFICIENT_BALANCE` | 422 | a non-float wallet would go below 0 |
  | `WALLET_NOT_FOUND` | 404 | a posting references a wallet that doesn't exist |
  | `IDEMPOTENCY_KEY_REUSED` | 409 | the same key was reused with a different type, amount or receiver |

- Seed values come **exactly** from design §6.3–6.4, converted to poisha (listed in Task 6).

## Review focus
Inputs the main tests don't cover, most likely to cause real money bugs. Each has a test in its task:
1. **Concurrent spending:** 20 parallel spends can never overdraw a wallet. *(Task 3)*
2. **Opposite transfers at the same moment** never deadlock. A control test proves the deadlock **would** happen without the ordering, so the reason for the sort is documented in code. *(Task 3)*
3. **A retry with the same key but a different amount** must get 409 `IDEMPOTENCY_KEY_REUSED`, never silently return the first transaction. *(Task 3)*
4. **A cached balance changed behind the ledger's back** (a bug or a manual SQL edit) must be reported by reconciliation. *(Task 4)*
5. **Running the seed twice** must not create money twice. *(Task 6)*

---

### Task 1: Money tables and database guards
**⚙️ Effort: extra-high.** The schema and guards are hard to change once data exists.

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: the migration `server/prisma/migrations/…_ledger_core/migration.sql` (generated, then raw SQL appended)
- Test: `server/tests/ledger.guards.test.ts`

**Schema (all ids uuid; timestamps timestamptz; snake_case via `@map`):**
- enums:
  - `WalletType { CUSTOMER AGENT MERCHANT SYSTEM_FEES SYSTEM_FLOAT }`
  - `TransactionType { SEND_MONEY CASH_IN CASH_OUT PAYMENT FLOAT_TOPUP }`
  - `TransactionStatus { COMPLETED REVERSED }` (only COMPLETED is written for now)
- `Wallet` → `wallets`: `id`, `userId` (optional, **`@unique`**, one wallet per user), `type`, `balance` (BigInt, default 0), `createdAt`. Relations: `user?`, `entries`, `sentTransactions`, `receivedTransactions`.
- `Transaction` → `transactions`:
  - `id`, `trxId` (`@unique`, `@map("trx_id")`), `type`, `status` (default COMPLETED)
  - `amount` (BigInt), `fee` (BigInt, default 0)
  - `fromWalletId`, `toWalletId`, `initiatedById` (→ User)
  - `idempotencyKey`, `note?`, `createdAt`
  - `@@unique([fromWalletId, idempotencyKey])`, `@@index([createdAt])`, `@@index([fromWalletId, createdAt])`, `@@index([toWalletId, createdAt])`
- `LedgerEntry` → `ledger_entries`: `id`, **`seq` (BigInt `@default(autoincrement())` `@unique`)**, `transactionId`, `walletId`, `amount` (signed BigInt), `balanceAfter` (BigInt), `createdAt`. `@@index([walletId, seq])`, `@@index([walletId, createdAt])`, `@@index([transactionId])`.
  - **Why `seq`:** Postgres's `now()` is the transaction's **start** time. A transfer that waits for a wallet lock can start first but commit second, so `created_at` doesn't reflect the real order of a wallet's entries. `seq` is assigned at insert time, while the wallet is locked, so it's the true order. **Ordering a wallet's entries always means `ORDER BY seq`.**
- `FeeRule` → `fee_rules`: `type` (`@id`, TransactionType), `flatFee` (BigInt, default 0), `percentBp` (Int, default 0), `agentCommissionBp` (Int, default 0), `minAmountForFee` (BigInt, default 0; the fee applies only when amount **>** this), `updatedAt`.
- `LimitRule` → `limit_rules`: `type` (`@id`), `minAmount` (BigInt), and optional `maxPerTxn` (BigInt), `maxCountDay` (Int), `maxCountMonth` (Int), `maxAmountDay` (BigInt), `maxAmountMonth` (BigInt). NULL means no limit. Plus `updatedAt`.
- `SystemSetting` → `system_settings`: `key` (`@id`), `value` (String), `updatedAt`.
- Every relation into wallets, transactions and users is `onDelete: Restrict`.
- Add the matching relation arrays to `User` (`wallet Wallet?`, `initiatedTransactions Transaction[]`).

**Raw SQL appended to the migration** (exactly this; it was verified in the spike):
```sql
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
```

- [ ] **Step 1: Edit the schema** and run `npm run db:migrate -- --create-only --name ledger_core`. Append the SQL above to the new `migration.sql`. Run `npm run db:migrate`, then `npm run db:generate`.
- [ ] **Step 2: Write `tests/ledger.guards.test.ts`** (`beforeEach(resetDb)`). It writes directly with Prisma, deliberately skipping the service, to prove the **database** refuses bad data:
  - a second `SYSTEM_FEES` wallet → `P2002`, index `wallets_system_type_key`
  - setting a CUSTOMER or SYSTEM_FEES wallet's balance to `-1n` → `P2039`, originalCode `23514`
  - a SYSTEM_FLOAT balance of `-5n` → allowed
  - a CUSTOMER wallet with `userId: null` → `P2039` (owner check)
  - inside `prisma.$transaction`: a transaction with a single `+100n` entry → the **commit** rejects it, and 0 transactions and 0 entries remain
  - a balanced pair (−100n / +100n) → commits
  - `ledgerEntry.updateMany` and `deleteMany` → `P2039`, originalCode `P0001`
  - a transaction with `amount: 0n` → `P2039`
  - a second wallet for the same user → `P2002`
- [ ] **Step 3: Run the tests.** They PASS straight away, because the guards were written in Step 1. That's expected for this task. Also show `npm test` (all of Phase 3 still green), lint and typecheck.

### Task 2: Money helpers and transaction IDs
**⚙️ Effort: high.** Small, pure functions with exact test cases.

**Files:**
- Create: `server/src/utils/money.ts`, `server/src/utils/trxId.ts`
- Test: `server/tests/unit/money.test.ts`, `server/tests/unit/trxId.test.ts`

**Interfaces produced:**
- `taka(whole: number): bigint` turns whole taka into poisha (`taka(500) === 50_000n`). It throws on non-integers or values beyond `Number.MAX_SAFE_INTEGER / 100`. It's for seeds and tests.
- `percentOfBp(amount: bigint, bp: number): bigint` gives `amount × bp / 10_000`, **rounded half-up** to the nearest poisha, in integer maths only: `(amount * BigInt(bp) * 2n + 10_000n) / 20_000n`. `bp` must be an integer from 0 to 10_000.
- `poishaToString(p: bigint): string` returns `p.toString()`. This is how money goes into JSON.
- `poishaSchema`: a Zod schema taking a string of 1–15 digits (no sign, no decimals) and producing a `bigint` greater than 0. It's for Phase 5 request bodies, and its message is `'Amount must be a whole number of poisha, e.g. "150050" for ৳1,500.50'`.
- `generateTrxId(): string` returns `'PP'` + 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L, so it reads well on a receipt), using `crypto.randomInt`.

- [ ] **Step 1: Write the failing tests.**
  - `percentOfBp(100_000n, 185) === 1_850n` (৳1,000 cash-out fee = ৳18.50)
  - `percentOfBp(100_000n, 40) === 400n` (agent commission ৳4)
  - half-up: `percentOfBp(2n, 2500) === 1n` (0.5 → 1); `percentOfBp(6n, 2500) === 2n` (1.5 → 2); `percentOfBp(1n, 2499) === 0n`
  - `percentOfBp(x, 0) === 0n`. It throws for `bp` −1, 10_001 and 1.5.
  - `taka(500) === 50_000n`. It throws for 1.5.
  - `poishaSchema`: `"150050"` → `150050n`. Rejected: `"0"`, `"-5"`, `"15.50"`, `"1e5"`, `""`, a 16-digit string, and the number `150050` (not a string).
  - `generateTrxId()` matches `/^PP[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/`. 10,000 generated IDs are all unique.
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, lint and typecheck.**

### Task 3: `postTransaction`, the ledger engine
**⚙️ Effort: extra-high.** This is the heart of the project: locking, idempotency and concurrency.

**Files:**
- Create: `server/src/modules/ledger/ledger.service.ts`, `server/src/modules/ledger/ledger.types.ts`
- Test: `server/tests/ledger.service.test.ts`, `server/tests/ledger.concurrency.test.ts`, `server/tests/helpers/wallets.ts`

**Interfaces produced:**
```ts
export const LEDGER_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

export interface Posting { walletId: string; amount: bigint }            // signed: − out, + in
export interface LockedWallet { id: string; type: WalletType; balance: bigint }

export interface PostTransactionInput {
  type: TransactionType;
  amount: bigint;            // > 0, the business amount (e.g. what the receiver gets)
  fee: bigint;               // >= 0
  fromWalletId: string;
  toWalletId: string;
  postings: Posting[];       // ≥ 2, distinct wallets, include from and to, sum === 0n
  initiatedById: string;
  idempotencyKey: string;    // 1–100 chars
  note?: string;             // ≤ 50 chars
  /** Runs inside the transaction after the locks are taken and before anything is written.
   *  Phase 5 puts status, limit and balance-cap checks here. Throwing aborts everything. */
  guard?: (ctx: { tx: Prisma.TransactionClient; wallets: Map<string, LockedWallet> }) => Promise<void>;
}

export interface PostTransactionResult {
  transaction: Transaction & { entries: LedgerEntry[] };
  replayed: boolean;         // true when an earlier transaction with the same key was returned
}

export async function postTransaction(
  input: PostTransactionInput,
  options?: { nextTrxId?: () => string },   // tests only: inject trxId collisions
): Promise<PostTransactionResult>
```

**Algorithm:** keep this exact order; it was tested in the spike.
1. **Validate the input before touching the DB.** At least 2 postings; distinct wallet ids; `from` and `to` among them; no zero amounts; **sum === 0n**; `amount > 0n`; `fee >= 0n`; key and note lengths. Any violation throws a plain `Error` (a programming bug, so a 500), never an `AppError`.
2. Generate the `trxId` (injectable for tests).
3. `prisma.$transaction(async (tx) => …, LEDGER_TX_OPTIONS)`:
   1. **Lock** every posting wallet with the lock query from Global constraints. If fewer rows come back than there are wallets → `AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found')`.
   2. **Idempotency:** `tx.transaction.findUnique` by `fromWalletId_idempotencyKey`.
      - If it exists with the same `type`, `amount` and `toWalletId` → return it with its entries, and `replayed: true`.
      - If it exists with any difference → `AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different transaction')`.
   3. `await input.guard?.({ tx, wallets })`.
   4. **Balance check:** for each posting, `next = locked.balance + posting.amount`. If `next < 0n` and the wallet type isn't `SYSTEM_FLOAT` → `AppError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance')`. Don't put wallet ids in `details`.
   5. Create the `transactions` row.
   6. `tx.ledgerEntry.createMany`, with each `balanceAfter = next`.
   7. Update each wallet with `balance: next`. Set the exact value: the row is locked, and we just computed it.
   8. Return the transaction with its entries, and `replayed: false`.
4. **TrxId collision:** if the transaction fails with P2002 on `transactions_trx_id_key`, retry the **whole** `$transaction` with a new trxId, up to 3 attempts. Any other P2002 is rethrown.
5. A P2002 on `transactions_from_wallet_id_idempotency_key_key` is a backstop: it can only happen if step 3.2 is bypassed. Catch it, re-read the transaction **outside** the failed transaction, and apply the same same/different rule as step 3.2.

Add a code comment at the lock query: *"ORDER BY id: every transaction locks wallets in the same global order, so two transfers between the same wallets in opposite directions can't deadlock. See ledger.concurrency.test.ts."*

`tests/helpers/wallets.ts` exports:
- `createSystemWallets(): Promise<{ fees: Wallet; float: Wallet }>`
- `createUserWithWallet(opts: { phone: string; nid: string; role?: Role }): Promise<{ user: User; wallet: Wallet }>`
- `fund(walletId: string, amount: bigint, initiatedById: string)`, which posts a `FLOAT_TOPUP` from the float wallet through `postTransaction`

- [ ] **Step 1: Write the failing tests.**
  - `tests/ledger.service.test.ts`:
    - **fund ৳1,000 into a customer wallet:**
      - the result has 2 entries (float −100_000n with balanceAfter −100_000n, customer +100_000n with balanceAfter 100_000n), and the cached balances match
      - `replayed === false`
      - trxId matches the pattern
    - **a 3-way posting** (the cash-out example from design §8.3): customer −101_850n, agent +100_400n, fees +1_450n → commits; balances as expected
    - insufficient balance → 422 `INSUFFICIENT_BALANCE`, and nothing changed (0 new transactions, balances unchanged)
    - the float wallet may go negative; the SYSTEM_FEES wallet may not
    - an unknown wallet id → 404 `WALLET_NOT_FOUND`
    - invalid postings (sum ≠ 0, a duplicate wallet, `from` missing, a zero amount) → throws before any DB write
    - **guard:** a guard that throws `new AppError(403, 'TEST', 'x')` → that error comes back, and nothing is written. A guard receives a `wallets` map with the locked balances.
    - **idempotency:** the same input twice in sequence → the second gives `replayed: true` with the same transaction id, and the balance moved once
    - **Review focus #3:** the same key with a different amount → 409 `IDEMPOTENCY_KEY_REUSED`
    - **trxId collision:** `nextTrxId` returns an existing trxId first, then a new one → success with the second id
    - **balanceAfter chain:** fund a wallet ৳1,000, fund it ৳500, then send ৳300 out of it → its entries ordered by `seq` have balanceAfter 100_000n, 150_000n, 120_000n, and the last equals the cached balance
  - `tests/ledger.concurrency.test.ts`:
    - **Review focus #1:** a wallet holding ৳1,000 sends 20 × ৳100 in parallel (`Promise.allSettled`) → exactly 10 fulfilled and 10 rejected with `INSUFFICIENT_BALANCE`; final balance 0n; the sum of that wallet's entries is 0n; **and its debit entries ordered by `seq` have balanceAfter 90_000n, 80_000n … 0n with no gaps or repeats** (proves the chain stays consistent under concurrency)
    - **Review focus #2:** wallets A and B each hold ৳500; 30 transfers of ৳10 run in parallel, alternating A→B and B→A → 30 fulfilled, 0 errors, and A + B still total ৳1,000
    - **The control test (why we sort):** a test-only helper locks the two wallets one at a time, "from" then "to", with a 20 ms pause between, running 10 alternating jobs → **at least one** fails with originalCode `40P01` (deadlock). Comment: *"This is what postTransaction's ORDER BY id prevents."*
    - **idempotency under concurrency:** 5 parallel calls with the same key → exactly 1 with `replayed: false` and 4 with `replayed: true`, all with the same transaction id; the balance moved once
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, then run the two ledger test files 5 times in a row** (concurrency tests must be stable). Then lint and typecheck.

### Task 4: Reconciliation, the proof that no money was lost
**⚙️ Effort: extra-high.** The SQL must be exactly right, or the check is false comfort.

**Files:**
- Create: `server/src/modules/ledger/reconcile.ts`, `server/src/scripts/ledger-check.ts`
- Modify: `server/package.json` (add the script `"ledger:check": "tsx src/scripts/ledger-check.ts"`)
- Test: `server/tests/ledger.reconcile.test.ts`

**Interfaces produced:**
```ts
export interface ReconcileReport {
  ok: boolean;
  checkedWallets: number;
  checkedTransactions: number;
  walletMismatches: { walletId: string; type: WalletType; cached: string; ledger: string }[];
  lastBalanceMismatches: { walletId: string; cached: string; lastBalanceAfter: string }[];
  unbalancedTransactions: { transactionId: string; trxId: string; sum: string; entryCount: number }[];
  ledgerTotal: string;   // SUM(all entries), must be "0"
  cachedTotal: string;   // SUM(all wallet balances), must be "0"
}
export async function reconcileLedger(db?: PrismaClient): Promise<ReconcileReport>
```
The checks are SQL aggregates through `$queryRaw`, not loops in JavaScript:
1. each wallet's `balance` equals `COALESCE(SUM(entries.amount), 0)`, computed with a LEFT JOIN so wallets with no entries count too
2. each wallet's latest entry (**highest `seq`**, e.g. `DISTINCT ON (wallet_id) … ORDER BY wallet_id, seq DESC`) has `balance_after = balance`
3. each transaction's entries sum to 0 and number at least 2
4. the sum of all entries = 0, and the sum of all cached balances = 0

`ok` is true only when all four pass. Money in the report is a string.

`ledger-check.ts` prints a readable summary (in ৳, for example "৳1,00,000.00 in 6 wallets") and exits with code 1 when `!ok`. It disconnects Prisma at the end.

- [ ] **Step 1: Write the failing tests.**
  - an empty database → `ok: true`, totals `"0"`
  - after a few `postTransaction` calls (fund 2 customers, one 3-way posting) → `ok: true`
  - **Review focus #4:** change one customer's cached balance directly with `$executeRaw` (bypassing the ledger, the way a bug would) → `ok: false`; `walletMismatches` names that wallet with the right cached and ledger values; `cachedTotal ≠ "0"`
  - a transaction with only one entry can't exist (the trigger blocks it), so test unbalanced detection by **temporarily disabling the trigger in the test**: `ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_sum_zero`, insert an unbalanced pair, re-enable it in a `finally` block → `unbalancedTransactions` lists it
  - the script: run `ledger-check.ts` as a child process (`npx tsx src/scripts/ledger-check.ts`) with `env: process.env`, so it gets the test DB URL and `JWT_SECRET` that Vitest set → exit code 0 on a clean DB, 1 after tampering
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, lint and typecheck.**

### Task 5: Wallets for every account, and the balance in `/me`
**⚙️ Effort: high.** A small change to existing, well-tested code.

**Files:**
- Create: `server/src/modules/wallets/wallet.presenter.ts`
- Modify: `server/src/modules/auth/registration.service.ts`, `server/src/modules/me/me.routes.ts`
- Test: `server/tests/auth.register.test.ts` (extend), `server/tests/auth.session.test.ts` (extend the `/me` tests)

**Interfaces produced:**
- `PublicWallet = { id: string; type: WalletType; balance: string }`, where `balance` is a poisha string. `toPublicWallet(w: Wallet): PublicWallet`.
- Registration creates the user's wallet **inside the existing transaction**, right after `tx.user.create`: `tx.wallet.create({ data: { userId, type: body.role } })`. The role names match the wallet types.
- `GET /api/v1/me` responds with `{ user: PublicUser, wallet: PublicWallet | null }` (null for admins). Login and refresh responses are unchanged.

- [ ] **Step 1: Write the failing tests.**
  - registering a CUSTOMER → exactly 1 wallet, type `CUSTOMER`, balance `0n`. An AGENT → type `AGENT`.
  - in the registration-failure tests (upload failure, NID race) → **0 wallets**, because the wallet rolls back with the user
  - `/me` for a funded customer (funded with the Task 3 helper, ৳1,000) → `wallet.balance === "100000"` (a string), `wallet.type === 'CUSTOMER'`
  - `/me` for an ADMIN (seeded directly) → `wallet === null`
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, lint and typecheck.**

### Task 6: Seed: system wallets, rules and demo accounts
**⚙️ Effort: high.** Data entry from the design tables, plus idempotent use of the ledger.

**Files:**
- Create: `server/src/db/seed.ts` (the functions), `server/prisma/seed.ts` (the entry point), `server/tests/helpers/seed.ts`
- Modify: `server/prisma.config.ts` (`migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' }`), `server/package.json`, `server/tsconfig.json` (add `"prisma/**/*.ts"` and `"prisma.config.ts"` to `include`)
- Test: `server/tests/seed.test.ts`

**Seed contents** (in poisha; from design §6.3–6.4):
- **System wallets:** `SYSTEM_FEES`, `SYSTEM_FLOAT`. Create with `createMany({ skipDuplicates: true })`, which works with the partial unique index.
- **`fee_rules`** (upsert by `type`):

  | type | flatFee | percentBp | agentCommissionBp | minAmountForFee |
  |---|---|---|---|---|
  | SEND_MONEY | 500 | 0 | 0 | 10_000 |
  | CASH_OUT | 0 | 185 | 40 | 0 |
  | CASH_IN, PAYMENT, FLOAT_TOPUP | 0 | 0 | 0 | 0 |

- **`limit_rules`** (upsert by `type`; NULL = no limit):

  | type | minAmount | maxPerTxn | countDay | countMonth | amountDay | amountMonth |
  |---|---|---|---|---|---|---|
  | SEND_MONEY | 1_000 | 5_000_000 | 100 | 250 | 5_000_000 | 30_000_000 |
  | CASH_IN | 5_000 | 5_000_000 | 100 | 250 | 5_000_000 | 30_000_000 |
  | CASH_OUT | 5_000 | 3_000_000 | 100 | 250 | 3_000_000 | 20_000_000 |
  | PAYMENT | 100 | null | null | null | null | null |

  No row for FLOAT_TOPUP; it's admin-only.
- **`system_settings`:** `CUSTOMER_MAX_BALANCE = "50000000"` (৳5,00,000).
- **Demo users** (upsert by phone; status ACTIVE; PIN `48213` hashed with `hashPin`; date of birth `1995-01-01`; no KYC documents, so `kycStatus` is null; a wallet for each non-admin):

  | phone | NID | name | role | shopName |
  |---|---|---|---|---|
  | 01800000001 | 9000000001 | Demo Admin | ADMIN | — |
  | 01800000002 | 9000000002 | Rahim Uddin | CUSTOMER | — |
  | 01800000003 | 9000000003 | Karim Hasan | CUSTOMER | — |
  | 01800000004 | 9000000004 | Demo Agent | AGENT | — |
  | 01800000005 | 9000000005 | Demo Store | MERCHANT | Demo Store |

- **Demo money**, through `postTransaction` with fixed idempotency keys, so a re-run replays instead of paying twice:
  - `seed:float:agent`: FLOAT_TOPUP ৳1,00,000, from SYSTEM_FLOAT to the agent, initiated by the admin
  - `seed:cashin:rahim`: CASH_IN ৳10,000, from the agent to Rahim, initiated by the agent
  - `seed:cashin:karim`: CASH_IN ৳5,000, from the agent to Karim, initiated by the agent

**Interfaces produced:**
- `seedSystem(): Promise<{ fees: Wallet; float: Wallet }>` (system wallets, rules, settings)
- `seedDemo(): Promise<{ users: Record<'admin' | 'rahim' | 'karim' | 'agent' | 'store', User> }>`
- `seedAll()`, which calls both, then runs `reconcileLedger()` and throws if `!ok`

`prisma/seed.ts` calls `seedAll()`, prints a summary (accounts, phones, the demo PIN, balances in ৳) and disconnects. **It refuses to run when `NODE_ENV === 'production'`**, with the error "Demo seeding is disabled in production; Phase 10 decides how the live demo is seeded".

`tests/helpers/seed.ts` re-exports `seedSystem` for tests that need the full rules and settings (Phase 5). Task 3's `createSystemWallets` helper stays for the ledger tests.

**npm scripts:**
- `"db:seed": "prisma db seed"`
- `"db:reset": "prisma migrate reset"`. It asks for confirmation. **The user runs it, not Claude Code**: Prisma 7 refuses to reset when an AI agent runs it. After a reset, run `npm run db:seed`, because Prisma 7's reset no longer seeds automatically.

- [ ] **Step 1: Write the failing tests** (`tests/seed.test.ts`):
  - `seedAll()` on an empty DB:
    - 5 users and 6 wallets (4 user wallets + 2 system)
    - 3 transactions; the rules exactly as in the tables above
    - balances: agent `8_500_000n` (৳85,000), Rahim `1_000_000n`, Karim `500_000n`, float `-10_000_000n`, fees `0n`
    - reconcile is `ok`
  - **Review focus #5:** `seedAll()` a second time → the same counts and balances, still 3 transactions
  - every demo user can log in with PIN `48213` through `POST /auth/login`; the admin's `/me` has `wallet: null`
  - running `prisma/seed.ts` with `NODE_ENV=production` (as a child process) → exits non-zero with the production message
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, lint and typecheck.** Then run `npm run db:seed` and `npm run ledger:check` against the **dev** database, and show the output.

### Task 7: Docs, the ER diagram and the pull request
**⚙️ Effort: high.** Writing, plus checking the docs against the code.

**Files:**
- Create: `docs/diagrams/erd.md`
- Modify: `docs/design.md`, `docs/api.md`, `README.md`

- [ ] **Step 1: Write `docs/diagrams/erd.md`:** a Mermaid `erDiagram` of **all** tables (auth plus money), with keys and relationships, generated from `schema.prisma`. GitHub renders Mermaid. This completes the ER diagram left over from Phase 1.
- [ ] **Step 2: Update `docs/design.md`:**
  - §8.2: drop `version` from `wallets`, add `initiated_by` to `transactions`, add `seq` to `ledger_entries` (with the one-line reason)
  - new §8.5 "Database guards", listing the 7 SQL guards, each with one line on why it exists
  - §8.4: the steps now match `postTransaction` (lock order, idempotency after the lock, the guard hook)
  - §15: add "Row locks + DB guards instead of optimistic versioning"
- [ ] **Step 3: Update `docs/api.md`:** `GET /me` now returns `wallet` (with an example: `"balance": "1000000"` and a note that it's poisha, so ৳10,000.00); add the 3 new error codes to the table; move "Wallet" out of "Coming next" only if a wallet endpoint exists (it doesn't yet; lookup is Phase 5).
- [ ] **Step 4: Update the README:**
  - a "Demo accounts" table (the 5 phones, PIN `48213`, starting balances)
  - "Seed and reset": `npm run db:seed`; `npm run db:reset` followed by `npm run db:seed`, with a note that **you** run the reset (Prisma refuses it from AI agents)
  - `npm run ledger:check` in the Useful commands table
  - the status line: Phase 4 complete
- [ ] **Step 5: Run everything:** `npm test`, lint, typecheck, `npm run db:seed` twice, `npm run ledger:check`. Then stop. The user commits, pushes `feat/ledger` and opens the PR.

---

**Phase 4 is done when:**
- all tests pass, including the concurrency tests 5 times in a row, with lint and typecheck clean
- `npm run db:seed` (run twice) and `npm run ledger:check` report a balanced ledger on the dev DB
- the 5 demo accounts can log in, and `/me` shows their balances
- the PR is merged into `main`
