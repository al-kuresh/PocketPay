# PocketPay — Design Document

> A bKash-style mobile wallet, built as a full-stack, production-grade portfolio project.
> Status: **v2 — Approved 2026-11-23** · Last updated: 2026-11-23
> v2 changes: NID at registration, image uploads, orange & white palette, fees and limits modelled on bKash.

---

## 1. Why this project exists

PocketPay is a portfolio project for getting a **junior software engineer / trainee / intern role in Bangladesh**.
It should show a recruiter or interviewer three things:

1. **Full-stack skill.** A React frontend, a Node/Express API and a PostgreSQL database, all deployed with a live link.
2. **Engineering maturity.** Clean structure, validation, tests, CI, Docker, environment config and a good README.
3. **Correct handling of money.** That's the part most student "bKash clones" get wrong, and the part fintech interviewers ask about.

It's also a learning project. Every file is added one at a time with an explanation of what it does and why it exists.

### What success looks like
- A live URL where a visitor can log in with demo accounts and send money, cash in, cash out and pay a merchant.
- An admin panel that shows users, transactions, KYC and system balances.
- A GitHub repo with a clear README, an architecture diagram, an ER diagram, passing CI and a clean commit/PR history.
- The developer can explain every design decision in an interview.

---

## 2. Goals, non-goals and anti-goals

### Goals
- A mobile-first web app that looks and feels like a phone wallet app in the browser.
- Four roles: **Customer, Agent, Merchant, Admin**.
- Core money flows: **Send Money, Cash In, Cash Out, Payment**, plus an admin **agent float top-up**.
- Transaction history, receipts, fees and limits.
- Money is never created or lost by a bug or by two requests arriving at once.
- Deployed to the internet with a demo dataset.

### Non-goals (v1)
- Real money, real banks or a real SMS gateway.
- Real NID verification against the government Election Commission database. v1 checks the format, checks the number is unique, and has an admin review the uploaded images.
- A native Android/iOS app (React Native is a possible v2).
- Mobile recharge, Add Money from a bank, QR payments, bill pay, Priyo Agent discount, savings or loans (v2 candidates).
- Multiple currencies (BDT only).

### Anti-goals (these would make it a failure even if it "works")
- A balance column updated directly with no record of why it changed.
- Money stored as floating-point numbers (`0.1 + 0.2 ≠ 0.3`).
- Secrets (`.env`, DB passwords, JWT keys) committed to GitHub.
- A UI that only looks right on a desktop.
- Copying bKash's name, logo or brand colours. PocketPay has its own orange & white brand.
- Real personal data in the demo. Seed data is fake: fake names, fake phone numbers, fake NID numbers and placeholder images. The live demo shows a warning: "Do not upload a real NID".

---

## 3. Constraints

| Constraint | Effect on the design |
|---|---|
| Solo developer, learning while building | Simple structure that's easy to follow; no microservices. |
| Zorin OS (Ubuntu-based Linux), VS Code + Claude Code | Postgres runs in Docker Engine + the Compose plugin, published on host port 5433 so it can't clash with an apt-installed PostgreSQL. `.gitattributes` still forces LF, so Windows contributors can't introduce CRLF. |
| Free hosting | Must run on free tiers (see §12). Cold starts are acceptable. |
| Recruiters spend about 2 minutes | Demo login buttons on the login page; a README with screenshots and a GIF. |
| BD market | TypeScript + React + Node + SQL, the keywords that show up most in BD job posts. |

---

## 4. Approaches considered

| Option | Stack | Trade-off | Decision |
|---|---|---|---|
| **A** | React + Vite + TS · Node + Express + TS · PostgreSQL + Prisma | Strong JS-market fit, and Postgres handles money transactions safely. Express needs our own structure. | ✅ **Chosen** |
| B | MERN (MongoDB) | Most keyword matches, but a weaker fit for money (multi-document transactions, no strict schema). | ❌ Saved for the next project (Research Paper & Project Management System) |
| C | Django REST + React | Already on the CV, so the fastest to build, but it adds no new skill. | ❌ |

**Frontend form:** a mobile-first responsive web app, chosen over React Native. Reason: one codebase, the admin panel lives in the same app, and recruiters can open a link without installing anything. React Native stays a v2 option.

---

## 5. Users and roles

| Role | How the account is created | What they can do |
|---|---|---|
| **Customer** | Self-registers: phone + OTP, NID + photos, PIN | Send Money, Cash Out (at an agent), Payment (to a merchant), view history |
| **Agent** | Same registration, picks "Agent" | Cash In to customers, receive Cash Outs, earn commission, view history |
| **Merchant** | Same registration, picks "Merchant" (+ shop name) | Receive Payments, view history |
| **Admin** | Created only by the seed script (never through the API) | Review KYC (NID + photos), approve or freeze users, top up agent float, edit fees and limits, view all transactions, run reconciliation |

Account status: `PENDING_KYC → ACTIVE ⇄ FROZEN`, plus `REJECTED`.
- A new account can log in and see its dashboard, but it **can't move money until an admin approves its KYC**.
- Only `ACTIVE` accounts can move money.
- For the live demo, a `KYC_AUTO_APPROVE=true` setting lets a recruiter who registers a new customer account start using it immediately. Agents and merchants always need manual approval. The seeded demo accounts are already approved.

---

## 6. Features in v1

### 6.1 Auth
- Registration is a 4-step wizard:
  1. **Phone** → mock OTP
  2. **Verify OTP** → the server returns a short-lived registration token (15 min)
  3. **Identity:** full name, date of birth (must be 18+), **10-digit NID number**, role (Customer / Agent / Merchant), shop name for merchants
  4. **Photos + PIN:** NID front, NID back and a selfie (used as the profile photo), then set and confirm a 5-digit PIN

  Step 4 sends everything as one `multipart/form-data` request. The user and wallet are created with status `PENDING_KYC`.
- Validation:
  - BD phone: `^01[3-9]\d{8}$`
  - NID: `^\d{10}$`, unique across all users
  - PIN: 5 digits, not all the same digit (e.g. 11111) and not a simple sequence (12345)
- The NID number is **masked everywhere** (e.g. `*******123`) except on the admin KYC review screen.
- **OTP is mocked:** in dev/demo mode the OTP is logged and returned in the API response. The code sits behind an `OtpProvider` interface, so a real SMS provider can be plugged in later.
- Login: phone + PIN, which returns an access token and a refresh token.
- PIN lockout: 3 wrong attempts locks login for 30 minutes (configurable).
- Change PIN and log out (revokes the refresh token).

### 6.2 Wallet and dashboard
- Balance (hidden until tapped, like real wallet apps), quick-action grid and recent transactions.
- Receiver lookup by phone shows the receiver's partially masked name before you confirm, e.g. "Rahim U***".

