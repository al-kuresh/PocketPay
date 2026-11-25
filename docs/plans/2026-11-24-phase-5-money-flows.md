# Phase 5: Money Flows Implementation Plan

> **For Claude Code:** do the tasks in order. For each task: write the tests first, run them and show they fail, implement, run them and show they pass, run lint + typecheck, then stop and let the user review and commit. Explain each file as you create it. Don't add anything outside the task. Don't commit or push.
> Steps use checkboxes (`- [ ]`). Each task names its recommended **⚙️ effort**.

**Goal:** real money movement over the API:
- Send Money, Cash In, Cash Out and Payment, each with fees, limits, the balance cap and a PIN check
- a preview endpoint and a receiver lookup
- transaction history and receipts

Every one of them goes through Phase 4's `postTransaction`.

**Architecture:**
- A new **transactions module** (`server/src/modules/transactions/`) holds the business rules.
  - **Before the ledger:** who may send to whom, what the fee is, and the per-transaction minimum and maximum.
  - **Inside the ledger's locked transaction, through the `guard` hook:** status re-check, daily and monthly limits, and the balance cap.
- The ledger module is **not changed**.
- Pure functions (fees, postings, time windows, name masking) are separate from database code, so they're unit-tested without a database.

**Spec:** `docs/design.md` §5 (roles, status), §6.2–6.5 (lookup, flows, fees, limits, history, receipts), §8.3–8.4 (postings, transfer steps), §9 (endpoints), §10 (security).

## Global constraints
- **Money is `bigint` poisha everywhere.** In JSON it is a poisha **string**. Parse request amounts with `poishaSchema` (`src/utils/money.ts`).
- **The ledger stays as it is.** Don't change `ledger.service.ts`, `ledger.types.ts`, `reconcile.ts`, any migration or the DB guards. Every money movement goes through `postTransaction`.
- **Limit and cap checks run inside the `guard`.**
  - Only there is the customer's wallet locked: the customer is always a posting wallet, as sender or receiver, so parallel requests for that customer wait in line.
  - A check outside the guard lets two parallel requests both pass, and that would be a bug.
  - Preview runs the same checks without locks, to inform the user. Only the guard's result is binding.
- **The flow table.** This is the single source of truth for who may do what:

  | Flow | Initiator (`from`) | Receiver (`to`) | Limits count against | Fee paid by | Postings |
  |---|---|---|---|---|---|
  | `SEND_MONEY` | CUSTOMER | CUSTOMER | the sender (`from_wallet_id`) | sender | from −(amount+fee) · to +amount · fees +fee |
  | `CASH_IN` | AGENT | CUSTOMER | the **customer** (`to_wallet_id`) | sender (fee 0 by default) | from −(amount+fee) · to +amount · fees +fee |
  | `CASH_OUT` | CUSTOMER | AGENT | the customer (`from_wallet_id`) | sender | from −(amount+fee) · to +(amount+commission) · fees +(fee−commission) |
  | `PAYMENT` | CUSTOMER | MERCHANT | the customer (`from_wallet_id`) | **receiver** (merchant fee, 0 by default) | from −amount · to +(amount−fee) · fees +fee |

  - Agents and merchants have no period limits. The ৳5,00,000 cap applies only when the receiver is a CUSTOMER.
  - **Omit the fees posting when it would be 0**, because `postTransaction` rejects zero postings.
- **Fee:** `fee = amount > rule.minAmountForFee ? rule.flatFee + percentOfBp(amount, rule.percentBp) : 0n`. `commission = percentOfBp(amount, rule.agentCommissionBp)`. A commission greater than the fee is a bad rule, so throw a plain `Error`.
- **Time windows use Asia/Dhaka.** Bangladesh is UTC+06:00 with no daylight saving (none since 2009), so a day starts at `YYYY-MM-DDT00:00:00+06:00`. The limit windows compare against `transactions.created_at`.
- **Request order on a money POST:**
  1. body and header validation
  2. initiator checks: role and status
  3. receiver checks
  4. amount bounds and fee
  5. **then** the PIN
  6. then `postTransaction` with the guard

  A typo in the receiver's phone or the amount must never cost a PIN attempt.