### 6.3 Money flows
Every flow uses the same steps in the UI: **Enter details → Preview (fee + total) → Confirm with PIN → Receipt**.

Seeded fees are **modelled on bKash's published charges** (checked on 2026-11-23). PocketPay is not bKash, and every value is editable from the admin panel.

| Flow | Who → Who | Fee (seed default) | Notes |
|---|---|---|---|
| Send Money | Customer → Customer | Free up to ৳100; **৳5** per transaction above ৳100 | Can't send to yourself or to a non-customer |
| Cash In | Agent → Customer | Free | Agent needs enough e-money float |
| Cash Out | Customer → Agent | **1.85%** (৳18.50 per ৳1,000) | The agent's commission is 0.40% of the amount (my assumption; I couldn't find a public rate). The rest is platform revenue |
| Payment | Customer → Merchant | Free for the customer | Merchant fee configurable, default 0. It is **deducted from the merchant's credit**: the customer pays the price only. A payment whose fee would be ≥ the amount is refused (`AMOUNT_BELOW_MINIMUM`) |
| Float Top-up | System → Agent | Free | Admin only; represents the agent buying e-money |

### 6.4 Limits (seed defaults, modelled on bKash's published customer limits)

| Type | Count / day | Count / month | Min per trx | Max per trx | Max / day | Max / month |
|---|---|---|---|---|---|---|
| Send Money | 100 | 250 | ৳10 | ৳50,000 | ৳50,000 | ৳3,00,000 |
| Cash In | 100 | 250 | ৳50 | ৳50,000 | ৳50,000 | ৳3,00,000 |
| Cash Out | 100 | 250 | ৳50 | ৳30,000 | ৳30,000 | ৳2,00,000 |
| Payment | no limit | no limit | ৳1 | no limit | no limit | no limit |

- **Maximum wallet balance for customers: ৳5,00,000.** Any incoming Send Money or Cash In that would push a customer above this is rejected. Agent, merchant and system wallets have no cap.
- "No limit" is stored as `NULL` in `limit_rules`.
- "Day" and "month" use the **Asia/Dhaka** time zone.
- **Daily and monthly limits count against the customer in every flow:** the sending customer for Send Money, Cash Out and Payment, and the **receiving customer** for Cash In. Agents and merchants have no period limits.
- Limits count the transaction **amount** (what the receiver is sent), not amount + fee, over the customer's `COMPLETED` transactions of the same type.
- The receiver's balance cap is checked separately, and only when the receiver is a customer.

### 6.5 History and receipts
- Paginated list with filters (type, date range); each entry shows sign, amount, counterparty and time.
- Receipt page: TrxID (e.g. `PP7K2M9QXA`), date and time, parties, amount, fee, balance after, status.

### 6.6 KYC and image uploads
- KYC happens **at registration**. Every account uploads 3 images:
  - NID front
  - NID back
  - selfie (also used as the profile photo)
- The admin KYC screen shows the NID number, name and date of birth next to the 3 images. The admin can **approve** (status becomes `ACTIVE`) or **reject** with a reason (status becomes `REJECTED`).
- A rejected user sees the reason and can re-upload photos and resubmit, which puts the account back to `PENDING_KYC`.
- Users can change their **profile photo** later from the Profile page. NID images can't be changed after approval.
- **Upload rules:**
  - JPEG, PNG or WebP only, checked by the file's real content (magic bytes), not just its name
  - max 10 MB per image. The app first shrinks photos on the phone (longest side 1600px, JPEG), so a camera photo usually uploads well under 1 MB
  - resized to at most 1600px wide and re-encoded to WebP on the server, which also strips EXIF metadata such as GPS location
- **Storage:** Cloudinary.
  - NID images and selfies are stored as **private (authenticated) assets**. The API gives the admin a short-lived signed URL (5 minutes) when they open a KYC review.
  - The profile photo is served as a separate public copy: a 512×512 WebP crop of the selfie.
  - The database stores only the asset id and metadata, never the image itself.

### 6.7 Admin panel
- Dashboard: user counts, today's transaction volume, platform revenue and total float.
- Users: search, view, freeze or unfreeze.
- Unlock account (resets PIN lockout).
- KYC queue: view NID details + the 3 images side by side, then approve or reject with a reason.
- Transactions: search by TrxID, phone, type or date.
- Agent float top-up.
- Fees and limits editor.
- **Reconciliation check:** confirms the ledger balances (see §8.4).
- Audit log viewer.

---

## 7. Architecture

### 7.1 Big picture

```
 Browser (phone-sized)                    Server                          Database
┌──────────────────────┐  HTTPS/JSON  ┌────────────────────────┐   SQL   ┌──────────────┐
│ React + Vite + TS    │ ───────────▶ │ Node + Express + TS    │ ──────▶ │ PostgreSQL   │
│ Tailwind, React Router│ ◀─────────── │ routes → controllers   │ ◀────── │ (via Prisma) │
│ TanStack Query, Zustand│  access JWT │ → services → Prisma    │         └──────────────┘
└──────────────────────┘  + refresh   └────────────────────────┘
                          cookie
```

**Layers in the API.** Each layer has one job:
- **Route:** URL + middleware (auth, role, validation, rate limit).
- **Controller:** reads the request, calls a service, sends the response. No business logic.
- **Service:** business rules (fees, limits, ledger) and DB transactions.
- **Prisma:** data access.

Why: logic in services can be unit-tested without HTTP, and controllers stay thin. This is the most common "clean Express" structure interviewers expect.

### 7.2 Repository layout

```
PocketPay/
├── client/                      # React frontend
│   ├── src/
│   │   ├── main.tsx             # app entry
│   │   ├── App.tsx              # providers + router
│   │   ├── routes/              # route tree, role guards
│   │   ├── pages/
│   │   │   ├── auth/            # Login, Register wizard (Phone, Otp, Identity, PhotosAndPin), KycPending
│   │   │   ├── customer/        # Home, SendMoney, CashOut, Payment, History, Receipt, Profile
│   │   │   ├── agent/           # AgentHome, CashIn, History
│   │   │   ├── merchant/        # MerchantHome, History
│   │   │   └── admin/           # Dashboard, Users, Kyc, Transactions, Fees, Audit
│   │   ├── components/
│   │   │   ├── ui/              # Button, Input, PinInput, ImageUpload, Card, Modal, Toast...
│   │   │   └── layout/          # MobileShell, BottomNav, AdminLayout
│   │   ├── features/            # flow logic shared by pages (e.g. transfer stepper)
│   │   ├── api/                 # axios instance + one file per API module
│   │   ├── stores/              # Zustand: auth session
│   │   ├── hooks/
│   │   └── lib/                 # money formatting, phone helpers, constants
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind config / postcss config
│   └── package.json
├── server/                      # Express API
│   ├── src/
│   │   ├── server.ts            # starts HTTP server
│   │   ├── app.ts               # builds Express app (middleware + routes) — imported by tests
│   │   ├── config/env.ts        # reads + validates env vars with Zod
│   │   ├── lib/                 # prisma client, logger, otp provider, storage (Cloudinary) provider
│   │   ├── middlewares/         # auth, requireRole, validate, rateLimit, upload (multer), errorHandler, notFound
│   │   ├── modules/
│   │   │   ├── auth/            # *.routes.ts, *.controller.ts, *.service.ts, *.schema.ts
│   │   │   ├── users/
│   │   │   ├── ledger/          # the money engine: postTransaction + reconciliation
│   │   │   ├── wallets/
│   │   │   ├── transactions/    # the money flows (Phase 5), built on ledger/
│   │   │   ├── kyc/
│   │   │   └── admin/
│   │   ├── db/seed.ts           # seed functions: system wallets, fees, limits, demo users + money
│   │   ├── scripts/             # ledger-check.ts (npm run ledger:check)
│   │   └── utils/               # money (poisha), trxId generator, AppError, time (Asia/Dhaka)
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts              # entry point for npm run db:seed (calls src/db/seed.ts)
│   ├── tests/                   # integration tests (Vitest + Supertest)
│   ├── Dockerfile
│   └── package.json
├── docs/
│   ├── design.md                # this file
│   ├── api.md                   # endpoint reference
│   └── diagrams/                # ERD + architecture images
├── .github/workflows/ci.yml     # lint + typecheck + test on every push/PR
├── docker-compose.yml           # local Postgres (+ API later)
├── .gitignore
├── .gitattributes               # consistent LF line endings on every OS
├── .editorconfig
└── README.md
```

`client/` and `server/` each have their own `package.json`. That's simple to understand, and each can be deployed on its own.

### 7.3 Main libraries
(Use the latest stable versions at setup time.)

| Area | Choice | Why |
|---|---|---|
| Frontend build | Vite + React + TypeScript | Fast, and the current standard |
| Styling | Tailwind CSS | Quick mobile-first layouts; common in BD job posts |
| Routing | React Router | Standard |
| Server state | TanStack Query | Caching, loading/error states, refetch after a transaction |
| Client state | Zustand | Tiny store for the auth session |
| Forms | React Hook Form + Zod | Same Zod validation style as the backend |
| HTTP | Axios | Interceptor handles the automatic token refresh |
| API | Express + TypeScript | Most common Node framework |
| Validation | Zod | One schema validates input and gives TS types |
| ORM | Prisma | Migrations, type safety, readable schema |
| Auth | jsonwebtoken + bcryptjs (PIN hashing) | Standard; bcryptjs is pure JS, so no native build step |
| Security | helmet, cors, express-rate-limit, cookie-parser | Standard hardening |
| Uploads | multer (memory storage) + file-type + sharp + Cloudinary SDK | Receive, verify, resize, store images |
| Logging | pino | Structured logs |
| Tests | Vitest + Supertest | Fast, TS-native |
| Lint/format | ESLint (server, TS 6) · oxlint (client, TS 7 — typescript-eslint doesn't support TS 7 yet) · Prettier | Clean diffs |

---

## 8. Data model and the money engine

### 8.1 Money rule
**All money is stored as integer poisha (`BIGINT`).** ৳1 = 100 poisha.
Percentage fees are calculated in integer maths, in basis points (1 bp = 0.01%), and rounded half-up to the nearest poisha.
The API sends amounts as **strings** (e.g. `"150050"` = ৳1,500.50), because JavaScript numbers and Prisma `BigInt` don't serialise to JSON safely. The frontend formats them for display.

### 8.2 Tables

| Table | Key columns | Purpose |
|---|---|---|
| `users` | id (uuid), phone (unique), **nid_number (unique, 10 digits)**, name, date_of_birth, shop_name (merchants), pin_hash, role, status, failed_pin_attempts, locked_until, profile_photo_key, created_at, updated_at | One row per person (and admin) |
| `user_documents` | id, user_id, kind (`NID_FRONT/NID_BACK/SELFIE/PROFILE`), storage_key (Cloudinary public_id), access (`PRIVATE/PUBLIC`), mime, size_bytes, width, height, created_at | Metadata for uploaded images |
| `wallets` | id, user_id (unique; NULL for system wallets), type (`CUSTOMER/AGENT/MERCHANT/SYSTEM_FEES/SYSTEM_FLOAT`), balance (BIGINT, cached), created_at. No `version` column: concurrency is handled by row locks (§8.4), not optimistic versioning | Holds each account's balance |
| `transactions` | id, trx_id (unique, human-readable), type, status (`COMPLETED/REVERSED`), amount, fee, from_wallet_id, to_wallet_id, initiated_by (→ users: who pressed confirm, e.g. the agent for a Cash In, the admin for a Float Top-up), idempotency_key, note, created_at | One row per business event |
| `ledger_entries` | id, seq (BIGINT, auto-increment, unique), transaction_id, wallet_id, amount (signed BIGINT: − debit / + credit; never 0), balance_after, created_at. `seq` is the true order of a wallet's entries: Postgres assigns it at insert, under the wallet lock. `created_at` can't be trusted for that order: Prisma stamps `@default(now())` from the **app server's clock** when it builds the insert (not Postgres's `now()`), so it has millisecond ties, can step back when the clock is corrected, and isn't shared between API instances | The source of truth; each transaction's entries sum to **0** |
| `fee_rules` | type, flat_fee, percent_bp (basis points), agent_commission_bp, min_amount_for_fee | Configurable fees |
| `limit_rules` | type, min_amount, max_per_txn, max_count_day, max_count_month, max_amount_day, max_amount_month (NULL = no limit) | Configurable limits |
| `system_settings` | key, value | e.g. `CUSTOMER_MAX_BALANCE = 50000000` (poisha). `KYC_AUTO_APPROVE` is an env var, not a row here: it's a deployment choice (demo vs. real), not something an admin toggles |
| `kyc_submissions` | id, user_id, nid_front_id, nid_back_id, selfie_id (→ user_documents), status (`PENDING/APPROVED/REJECTED`), reviewed_by, reason, submitted_at, reviewed_at | KYC review queue (one row per attempt) |
| `otp_codes` | id, phone, code_hash, purpose, expires_at, attempts, verified_at, consumed_at, created_at | Registration OTPs |
| `refresh_tokens` | id, user_id, token_hash, family (one login session), expires_at, revoked_at, replaced_by, user_agent, ip, created_at | Refresh-token rotation and logout |
| `audit_logs` | id, actor_id, action, target_type, target_id, metadata (JSON), ip, created_at | Who did what and when |

Unique constraint: `(from_wallet_id, idempotency_key)` on `transactions`.
Indexes: `transactions(created_at)`, `transactions(from_wallet_id, created_at)`, `transactions(to_wallet_id, created_at)`, `ledger_entries(wallet_id, seq)`, `ledger_entries(wallet_id, created_at)`, `ledger_entries(transaction_id)`.
ER diagram of every table: [diagrams/erd.md](diagrams/erd.md).