- **The PIN shares the login lockout:** the same `failed_pin_attempts` / `locked_until` columns and the same 3 attempts / 30 minutes. Three wrong PINs on money requests lock login too.
- **Express 5 makes `req.query` read-only.** A query validator puts the parsed result on `res.locals.query`; it never assigns to `req.query`.
- **Rate limits** use the existing `createLimiter`, which is skipped in tests. They're keyed per IP, as in Phase 3.
- **Response shape:**
  - Money POSTs return `201 { receipt, replayed: false }` for a new transaction, and `200 { receipt, replayed: true }` for an idempotent replay.
  - Every other endpoint returns `200`.
- **Names that leave the server:** a person's name is masked with `maskName` (e.g. "Rahim U***"). A merchant is shown by its **shop name**, unmasked, because that's a public business name. System wallets are shown as `PocketPay`.
- **New error codes:**

  | Code | HTTP | When |
  |---|---|---|
  | `ACCOUNT_NOT_ACTIVE` | 403 | the initiator isn't ACTIVE (`details.status`) |
  | `INVALID_PIN` | 403 | wrong PIN on a money request (`details.attemptsLeft`) |
  | `RECEIVER_NOT_FOUND` | 404 | no account with that phone, or it's an admin |
  | `CANNOT_SEND_TO_SELF` | 422 | the receiver is the initiator |
  | `INVALID_RECEIVER` | 422 | the receiver's role doesn't fit the flow (`details.expectedRole`) |
  | `RECEIVER_NOT_ACTIVE` | 422 | the receiver isn't ACTIVE |
  | `AMOUNT_BELOW_MINIMUM` | 422 | below `limit_rules.min_amount`, or a payment whose merchant fee ≥ the amount (`details.min`) |
  | `AMOUNT_ABOVE_MAXIMUM` | 422 | above `max_per_txn` (`details.max`) |
  | `LIMIT_EXCEEDED` | 422 | daily or monthly count or amount (`details: { period: 'DAY'\|'MONTH', kind: 'COUNT'\|'AMOUNT', limit, used }`, all strings) |
  | `RECEIVER_BALANCE_LIMIT` | 422 | a customer receiver would go above `CUSTOMER_MAX_BALANCE` |
  | `IDEMPOTENCY_KEY_REQUIRED` | 400 | the `Idempotency-Key` header is missing or isn't a UUID |
  | `TRANSACTION_NOT_FOUND` | 404 | no such trxId, or the caller's wallet isn't part of it |

  The existing codes are reused: `ACCOUNT_LOCKED` 423, `INSUFFICIENT_BALANCE` 422, `IDEMPOTENCY_KEY_REUSED` 409, `FORBIDDEN` 403 and `VALIDATION_ERROR` 400.
- **No audit row per money movement.**
  - The `transactions` row is the immutable record of who, what and when (`initiated_by`, `created_at`, guard 9).
  - The audit log records the **security** events of money requests: `TRANSACTION_PIN_FAILED` and `ACCOUNT_LOCKED`.
  - Record this in design.md in Task 7.

## Review focus
These are the inputs the main tests don't cover that are most likely to cause real money bugs. Each one has a test in its task.
1. **Parallel requests beating a limit:** 10 parallel sends with `maxCountDay = 3` → exactly 3 succeed. *(Task 4)*
2. **Parallel incoming money beating the balance cap:** 5 senders paying one customer near the cap → exactly the ones that fit succeed. *(Task 4)*
3. **The fee boundary:** the Send Money fee applies only **above** ৳100. Exactly ৳100.00 is free; ৳100.01 pays ৳5. *(Tasks 1 and 4)*
4. **The Dhaka day boundary:** 17:59:59Z is still "today" in Dhaka; 18:00:00Z is the next day. A transaction from yesterday doesn't count toward today's limit, but does count toward this month's. *(Tasks 1 and 3)*
5. **A still-valid access token after a freeze:** freezing a user makes their next money request fail with `ACCOUNT_NOT_ACTIVE`, even though the 15-minute JWT is still valid. The guard re-reads the status inside the transaction. *(Task 4)*

---

### Task 1: Pure building blocks (time windows, fees, postings, name masking)
**⚙️ Effort: high.** Small pure functions with exact test cases.

**Files:**
- Modify: `server/src/utils/time.ts`, `server/src/utils/mask.ts`
- Create: `server/src/modules/transactions/fees.ts`, `server/src/modules/transactions/postings.ts`, `server/src/modules/transactions/flows.ts`
- Test: `server/tests/unit/time.test.ts`, `server/tests/unit/mask.test.ts`, `server/tests/unit/fees.test.ts`, `server/tests/unit/postings.test.ts`