### 8.3 Ledger examples (double-entry)

**Send Money ৳500, fee ৳5:**

| Wallet | Entry |
|---|---|
| Sender | −50,500 |
| Receiver | +50,000 |
| SYSTEM_FEES | +500 |
| **Sum** | **0** ✅ |

**Cash Out ৳1,000 (fee 1.85% = ৳18.50; agent commission 0.40% = ৳4):**

| Wallet | Entry |
|---|---|
| Customer | −101,850 |
| Agent | +100,400 |
| SYSTEM_FEES | +1,450 |
| **Sum** | **0** ✅ |

**Float top-up ৳50,000 to an agent:** SYSTEM_FLOAT −5,000,000 and Agent +5,000,000.
SYSTEM_FLOAT is allowed to go negative: it represents e-money issued against real cash held by the company.

### 8.4 How one transfer runs (the important part)
Money moves only through **`postTransaction`** (`server/src/modules/ledger/ledger.service.ts`), the
one function that writes `transactions`, `ledger_entries` or `wallets.balance` (the only other
write is creating a wallet with balance 0). It is pure accounting: it knows nothing about fees,
limits, PINs or roles. Each money flow (Phase 5) does its business checks and hands it the
postings (e.g. the rows in §8.3).

**In the flow, before `postTransaction`** (implemented in Phase 5, `server/src/modules/transactions/transfer.service.ts`). The order matters: the receiver and the amount are checked **before** the PIN, so a typo in either never costs a PIN attempt.
1. **Request checks, in this order:**
   1. the body (Zod) and the `Idempotency-Key` header (a UUID), in the HTTP layer
   2. the initiator: the role the flow needs (403 `FORBIDDEN`) and status `ACTIVE` (403 `ACCOUNT_NOT_ACTIVE`)
   3. the receiver: exists and isn't an admin (404 `RECEIVER_NOT_FOUND`), isn't the initiator, has the role the flow needs, is `ACTIVE`
   4. the amount bounds from `limit_rules`, the fee from `fee_rules` (a payment whose merchant fee ≥ the amount → 422 `AMOUNT_BELOW_MINIMUM`), then the postings
2. **Then the PIN**, with the lockout shared with login (§10). A wrong PIN counts an attempt and may lock the account.

**In `postTransaction`:**

3. **Validate the postings before touching the DB:** at least 2; one per wallet; `from` ≠ `to`; both `from` and `to` have a posting; `from` is debited (its posting is negative) and `to` is credited (positive), so the money moves the way the transaction row says; no posting is 0; they **sum to 0**; amount > 0; fee ≥ 0; idempotency key 1–100 characters; note ≤ 50. A violation is a bug in the calling code, so it is a plain error (500), not a user-facing code.
4. Open **one PostgreSQL transaction** (READ COMMITTED; the row locks make SERIALIZABLE unnecessary). If any later step fails, nothing is saved.
5. **Lock every posting wallet in one query:**
   ```sql
   SELECT id, type::text AS type, balance FROM wallets
   WHERE id = ANY($ids::uuid[]) ORDER BY id FOR NO KEY UPDATE
   ```
   - `ORDER BY id`: every transaction takes its locks in the same global order, so two opposite transfers (A→B and B→A) can't deadlock. A control test locks "from, then to" instead and deadlocks (`40P01`).
   - `FOR NO KEY UPDATE`, not `FOR UPDATE`: it's the lock a plain `UPDATE` takes, so money operations on the same wallet still run one at a time, but it doesn't block other sessions' foreign-key checks (`FOR KEY SHARE`) on that wallet, e.g. another transaction inserting a row that references it.
   - Prisma's query API has no row locks, so this uses `tx.$queryRaw` inside `prisma.$transaction`. A wallet that isn't found → `404 WALLET_NOT_FOUND`.
6. **Idempotency, checked after the lock:** if a transaction with this `(from_wallet, idempotency_key)` exists with the same type, amount and receiver, return it (a replay). With any difference → `409 IDEMPOTENCY_KEY_REUSED`. Checking under the lock means a parallel duplicate waits on the "from" wallet, then sees the committed row: 5 identical requests at once give 1 transaction and 4 replays. The client generates one UUID per confirm screen, so a double tap or a network retry is safe. The unique index on `(from_wallet_id, idempotency_key)` is the backstop. A replay returns **before** the guard (step 7), so a used-up limit can't block it. The flow's own checks (steps 1–2) do run again on a replay: a replay after the receiver was frozen returns `RECEIVER_NOT_ACTIVE`, not the original receipt.
7. **The guard hook:** the flow's `guard` callback runs here, under the locks and before anything is written, with the locked balances (a read-only copy: the rows are frozen, so a guard can't change what the balance check sees). Phase 5's guard (`makeTransferGuard`, implemented) does, in order, with the transaction client for every read: (a) the **sender's own balance** on the locked row (`INSUFFICIENT_BALANCE`), first, so a sender who can't pay learns nothing about the receiver's balance from the cap; step 8 stays as the backstop; (b) re-reads **both users' status**, so a freeze after the pre-checks, or under a still-valid access token, is caught (`ACCOUNT_NOT_ACTIVE` / `RECEIVER_NOT_ACTIVE`); (c) the customer's **period limits** (`limit_rules`: today's and this month's completed transactions, Asia/Dhaka time, on the side the flow table says). The window's "now" is the app's clock, read here, just before the insert: Prisma fills `created_at` (`@default(now())`) from the app's clock, not the database's, so this is the day the row lands in. An earlier "now" could only widen a window (they have no upper bound), never let a limit be passed; (d) for a customer receiver, the ৳5,00,000 **balance cap on the locked balance**. The preview **only checks things about the caller**, on unlocked reads: (a), (b), and (c) when the limits are the caller's own. It skips (d) and the receiving customer's Cash In limits, so it can't be used to probe a receiver's balance or Cash In totals. When a limit that belongs to the receiver (Cash In) stops the real POST, the error is `422 RECEIVER_LIMIT_EXCEEDED` with no details; the caller's own limit gives `LIMIT_EXCEEDED` with its period, limit and amount used. Only here are these checks binding: the customer's wallet is locked, so parallel requests can't both pass (10 parallel sends with `maxCountDay = 3` → exactly 3 succeed). Roles are checked in step 1; they don't change. Throwing aborts everything.
8. **Balance check:** each wallet's balance plus its posting must stay ≥ 0, except `SYSTEM_FLOAT` → otherwise `422 INSUFFICIENT_BALANCE`.
9. Insert the `transactions` row and its `ledger_entries` (each with `balance_after`), and set each wallet's cached `balance` to the computed value.
10. **Commit.** The deferred zero-sum trigger (§8.5) checks the entries here. If the random `trx_id` already exists, the whole transaction is retried with a new one (up to 3 attempts).