**Interfaces produced:**
```ts
// utils/time.ts (keep dhakaToday)
export function dhakaDayStart(now?: Date): Date              // 00:00 Dhaka today, as a UTC instant
export function dhakaMonthStart(now?: Date): Date            // 00:00 Dhaka on the 1st of this month
export function dhakaDateRange(from?: string, to?: string): { gte?: Date; lt?: Date }  // YYYY-MM-DD, inclusive days

// utils/mask.ts
export function maskName(name: string): string               // "Rahim Uddin" → "Rahim U***"

// modules/transactions/flows.ts
export type FlowType = 'SEND_MONEY' | 'CASH_IN' | 'CASH_OUT' | 'PAYMENT';
export interface FlowSpec { initiator: Role; receiver: Role; limitSide: 'from' | 'to'; feePaidBy: 'sender' | 'receiver' }
export const FLOWS: Record<FlowType, FlowSpec>              // exactly the Global constraints table

// modules/transactions/fees.ts
export function calculateFee(rule: Pick<FeeRule, 'flatFee' | 'percentBp' | 'agentCommissionBp' | 'minAmountForFee'> | null,
                             amount: bigint): { fee: bigint; commission: bigint }   // null rule → 0n, 0n

// modules/transactions/postings.ts
export function buildPostings(type: FlowType, w: { fromWalletId: string; toWalletId: string; feesWalletId: string },
                              m: { amount: bigint; fee: bigint; commission: bigint }): Posting[]
```
`maskName` rules:
- Keep the first word.
- Every later word becomes its first letter + `***`.
- A single-word name keeps its first 2 letters + `***`.
- Trim and collapse whitespace first.

- [ ] **Step 1: Write the failing tests.**
  - **Time:**
    - `dhakaDayStart(new Date('2026-11-24T17:59:59Z'))` → `2026-11-23T18:00:00.000Z`
    - `dhakaDayStart(new Date('2026-11-24T18:00:00Z'))` → `2026-11-24T18:00:00.000Z`
    - `dhakaMonthStart(new Date('2026-11-30T18:30:00Z'))` → `2026-11-30T18:00:00.000Z` (it's already 1 December in Dhaka)
    - `dhakaDateRange('2026-11-01', '2026-11-24')` → `{ gte: 2026-10-31T18:00Z, lt: 2026-11-24T18:00Z }`. Either side may be absent.
    - An invalid date (`'2026-02-30'`) throws.
  - **`maskName`:**
    - `"Rahim Uddin"` → `"Rahim U***"`
    - `"  Md   Karim Hasan "` → `"Md K*** H***"`
    - `"Rahim"` → `"Ra***"`
  - **`calculateFee`** with the seed rules:
    - SEND_MONEY `10_000n` → fee `0n`; `10_001n` → fee `500n`
    - CASH_OUT `100_000n` → `{ fee: 1_850n, commission: 400n }`
    - CASH_OUT `33_333n` → `{ fee: 617n, commission: 133n }` (half-up)
    - a `null` rule → `{ 0n, 0n }`
    - commission > fee → throws
  - **`buildPostings`:**
    - SEND_MONEY ৳500 with fee ৳5 → `[−50_500n, +50_000n, fees +500n]`, matching design §8.3
    - CASH_OUT ৳1,000 → `[−101_850n, +100_400n, fees +1_450n]`
    - a zero fee → **2 postings** (no fees posting)
    - CASH_OUT with fee = commission → 2 postings
    - PAYMENT ৳250 with merchant fee ৳2 → `[−25_000n, +24_800n, fees +200n]`
    - every result sums to `0n`
  - **`FLOWS`:** a snapshot test of the table, so a change to who may pay whom is a visible diff.
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, lint and typecheck.**

### Task 2: One PIN lockout for login and money
**⚙️ Effort: extra-high.** This refactors security code that already has tests. Behaviour must not change for login.

**Files:**
- Create: `server/src/modules/auth/pinLockout.ts`, `server/tests/helpers/actors.ts`
- Modify: `server/src/modules/auth/session.service.ts` (login uses it)
- Test: `server/tests/auth.pinLockout.test.ts` (new). `server/tests/auth.session.test.ts` must pass **unchanged**.

`tests/helpers/actors.ts` (used by every later task): `createActor({ phone, nid, role, status = 'ACTIVE', pin = '48213', name?, shopName? })` returns `{ user, wallet, token }`, with a real `hashPin` and `signAccessToken`. Admins get no wallet.

**Interfaces produced:**
```ts
export async function verifyPinWithLockout(
  user: Pick<User, 'id' | 'pinHash' | 'lockedUntil'>,
  pin: string,
  opts: {
    meta: { ip?: string };
    wrongPin: (attemptsLeft: number) => AppError;   // login: INVALID_CREDENTIALS; money: INVALID_PIN
    failedAction: 'LOGIN_FAILED' | 'TRANSACTION_PIN_FAILED';
  },
): Promise<void>                                    // resolves on the right PIN; throws otherwise
export const invalidPin: (attemptsLeft: number) => AppError   // 403 INVALID_PIN, 'Wrong PIN', { attemptsLeft }
```
Move the existing login logic into it **as it is**:
- the "locked means locked" check
- the atomic attempt claim before bcrypt
- the P2025 → `ACCOUNT_LOCKED` path
- lock on the third failure, with the counter back to 0 and an `ACCOUNT_LOCKED` audit
- the `failedAction` audit with `attemptsLeft`
- a reset to 0 on the right PIN

`MAX_PIN_ATTEMPTS` and `LOCK_MS` move with it. Re-export them from `session.service.ts` if tests import them from there. `login()` keeps its own phone lookup and its FROZEN check **after** a correct PIN.

- [ ] **Step 1: Write the failing tests** (`auth.pinLockout.test.ts`, calling `verifyPinWithLockout` directly, with users from `createActor`):
  - right PIN → resolves; `failedPinAttempts` back to 0
  - wrong PIN → throws what `wrongPin(2)` returns; the counter is 1; one audit row with `failedAction` and `{ attemptsLeft: 2 }`
  - the third wrong PIN → 423 `ACCOUNT_LOCKED`; `lockedUntil` is about 30 minutes ahead; the counter is 0; an `ACCOUNT_LOCKED` audit row
  - while locked, even the right PIN → 423
  - 5 parallel wrong PINs → none resolve, the account ends up locked, and no more than 3 bcrypt compares happened (count the `failedAction` + `ACCOUNT_LOCKED` audit rows: at most 3 in total)
  - **Shared counter:** 2 wrong PINs here, then a wrong `POST /auth/login` → 423 (it was the third)
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement**, then switch `login()` to it. **Step 4: Run all tests.** `auth.session.test.ts` passes without edits. Then lint and typecheck.

### Task 3: Rules, parties and limit checks (database code)
**⚙️ Effort: extra-high.** The time windows and the "which wallet counts" rules have to be exactly right.

**Files:**
- Create: `server/src/modules/transactions/rules.ts`, `server/src/modules/transactions/limits.ts`, `server/src/modules/transactions/parties.ts`
- Modify: `server/tests/helpers/actors.ts`
- Test: `server/tests/transactions.limits.test.ts`, `server/tests/transactions.parties.test.ts`

**Interfaces produced:**
```ts
type Db = PrismaClient | Prisma.TransactionClient;

// rules.ts
export async function loadRules(db: Db, type: FlowType): Promise<{ fee: FeeRule | null; limit: LimitRule | null }>
export async function loadCustomerMaxBalance(db: Db): Promise<bigint>   // system_settings; missing → throw Error

// limits.ts
export function checkAmountBounds(limit: LimitRule | null, amount: bigint): void           // AMOUNT_BELOW/ABOVE_*
export async function checkPeriodLimits(db: Db, a: { type: FlowType; limit: LimitRule | null;
  customerWalletId: string; side: 'from' | 'to'; amount: bigint; now: Date }): Promise<void> // LIMIT_EXCEEDED
export function checkBalanceCap(a: { receiverType: WalletType; balance: bigint; credit: bigint; cap: bigint }): void

// parties.ts
export interface Party { name: string; phone: string | null; role: Role | 'SYSTEM' }
export async function findAccountByPhone(db: Db, phone: string): Promise<(User & { wallet: Wallet | null }) | null>
export function toParty(user: User | null): Party           // null (system wallet) → { name: 'PocketPay', phone: null, role: 'SYSTEM' }
export function assertReceiver(flow: FlowType, initiator: User, receiver: (User & { wallet: Wallet | null }) | null): asserts receiver is User & { wallet: Wallet }
// checks in this order: not found or ADMIN → 404 RECEIVER_NOT_FOUND; same id → CANNOT_SEND_TO_SELF;
// role ≠ FLOWS[flow].receiver → INVALID_RECEIVER; status ≠ ACTIVE → RECEIVER_NOT_ACTIVE
```
`checkPeriodLimits` details:
- Use `db.transaction.aggregate` twice (from the day start and from the month start), with `where: { type, status: 'COMPLETED', [side === 'from' ? 'fromWalletId' : 'toWalletId']: customerWalletId, createdAt: { gte } }`, `_count: true` and `_sum: { amount: true }`.
- Fail when `count + 1 > maxCount`, or `sum + amount > maxAmount`.
- Check in this order: DAY COUNT, DAY AMOUNT, MONTH COUNT, MONTH AMOUNT.
- NULL means no limit; a NULL `limit` rule means no checks at all.

Add to `tests/helpers/actors.ts`: `setLimit(type, patch)` and `setSetting(key, value)`, for tests that need a tighter limit or cap.

- [ ] **Step 1: Write the failing tests** (seed rules with `seedSystem()` from `tests/helpers/seed.ts`):
  - `checkAmountBounds` with the SEND_MONEY rule:
    - `999n` → `AMOUNT_BELOW_MINIMUM` `{ min: '1000' }`
    - `1_000n` → OK
    - `5_000_001n` → `AMOUNT_ABOVE_MAXIMUM`
    - PAYMENT has no max: `10_000_000_000n` → OK
  - `checkPeriodLimits`:
    - with `maxCountDay = 2` after 2 real sends today → `LIMIT_EXCEEDED { period: 'DAY', kind: 'COUNT', limit: '2', used: '2' }`
    - a daily amount: ৳45,000 sent today + ৳5,000.01 more → DAY AMOUNT
    - only the right `type` and only COMPLETED rows count: a CASH_OUT doesn't count toward SEND_MONEY
    - **CASH_IN counts the receiving customer:** an agent cashing in to customer X twice with `maxCountDay = 2` → the third is refused for X; the same agent can still cash in to customer Y
    - **Review focus #4:** call it with `now = tomorrow (Dhaka)` → the day limit doesn't see today's rows, but the month limit does (as long as it's still the same month)
  - `checkBalanceCap`: a CUSTOMER at cap − 100 credited 100 → OK; 101 → `RECEIVER_BALANCE_LIMIT`; an AGENT is never capped
  - `assertReceiver`: one test per error, in the order listed, plus the happy path for each of the 4 flows; an ADMIN's phone → `RECEIVER_NOT_FOUND`
  - `toParty`: a customer → masked name; a merchant → its shop name; `null` → `PocketPay`
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, lint and typecheck.**

### Task 4: The transfer service (`executeTransfer` and `previewTransfer`)
**⚙️ Effort: extra-high.** This is where every rule meets the ledger.

**Files:**
- Create: `server/src/modules/transactions/transfer.service.ts`, `server/src/modules/transactions/receipt.presenter.ts`
- Test: `server/tests/transactions.service.test.ts`, `server/tests/transactions.concurrency.test.ts`

**Interfaces produced:**
```ts
export interface TransferRequest { type: FlowType; initiatorId: string; receiverPhone: string; amount: bigint; now?: Date }
export interface TransferPreview { type: FlowType; amount: string; fee: string; total: string; receiver: Party }
export async function previewTransfer(req: TransferRequest): Promise<TransferPreview>
export async function executeTransfer(req: TransferRequest & { pin: string; note?: string; idempotencyKey: string;
  meta: { ip?: string } }): Promise<{ receipt: PublicReceipt; replayed: boolean }>
// Exported so tests can run the guard on its own through postTransaction.
export function makeTransferGuard(a: { type: FlowType; initiatorId: string; receiverId: string;
  limit: LimitRule | null; customerWalletId: string; receiverWalletId: string; credit: bigint; now: Date }):
  NonNullable<PostTransactionInput['guard']>

// receipt.presenter.ts
export interface PublicReceipt {
  trxId: string; type: TransactionType; status: TransactionStatus;
  amount: string; fee: string; note: string | null; createdAt: string;   // ISO
  from: Party; to: Party;
  mine: { amount: string; balanceAfter: string };   // the caller's own signed entry ("-50500")
}
export function toReceipt(t: Transaction & { entries: LedgerEntry[] }, parties: { from: User | null; to: User | null },
                          myWalletId: string): PublicReceipt
```
- `total` is what leaves the sender: the absolute value of the `from` posting.
- **`executeTransfer`** follows the request order from Global constraints.
- The guard (`async ({ tx, wallets }) => …`) does, in this order:
  1. re-read **both** users' `status` with `tx`: initiator not ACTIVE → `ACCOUNT_NOT_ACTIVE`; receiver → `RECEIVER_NOT_ACTIVE`
  2. `checkPeriodLimits` on the customer's wallet, the side from `FLOWS`
  3. if the receiver's wallet is a CUSTOMER wallet: `checkBalanceCap`, using the **locked** balance from `wallets` and the receiver's credit
- `previewTransfer` runs steps 2–4 of the request order (no PIN), then the same three guard checks **without** a lock (plain reads), plus a balance check. A sender who can't cover the total → `INSUFFICIENT_BALANCE`.
- The idempotency key is the client's UUID, passed straight to `postTransaction`, which handles replays.

- [ ] **Step 1: Write the failing tests** (`seedSystem()`, `createActor` from Task 2, funded with the Phase 4 `fund` helper):
  - **Per flow, exact ledger results:**
    - Send ৳500 → sender −50_500n, receiver +50_000n, fees +500n
    - Send exactly ৳100 → fee 0, 2 entries; ৳100.01 → fee 500n (**Review focus #3**)
    - Cash Out ৳1,000 → −101_850n / +100_400n / +1_450n
    - Cash In ৳5,000 → agent −500_000n, customer +500_000n
    - Payment ৳250 → 2 entries; with the PAYMENT fee rule set to `percentBp: 100` → merchant +24_750n, fees +250n
  - **The receipt:** `toReceipt` gives the sender `mine.amount = "-50500"` and the right `balanceAfter`; `from` and `to` are masked parties; money fields are strings
  - **Order of checks:** a wrong receiver phone **and** a wrong PIN → `RECEIVER_NOT_FOUND`, and `failedPinAttempts` stays 0. An amount below the minimum with a wrong PIN → `AMOUNT_BELOW_MINIMUM`, counter still 0.
  - **Wrong PIN** → 403 `INVALID_PIN { attemptsLeft: 2 }`, and no transaction
  - **Review focus #5:** freeze the initiator (`prisma.user.update`) → `ACCOUNT_NOT_ACTIVE { status: 'FROZEN' }`. A PENDING_KYC initiator → the same code with that status.
  - **The guard re-reads the status:** call `postTransaction` directly with `makeTransferGuard(...)` for a Send, after freezing the receiver in the DB → `RECEIVER_NOT_ACTIVE`, nothing written. Freezing the initiator instead → `ACCOUNT_NOT_ACTIVE`. This proves the in-transaction re-check works on its own, not only the pre-check.
  - **Cap:** a receiver at cap − ৳100 gets ৳100 → OK; ৳100.01 → `RECEIVER_BALANCE_LIMIT`; nothing written
  - **Idempotency:** the same key twice → the second has `replayed: true` and the same `trxId`; the balance moved once
  - **Preview:**
    - Send ৳500 → `{ fee: "500", total: "50500", receiver: { name: "Karim H***", … } }`, and **nothing written**
    - over the balance → `INSUFFICIENT_BALANCE`
    - over a limit → `LIMIT_EXCEEDED`
  - `tests/transactions.concurrency.test.ts`:
    - **Review focus #1:** `maxCountDay = 3`, 10 parallel ৳10 sends from a well-funded customer → exactly 3 fulfilled, 7 `LIMIT_EXCEEDED`
    - **Review focus #2:** `CUSTOMER_MAX_BALANCE = 100_000` (৳1,000); the receiver holds ৳850; 5 different senders send ৳100 each in parallel → exactly 1 fulfilled, 4 `RECEIVER_BALANCE_LIMIT`; the receiver ends at ৳950
    - after both: `reconcileLedger()` is `ok`
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, then the concurrency file 5 times in a row.** Then lint and typecheck.

### Task 5: HTTP endpoints (money POSTs, preview, receiver lookup)
**⚙️ Effort: extra-high.** Auth, roles, headers and status codes on the money endpoints, plus concurrency over HTTP.

**Files:**
- Create: `server/src/modules/transactions/transactions.schemas.ts`, `server/src/modules/transactions/transactions.controller.ts`, `server/src/modules/transactions/transactions.routes.ts`, `server/src/modules/wallets/wallets.routes.ts`, `server/src/middlewares/idempotency.ts`
- Modify: `server/src/app.ts` (mount `/api/v1/transactions` and `/api/v1/wallets`), `server/src/middlewares/validate.ts` (add `validateQuery`), `server/src/middlewares/rateLimit.ts`
- Test: `server/tests/transactions.http.test.ts`, `server/tests/wallets.lookup.test.ts`

**Endpoints:**

| Method & path | Roles | Body / query | Success |
|---|---|---|---|
| POST `/transactions/send-money` | CUSTOMER | `{ receiverPhone, amount, pin, note? }` + `Idempotency-Key` | 201 / 200 replay |
| POST `/transactions/cash-out` | CUSTOMER | same | same |
| POST `/transactions/payment` | CUSTOMER | same | same |
| POST `/transactions/cash-in` | AGENT | same | same |
| POST `/transactions/preview` | CUSTOMER, AGENT | `{ type, receiverPhone, amount }` | 200 `TransferPreview` |
| GET `/wallets/lookup?phone=` | CUSTOMER, AGENT | query | 200 `{ name, role }` (a `Party` without the phone) |

- **Schemas:**
  - `receiverPhone` uses `phoneSchema`
  - `amount` uses `poishaSchema`
  - `pin` is 5 digits, with Bangla digits converted (format only, no strength rules)
  - `note` is optional, trimmed, 1–50 characters
  - preview `type` is one of the 4 flows. The flow's initiator role must match the caller's role → 403 `FORBIDDEN`.
- **`requireIdempotencyKey`:** the `Idempotency-Key` header must be a UUID (`z.uuid()`) → `res.locals.idempotencyKey`. Otherwise → 400 `IDEMPOTENCY_KEY_REQUIRED`.
- **Limiters:**
  - `moneyLimiter`: 30 per minute per IP, on the 4 POSTs and preview
  - `lookupLimiter`: 30 per minute per IP, which slows down phone-number enumeration
- **Middleware order on a money POST:**
  1. `requireAuth`
  2. `requireRole`
  3. `moneyLimiter`
  4. `requireIdempotencyKey`
  5. `validateBody`
  6. the controller
- **`validateQuery(schema)`** sets `res.locals.query`. It never writes to `req.query` (Express 5).

- [ ] **Step 1: Write the failing tests** (`createApp({ storage: new MemoryStorage() })`, actors with tokens):
  - each POST's happy path → 201, `data.receipt.trxId` matches the trxId pattern, money fields are strings, and `replayed: false`
  - the same `Idempotency-Key` again → 200, `replayed: true`, the same `trxId`
  - the same key with a different amount → 409 `IDEMPOTENCY_KEY_REUSED`
  - no header, or `abc` → 400 `IDEMPOTENCY_KEY_REQUIRED`
  - no token → 401; an AGENT calling send-money → 403 `FORBIDDEN`; a CUSTOMER calling cash-in → 403
  - a bad amount (`"15.50"`) or a bad phone → 400 `VALIDATION_ERROR`, and the PIN counter is untouched
  - the error codes reach the client with the right HTTP status: one request each for `INVALID_PIN` (403), `ACCOUNT_LOCKED` (423), `INSUFFICIENT_BALANCE` (422) and `LIMIT_EXCEEDED` (422)
  - **The response never contains** `pinHash`, `nidNumber` or the receiver's full name (check the serialized body with `not.toContain`)
  - preview: 200 with fee and total; an AGENT previewing SEND_MONEY → 403
  - lookup:
    - a customer's phone → `{ name: 'Rahim U***', role: 'CUSTOMER' }`
    - a merchant → its shop name
    - an unknown or admin phone → 404 `RECEIVER_NOT_FOUND`
    - a bad phone → 400
  - **Over HTTP:**
    - 20 parallel ৳100 send-money requests (different keys) from a ৳1,000 wallet → exactly 10 × 201 and 10 × 422 `INSUFFICIENT_BALANCE`
    - 5 parallel identical requests (same key) → 1 × 201 + 4 × 200 with `replayed: true`, and the money moved once
    - then `reconcileLedger()` is `ok`
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, then `transactions.http.test.ts` 3 times in a row.** Then lint and typecheck.

### Task 6: History and receipts
**⚙️ Effort: high.** Read-only endpoints with keyset pagination.

**Files:**
- Create: `server/src/modules/transactions/history.service.ts`
- Modify: `transactions.routes.ts`, `transactions.controller.ts`, `transactions.schemas.ts`, `receipt.presenter.ts`
- Test: `server/tests/transactions.history.test.ts`

**Endpoints** (any role with a wallet; an admin, who has no wallet, gets an empty list and a 404 for receipts):
- `GET /transactions?type=&from=&to=&cursor=&limit=`:
  - `type` is any TransactionType (agents see FLOAT_TOPUP)
  - `from` and `to` are `YYYY-MM-DD` Dhaka dates, inclusive, through `dhakaDateRange`
  - `cursor` is a `seq` string
  - `limit` is 1–50, default 20
  - → `{ items: HistoryItem[], nextCursor: string | null }`
- `GET /transactions/:trxId` → `PublicReceipt` for the caller. The trxId format is validated (400 otherwise). If the caller's wallet has no entry in that transaction → 404 `TRANSACTION_NOT_FOUND`, the same as an unknown id, so nobody can probe other people's trxIds.

```ts
export interface HistoryItem {
  trxId: string; type: TransactionType; direction: 'IN' | 'OUT';
  amount: string;          // absolute value of the caller's own entry (what their balance actually changed by)
  counterparty: Party;     // the other side: for the sender, `to`; for anyone credited, `from`
  balanceAfter: string; createdAt: string;
}
```
- **The query:** the caller's `ledger_entries`, ordered by `seq DESC`, with `seq < cursor` when a cursor is given, `take: limit + 1` to know whether there's a next page, and filters through the `transaction` relation.
- **Include** each transaction's `fromWallet.user` and `toWallet.user` (the relation names in schema.prisma).

- [ ] **Step 1: Write the failing tests:**
  - after a Send ৳500 and a Cash Out:
    - the sender's history has 2 items, newest first
    - the send shows `direction: 'OUT'`, `amount: "50500"`, and the counterparty is the receiver (masked)
    - the receiver's history shows `IN` and `"50000"`, with the sender as counterparty
  - the agent's history after the Cash Out: `IN`, `"100400"` (with commission)
  - a FLOAT_TOPUP the agent received → the counterparty is `{ name: 'PocketPay', role: 'SYSTEM' }`
  - pagination: 25 transactions, limit 10 → pages of 10, 10, 5; `nextCursor` null on the last page; no repeats or gaps
  - the `type` filter; the date filter, using 2 transactions and a `to` date that excludes today
  - receipt:
    - the sender and the receiver each get their own `mine`
    - a third customer → 404 `TRANSACTION_NOT_FOUND`
    - an unknown valid-format id → 404
    - `abc` → 400
  - nothing in any response contains `pinHash` or `nidNumber`
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, lint and typecheck.**

### Task 7: Docs and the pull request
**⚙️ Effort: high.** Writing, plus checking the docs against the code.

**Files:**
- Modify: `docs/design.md`, `docs/api.md`, `README.md`

- [ ] **Step 1: Update `docs/design.md`:**
  - §6.4: replace the "cover the money they send" line with the "Limits count against" column rule from this plan's flow table (CASH_IN counts against the receiving customer; agents and merchants have no period limits)
  - §6.3: Payment's merchant fee is deducted from the merchant's credit
  - §8.4:
    - mark steps 1–2 and the guard as implemented, with the request order (receiver and amount checked **before** the PIN)
    - replace "write an audit log entry" with the no-audit-per-movement decision
  - §10: the PIN lockout is shared by login and money requests; the audit log line now says "failed PINs and lockouts on money requests" instead of "money movements"
  - §15: a "Phase 5 build" block with decisions J–N:
    - J. Limits count against the customer in every flow
    - K. The receiver must be ACTIVE
    - L. One PIN lockout for login and money
    - M. No audit row per money movement
    - N. Merchants are shown by shop name
- [ ] **Step 2: Update `docs/api.md`:** every new endpoint, with a request and response example (money as poisha strings), the `Idempotency-Key` header, 201 vs 200 replay, and the new error codes table.
- [ ] **Step 3: Update `README.md`:**
  - status: Phase 5 complete
  - a short "Try it with curl" block: log in as Rahim (`01800000002` / `48213`), then send ৳500 to Karim (`01800000003`) with an `Idempotency-Key`
- [ ] **Step 4: Run everything:**
  - `npm test`; the two concurrency files 3 times each; lint; typecheck
  - `npm run db:seed` (it must still replay cleanly) and `npm run ledger:check` on the dev DB

  Then stop. The user commits, pushes `feat/money-flows` and opens the PR.

---

**Phase 5 is done when:**
- all tests pass, including the concurrency files 3–5 times in a row, with lint and typecheck clean
- the four flows, preview, lookup, history and receipts work over HTTP, with the exact ledger results from design §8.3
- `npm run ledger:check` is OK on the dev DB
- the PR is reviewed by a fresh session and merged into `main`