**In the flow, after commit:** return the receipt (`201`, or `200` with `replayed: true` for a replay). There is **no audit row per money movement**: the `transactions` row is already the immutable record of who, what and when (`initiated_by`, `created_at`, guard 9 in §8.5). The audit log records the *security* events of money requests: `TRANSACTION_PIN_FAILED` and `ACCOUNT_LOCKED`.

**Reconciliation** (`reconcileLedger()`, run by `npm run ledger:check`; an admin button in Phase 7). Five SQL checks, all in **one `REPEATABLE READ` transaction**, so they read the same snapshot and the report is consistent even while money is moving:
1. Every wallet's cached `balance` equals the sum of its entries (a wallet with no entries must be 0).
2. Every wallet's latest entry (highest `seq`) has `balance_after` equal to its `balance`.
3. Every transaction's entries sum to 0, and there are at least 2 of them (this also catches a transaction with no entries).
4. The sum of all entries is 0, and so is the sum of all cached balances (the float's negative balance is the e-money it issued).
5. Every entry's `balance_after` equals the previous entry's `balance_after` (by `seq`; 0 before a wallet's first entry) plus its own amount. Checks 1 and 2 only see the end of the chain: a cached balance that was edited and later edited back leaves wrong running balances in the middle, which only this check finds. One bad entry is reported twice: itself, and the entry after it.

The report is `ok` only when all five pass. Every mismatch is listed, and the script exits with code 1.

### 8.5 Database guards
Application code is the first line of defence; these are the last. There are 9, as raw SQL in three
migrations (Prisma can't express them, and leaves them alone in later migrations). A violated
check or trigger reaches the app as Prisma error `P2039`.

In `…_ledger_core` (7 guards):
1. `wallets_balance_non_negative` (CHECK): only `SYSTEM_FLOAT` may go below 0. Catches a bug in the balance check.
2. `wallets_owner_matches_type` (CHECK): user wallets have a `user_id`, system wallets don't. No ownerless customer wallet, no user-owned fee wallet.
3. `wallets_system_type_key` (partial unique index, `WHERE user_id IS NULL`): exactly one wallet per system type, so fees and float can't split across two rows.
4. `transactions_amount_positive` (CHECK `amount > 0`): a zero or negative amount would be meaningless or reverse the direction.
5. `transactions_fee_non_negative` (CHECK `fee >= 0`): a negative fee would pay the user out of the fee wallet.
6. `ledger_entries_no_update_delete` (trigger, `BEFORE UPDATE OR DELETE`): the ledger is append-only, so history can't be rewritten. Mistakes are fixed with a new transaction. (`TRUNCATE`, used by the tests, still works.)
7. `ledger_entries_sum_zero` (constraint trigger, `DEFERRABLE INITIALLY DEFERRED`): each transaction's entries sum to 0, checked at COMMIT once all of them are inserted. This is the double-entry rule, enforced by the database.

In `…_ledger_entry_amount_nonzero`:

8. `ledger_entries_amount_nonzero` (CHECK `amount <> 0`): a zero entry moves nothing, and a transaction made of a single 0 entry would pass the zero-sum trigger.

In `…_transactions_status_only`:

9. `transactions_status_only` (trigger, `BEFORE UPDATE`): on a posted transaction only `status` may change (e.g. to `REVERSED` later). The idempotency replay trusts the stored type, amount and receiver, and receipts and limit sums trust the rest, so any other edit would silently rewrite history. (A transaction with ledger entries also can't be deleted: the entries' foreign key is `RESTRICT`.)

(The migration's own comments number these differently: they count both transaction checks as one item, and their item 7 is a one-off backfill of wallets for existing users, not a guard.)

---

## 9. API (v1)

Base path `/api/v1`. Responses use this shape:
- Success: `{ "success": true, "data": ... }`
- Error: `{ "success": false, "error": { "code", "message", "details?" } }`

| Method & path | Who | Purpose |
|---|---|---|
| GET `/health` | public | Uptime check |
| POST `/auth/register/request-otp` | public | Send (mock) OTP |
| POST `/auth/register/verify-otp` | public | Verify OTP → short-lived registration token |
| POST `/auth/register/complete` | registration token | `multipart/form-data`: name, DOB, NID, role, shop name, PIN, `nidFront`, `nidBack`, `selfie` → creates the user (`PENDING_KYC`) and logs them in |
| POST `/auth/login` | public | Phone + PIN → tokens |
| POST `/auth/refresh` | cookie | Rotate the refresh token, issue a new access token |
| POST `/auth/logout` | user | Revoke the refresh token |
| PATCH `/auth/pin` | user | Change PIN |
| GET `/me` | user | Profile (masked NID, photo URL, KYC status) + wallet summary |
| PUT `/me/photo` | user | `multipart/form-data`: replace the profile photo |
| GET `/wallets/lookup?phone=` | active customer, agent | Masked name (or a merchant's shop name) and role of a receiver |
| POST `/transactions/preview` | customer, agent | Fee, total, balance and limit check before confirming (not the receiver's cap) |
| POST `/transactions/send-money` | customer | — |
| POST `/transactions/cash-out` | customer | — |
| POST `/transactions/payment` | customer | — |
| POST `/transactions/cash-in` | agent | — |
| GET `/transactions` | user | Own history (type, from, to, cursor, limit) |
| GET `/transactions/:trxId` | user | Own receipt |
| GET `/kyc` | user | Own KYC status (+ rejection reason) |
| POST `/kyc/resubmit` | rejected user | `multipart/form-data`: new NID front, back, selfie |
| GET `/admin/stats` | admin | Dashboard numbers |
| GET `/admin/users` · PATCH `/admin/users/:id/status` | admin | Search users / approve, freeze, unfreeze |
| GET `/admin/kyc` · GET `/admin/kyc/:id` · PATCH `/admin/kyc/:id` | admin | KYC queue / one review (full NID + 5-minute signed image URLs) / approve or reject |
| GET `/admin/transactions` | admin | All transactions |
| POST `/admin/agents/:id/float` | admin | Float top-up |
| GET/PUT `/admin/fees` · GET/PUT `/admin/limits` | admin | Edit rules |
| GET `/admin/reconcile` | admin | Ledger check |
| GET `/admin/audit-logs` | admin | Audit trail |

The 4 money POSTs require an `Idempotency-Key` header (a UUID): `201` for a new transaction, `200` with `replayed: true` for a replay. Full request and response examples: `docs/api.md`.

---

## 10. Security

- **PIN** is hashed with bcrypt and never logged or returned. Lockout after 3 failures, for 30 minutes.
  - **One lockout for login and money requests:** the same `failed_pin_attempts` / `locked_until` columns, so 3 wrong PINs on money requests lock login too, and the other way round.
  - **PIN checks are serialized per user with a row lock.** `verifyPinWithLockout` runs in one DB transaction with `SELECT … FROM users … FOR NO KEY UPDATE`, re-reads `failed_pin_attempts` and `locked_until` under that lock (never trusting the user object it was given), and does the bcrypt compare while holding it. Parallel wrong guesses still compare at most 3 PINs; parallel right PINs all pass; a crash rolls the whole check back. The audit row and the error come **after** the commit, because throwing inside would roll back the counter.
  - **One user's PIN checks queue in memory first.** `withKeyLock(user.id, …)` (`server/src/lib/keyedMutex.ts`) runs them one at a time per user before they open the DB transaction, so a waiting request holds no pool connection and one user's parallel requests can't take the pool from everyone else. Login and money requests share the queue. It is per process, so the row lock stays: it is what keeps the check correct across API instances.
- **Access token:** JWT, 15-minute life, kept **in memory** on the client (not in localStorage).
- Access tokens are stateless (15 min). Every money endpoint (Phase 5) re-reads the user's status inside its DB transaction, so a frozen account can't move money even with a valid access token.
- **Refresh token:** random value, stored **hashed** in the DB, 7-day life, **rotated** on every use, sent as an `httpOnly; Secure; SameSite` cookie. Presenting an already-rotated token more than 10 seconds after its rotation revokes the whole session (within 10 seconds it's treated as a concurrent refresh from a second tab: that request gets 409 `REFRESH_IN_PROGRESS`, its cookie is left alone, and the client retries once with the new cookie — the Phase 6 client does this).
- **Hardening:**
  - `helmet` headers.
  - Strict CORS (only the frontend origin).
  - Rate limits on auth and money endpoints. Money POSTs, preview and the receiver lookup are limited **per user**, each with its own budget (money POSTs 30 a minute, shared by the four; preview 60; lookup 30; they run after `requireAuth`), which is safe behind CGNAT. Login and OTP run before anyone is known, so they stay per IP.
  - Request body size limit.
  - Zod validation on every input.
  - Prisma parameterised queries (no SQL injection).
- **Authorization:** `requireRole()` middleware; users can only read their own transactions. A receipt for a transaction the caller's wallet has no entry in is `404 TRANSACTION_NOT_FOUND`, exactly like an unknown id, so nobody can probe other people's trxIds.
- **Secrets:** only in `.env` (git-ignored); `.env.example` is committed with placeholder values.
- **Uploads:**
  - file type, size (10 MB per image) and count limits enforced in multer (in memory, never written to disk)
  - real content checked with `file-type`
  - re-encoded with `sharp`, which strips EXIF
  - KYC images stored privately; only admins get signed, short-lived URLs
- **NID privacy:** masked in every response except admin KYC review; never written to logs.
- **Phone numbers in logs:** the request log records the method and the path **without the query string** (no `req.query`), because `GET /wallets/lookup?phone=` would otherwise log a full phone number. Header redaction (authorization, cookies) is unchanged.
- **Receiver privacy:** the receiver lookup requires an `ACTIVE` caller, so an account still in KYC or rejected can't enumerate who is on PocketPay. A receiver's balance never shows through the cap: the preview doesn't check the cap, and the guard checks the sender's own balance before it (§8.4). A Cash In customer's limits don't show either: the preview only checks things about the caller, and the POST's `RECEIVER_LIMIT_EXCEEDED` carries no details.
- **Audit log:** logins, failed PINs, admin actions (including every time an admin views a KYC record) and failed PINs and lockouts on money requests. Not every money movement: the `transactions` row is that record (§8.4).
- **Cross-site cookies:** if the frontend and API end up on different domains, the cookie needs `SameSite=None; Secure`. The alternative is serving the API behind the frontend's domain. Decide at deploy time (§12).

---

## 11. Frontend design

- **Mobile-first:** designed at about 390px wide. On a desktop the app sits in a centred phone-width frame; the admin panel uses a wider layout.
- **Brand:** an original name and logo in a **professional orange & white** palette:

  | Token | Hex | Use |
  |---|---|---|
  | `primary` | `#EA580C` | Brand colour: icons and large text on white |
  | `primary-dark` | `#C2410C` | App bar and home hero, buttons (white text: 5.2:1 contrast, passes WCAG AA), links, active tab; also the `theme-color` |
  | `primary-darker` | `#9A3412` | Button hover/pressed |
  | `primary-light` | `#F97316` | Illustrations (never behind small text) |
  | `primary-50` | `#FFF7ED` | Soft tinted backgrounds: selected rows, info boxes |
  | `canvas` | `#F8FAFC` | Page background behind the phone frame |
  | `surface` | `#FFFFFF` | Main background and cards |
  | `surface-sunken` | `#F1F5F9` | Loading skeletons, disabled fields, keypad keys |
  | `text` | `#0F172A` | Main text |
  | `text-muted` | `#64748B` | Secondary text (use `text` on `primary-50` backgrounds) |
  | `border` | `#E2E8F0` | Dividers and card outlines |
  | `border-strong` | `#8091A7` | Input and control outlines (3.2:1, WCAG 1.4.11) |
  | `success` / `warning` | `#16A34A` / `#D97706` | Status icons, fills and badge backgrounds only (fail AA as small text) |
  | `success-dark` | `#15803D` | Money-in amounts and success text (5.0:1) |
  | `warning-dark` | `#B45309` | Pending-KYC and warning text (5.0:1) |
  | `danger` | `#DC2626` | Errors and money-out amounts (4.8:1, fine as text) |
  | `container-phone` | `420px` | Max width of the phone-width app frame (`max-w-phone`) |
  | `ease-out-quint` | `cubic-bezier(0.22, 1, 0.36, 1)` | Easing for hover/press (150ms) and reveals (200ms) |

  White text on plain `#EA580C` is only 3.6:1 contrast, so every orange surface that carries white text (app bar, home hero, buttons) is `primary-dark`.
- **Detailed UI rules:** `design/TASTE.md` (source of truth for visual decisions).
- **Customer home:** the orange app bar flows into a hero block with the balance (tap to reveal), action grid (Send Money, Cash Out, Payment, History), recent transactions and a bottom nav (Home · History · Profile).
- **Transfer flow:** enter details (the amount on the phone's own numeric keypad) → preview (a receipt-style card: receiver, amount, fee, total) → PIN → success receipt (share, or copy the TrxID; on plain http, where neither API exists, an `execCommand('copy')` fallback, and failing that a toast showing the TrxID).
- **Login page:** "Try demo" buttons for Customer, Agent, Merchant and Admin.
- **Registration wizard:**
  - a progress bar (4 steps)
  - camera/gallery image picker with preview, retake and a size check before upload
  - a "Do not upload a real NID" banner on the live demo
- **KYC pending screen:** a friendly "Your account is under review" page; money actions are disabled until approval.
- **States everywhere:** loading skeletons, empty states, translated errors (a toast for a failed action, and the generic error toast for any uncaught error or rejected promise; an inline alert that stays on screen when a page's data fails to load), and money actions disabled, not hidden, while KYC is pending or rejected.
- **Accessibility basics:** labels on inputs, visible focus, enough colour contrast.
- **Home hero:** the app bar's `primary-dark` continues into a block with `rounded-b-3xl` corners that holds the balance (white text at 5.2:1, so the small "Balance" label is fine). No gradients anywhere.

### 11.1 Language and font

- **English and Bangla**, switched by a toggle in the header (and on Profile). Every user-facing string goes through i18next, with a key in both `en.json` and `bn.json`; a test fails the suite when a Bangla key is missing.
- **Bangla digits in Bangla mode:** amounts, counts and dates use `bn-BD` (`৳৯,৩৯৫.০০`, `২৫ নভে, ২০২৬`), with the same lakh grouping as English (`en-IN`). Inputs accept both digit sets. Phone numbers and TrxIDs stay in ASCII digits.
- **API errors are mapped to translated messages** (`errors.<CODE>`); an unknown code shows a generic message, never the server's `message`.
- `<html lang>` follows the language. The choice is the only thing kept in `localStorage` (`pocketpay.lang`).
- **Font:** Noto Sans Bengali (from `@fontsource/noto-sans-bengali`, bundled) for Bangla script and `৳` only, through its `unicode-range`; Latin text stays on the system font, so an English-only visit downloads no font. Weights 400, 500 and 600.

### 11.2 Client architecture

- **Stack:** React 19, Vite, Tailwind v4 (all visual values in the `@theme` block of `client/src/index.css`), React Router, TanStack Query (server state), Zustand (session and language), axios, react-hook-form + zod, lucide-react icons.
- **Session in memory:** the access token and user live only in a Zustand store, never in `localStorage` or `sessionStorage`. On start, the app calls `POST /auth/refresh` (the httpOnly cookie) to restore the session; until it settles, guarded pages show a skeleton. The session's user is kept in sync with every `GET /me`, so a KYC approval enables the money actions without a new login.
- **Single-flight refresh:** a `401 UNAUTHENTICATED` starts one shared refresh, and every waiting request is retried once with the new token. A `409 REFRESH_IN_PROGRESS` is retried once after about 300 ms; any other refresh failure clears the session (→ `/login`). Login, registration and refresh requests are never refreshed.
- **Idempotency key per confirm screen:** a v4 UUID (from `crypto.getRandomValues`: `crypto.randomUUID` only exists in secure contexts, and `dev:phone` is plain http) is created when the user reaches the PIN step and reused for every retry of that confirm, so a double tap or a network retry replays instead of paying twice. Going back and changing the transfer gets a new key.
- **Money in the client:** amounts stay poisha strings; maths uses `BigInt`. One display helper (`formatTaka`) and one input parser (`takaToPoisha`, at most 2 decimals, no floats).
- **Cache cleared on logout:** when the session becomes anonymous (logout or a failed refresh), the TanStack Query cache is cleared, so the next person on the same phone never sees the previous user's balance or history.
- **Retries:** a query retries once, and only on a network error or a 5xx; a mutation never retries on its own.
- **Routes and roles:** `/` is each role's home; a page of another role, or a money route for a non-ACTIVE user, redirects to `/`. Login and the homes are in the main bundle; registration, history, receipts, profile and the money flows are code-split (`React.lazy`) and show the same skeleton while their chunk loads.

---

## 12. Testing, CI and deployment

**Tests**
- Unit tests: fee calculation, limit checks, money formatting, trxId generator.
- Integration tests (Supertest + a real Postgres test DB in Docker):
  - auth flow
  - each money flow
  - insufficient balance
  - limit exceeded
  - wrong PIN / lockout
  - registration: duplicate NID or phone, under-18 date of birth, wrong file type, file too large (storage is mocked in tests)
  - customer balance cap
  - idempotent retry returns the same transaction
  - **concurrency test:** fire 20 parallel transfers from one wallet, then check the balance is never negative and reconciliation passes
- **Image storage has three drivers:** tests inject a `MemoryStorage` (nothing leaves the process), local dev uses `LocalStorage` (`STORAGE_DRIVER=local`, files under `server/uploads/`, git-ignored), and production uses Cloudinary (`STORAGE_DRIVER=cloudinary`).

**CI** (GitHub Actions, on every push and PR): install → lint → typecheck → test (with a Postgres service container) → build client.

**Docker**
- `docker-compose.yml` runs Postgres locally.
- The API has a `Dockerfile` for production.

**Deployment** (proposal; check free-tier terms at Phase 10):
- Frontend → Vercel
- API → Render or Railway
- Postgres → Neon or Supabase
- Images → Cloudinary (free tier)
- Migrations run on deploy; the seed script creates the demo data.
- Free API hosts may sleep when idle, so the README warns that the first request can take a few seconds.

**Production notes**
- Rate limits use an in-memory store: counters reset on restart and aren't shared across instances. With more than one instance, use a shared store (Phase 9).
- Bangladeshi mobile networks use CGNAT (many users share one IP). The money and lookup limits are already per user (Phase 5), so this now applies **only to the login/OTP limits**, which run before anyone is known. Before real use, key those by IP + phone with a more generous per-IP limit (Phase 9).
- **Limit windows and `created_at` use the app server's clock** (Prisma stamps `created_at`; the guard reads the same clock for the Dhaka day and month). With more than one API instance, keep their clocks synced (NTP).
- **Every PIN check holds a pool connection during bcrypt** (70–100 ms), because it runs under the user's row lock (§10). One user's parallel requests queue in memory and hold at most one connection (per API instance), but a burst of logins or money requests from **many** users can still take all of the pool's connections (about 10), and other requests then wait (up to `maxWait`, 5 s, before failing). Before real use, watch the pool size under load and consider a per-phone login limit (Phase 9).
- **`SYSTEM_FEES` is one hot row.** Every fee-bearing transfer (Send Money above ৳100, Cash Out) posts to it, so `postTransaction` locks it, which serializes those transfers platform-wide, guard queries included. Fine at demo scale. v2 options: split the fees wallet into several shards (pick one per transfer; reconciliation sums them), or collect fees asynchronously (post the fee to a per-transfer pending entry and sweep it into `SYSTEM_FEES` in batches).

---

## 13. Git workflow

- `main` always works and deploys. Each phase is done on a branch: `feat/auth`, `feat/ledger`, `chore/ci`, and so on.
- Commit style is Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Each phase ends with a **pull request** into `main`: a short description, screenshots for UI changes, and a green CI run. Then merge.
- Never commit `.env`, `node_modules` or build output.

---

## 14. Build phases

| # | Phase | Status | Done when… |
|---|---|---|---|
| 1 | Design doc + ER diagram | Done | This doc is approved and committed; the ERD is in `docs/diagrams/` |
| 2 | Repo setup | Done | client + server scaffolded; TS, ESLint, Prettier; Docker Postgres runs; `/health` returns OK; README skeleton |
| 3 | Auth + registration + uploads | Done | 4-step registration with NID + 3 image uploads to Cloudinary, login, refresh, logout, PIN lockout, role guard; tests pass |
| 4 | Wallet + ledger | Done | Prisma schema migrated; seed creates system wallets, admin and demo users; ledger service + reconciliation; tests pass |
| 5 | Money flows | Done | Send Money, Cash In, Cash Out, Payment, preview, idempotency, limits, fees; concurrency test passes |
| 6 | Frontend screens | Done | All customer, agent and merchant screens connected to the API; works on phone-sized screens; Profile screen with change PIN (PATCH /auth/pin) and change profile photo (PUT /me/photo), including their API endpoints |
| 7 | Admin panel + KYC review |  | All admin pages working; KYC review with signed image URLs, approve/reject/resubmit end-to-end |
| 8 | Tests + CI |  | Coverage of the critical paths; GitHub Actions green on PRs |
| 9 | Docker + production config |  | API Dockerfile; env validation; production logging; CORS/cookies set for the real domains |
| 10 | Deploy |  | Live frontend + API + DB; demo accounts work on the live link |
| 11 | README polish |  | Screenshots/GIF, architecture + ERD images, "how money is kept safe" section, setup steps, live link |

---

## 15. Decisions

**Agreed in review (2026-11-23):**
1. Money stored as integer poisha; amounts sent as strings in JSON.
2. Double-entry ledger, plus a cached balance updated in the same DB transaction.
3. Row locks taken in ascending wallet-id order, using raw SQL inside a Prisma transaction.
4. Mock OTP behind an interface; no real SMS in v1.
5. The admin exists only through the seed script.
6. **Registration requires a 10-digit NID along with the phone number.**
7. **Image upload in v1:** NID front, NID back and selfie at registration, plus a changeable profile photo.
8. **Fees and limits modelled on bKash's published values** (§6.3–6.4).
9. **Professional orange & white colour palette** (§11).
10. Access token in memory + rotating refresh token in an httpOnly cookie.
11. TanStack Query + Zustand on the frontend.
12. Separate `client/` and `server/` packages (no monorepo tooling).
13. Agent commission comes out of the cash-out fee.
14. Demo login buttons on the login page for recruiters.

**New calls I made for the v2 changes (please check):**
- A. Accounts start as `PENDING_KYC`: they can log in but can't move money until an admin approves. `KYC_AUTO_APPROVE` applies to customers only on the live demo.
- B. Only 10-digit NIDs are accepted, as requested. Older 13- and 17-digit NIDs are rejected.
- C. Users must be 18 or older.
- D. Images are stored in Cloudinary. KYC images are private with 5-minute signed URLs; the profile photo is public.
- E. Images: 10 MB max (shrunk on the phone before upload), JPEG/PNG/WebP, re-encoded to WebP and EXIF stripped.
- F. Agent commission is 0.40% of the cash-out amount (my assumption; no public figure found).
- G. Customer wallet balance is capped at ৳5,00,000, as bKash does.
- H. "Priyo Agent" discounted cash-out (bKash charges ৳13.95 per ৳1,000 up to ৳50,000 a month) is left for v2.

**Phase 4 build (2026-11-24):**
- I. **Row locks + DB guards instead of optimistic versioning.** `wallets.version` is dropped. Wallets are locked with `SELECT … ORDER BY id FOR NO KEY UPDATE` (§8.4), so concurrent operations on a wallet wait instead of failing and retrying. The database guards in §8.5 refuse negative, unbalanced or edited ledger data even if the code has a bug.

**Phase 5 build (2026-11-25):**
- J. **Limits count against the customer in every flow:** the sender for Send Money, Cash Out and Payment, the receiving customer for Cash In. Agents and merchants have no period limits. Limits count the amount, not amount + fee (§6.4).
- K. **The receiver must be ACTIVE.** Checked before the PIN and re-read inside the guard: a frozen or pending account can't receive money.
- L. **One PIN lockout for login and money:** the same counter, 3 attempts, 30 minutes.
- M. **No audit row per money movement.** The `transactions` row is the immutable record; the audit log keeps the security events (failed PINs, lockouts).
- N. **Merchants are shown by shop name**, unmasked, because it is a public business name. People are shown by masked name ("Rahim U***"), system wallets as "PocketPay".
- O. **PIN checks are serialized per user with a row lock instead of an attempt claim.** The first version claimed one of the 3 attempts before bcrypt; more than 3 parallel requests with the right PIN then got `423 ACCOUNT_LOCKED` naming a lock that didn't exist. The row lock keeps "at most 3 compares" for parallel guesses and lets parallel right PINs all pass (§10).
- P. **Money and lookup rate limits are per user**, not per IP, because of CGNAT (§10, §12). Login and OTP stay per IP.
- Q. **The preview only checks things about the caller.** It already skipped the receiver's cap; it now also skips a Cash In customer's limits, and the POST refuses those with `RECEIVER_LIMIT_EXCEEDED` and no details. Before, `LIMIT_EXCEEDED { used }` told any agent a customer's Cash In totals (§8.4, §10).
- R. **One user's PIN checks queue in memory before the row lock**, so their waiting requests hold no DB connection (§10).

**Phase 6 build (2026-11-25):**
- S. **One pull request for the whole phase**, **no mockups** (the design came from `design/TASTE.md` and a screenshot-and-measure design loop), and **English + Bangla** from the start.
- T. **The live demo shows the OTP on screen** whenever the server sends `devOtp` (not only in dev builds), because the demo has no SMS gateway.
- U. **The phone's own numeric keypad** (`inputMode="decimal"`) for amounts instead of an on-screen keypad. The PIN is five boxes over one hidden password input, so the PIN is never React state.
- V. **Registration token in React state only**, never storage or the URL: a reload restarts registration.
- W. **History filters by type and Dhaka date range, with a "Load more" button** (keyset cursor). The type list shows only the types the user's role can be part of.
- X. **OTP "Resend"** waits for the server's `resendInSeconds`, and restarts its countdown from `retryAfterSeconds` on `OTP_COOLDOWN`.
- Y. **Change photo uploads as soon as a photo is picked**; Change PIN is its own page and logs out the user's other devices (the server revokes their sessions).
- Z. **A page's load error is an inline alert, not a toast** (§11), so a failed balance or list doesn't vanish after a few seconds.

## 16. Left to the builder
- Exact component styling within the §11 palette (decided in Phase 6).
- Exact pagination size, toast library and icon set.
- Final hosting choice between equivalent free tiers (Phase 10).
