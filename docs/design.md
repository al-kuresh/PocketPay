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
| Payment | Customer → Merchant | Free for the customer | Merchant fee configurable, default 0 |
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
- The limit checks for a customer cover the money they **send**. The receiver's balance cap is checked separately.

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
  - max 2 MB per image
  - resized to at most 1600px wide and re-encoded to WebP on the server, which also strips EXIF metadata such as GPS location
- **Storage:** Cloudinary.
  - NID images and selfies are stored as **private (authenticated) assets**. The API gives the admin a short-lived signed URL (5 minutes) when they open a KYC review.
  - The profile photo is served as a separate public, resized copy.
  - The database stores only the asset id and metadata, never the image itself.

### 6.7 Admin panel
- Dashboard: user counts, today's transaction volume, platform revenue and total float.
- Users: search, view, freeze or unfreeze.
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
│   │   │   ├── wallets/
│   │   │   ├── transactions/    # the money engine lives here
│   │   │   ├── kyc/
│   │   │   └── admin/
│   │   └── utils/               # money (poisha), trxId generator, AppError, time (Asia/Dhaka)
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts              # admin, demo users, system wallets, fees, limits
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
| Auth | jsonwebtoken + bcrypt (PIN hashing) | Standard |
| Security | helmet, cors, express-rate-limit, cookie-parser | Standard hardening |
| Uploads | multer (memory storage) + file-type + sharp + Cloudinary SDK | Receive, verify, resize, store images |
| Logging | pino | Structured logs |
| Tests | Vitest + Supertest | Fast, TS-native |
| Lint/format | ESLint + Prettier | Clean diffs |

---

## 8. Data model and the money engine

### 8.1 Money rule
**All money is stored as integer poisha (`BIGINT`).** ৳1 = 100 poisha.
Percentage fees are calculated in integer maths, in basis points (1 bp = 0.01%), and rounded half-up to the nearest poisha.
The API sends amounts as **strings** (e.g. `"150050"` = ৳1,500.50), because JavaScript numbers and Prisma `BigInt` don't serialise to JSON safely. The frontend formats them for display.

### 8.2 Tables

| Table | Key columns | Purpose |
|---|---|---|
| `users` | id (uuid), phone (unique), **nid_number (unique, 10 digits)**, name, date_of_birth, shop_name (merchants), pin_hash, role, status, failed_pin_attempts, locked_until, profile_photo_id, created_at | One row per person (and admin) |
| `user_documents` | id, user_id, kind (`NID_FRONT/NID_BACK/SELFIE/PROFILE`), storage_key (Cloudinary public_id), access (`PRIVATE/PUBLIC`), mime, size_bytes, width, height, created_at | Metadata for uploaded images |
| `wallets` | id, user_id (nullable for system wallets), type (`CUSTOMER/AGENT/MERCHANT/SYSTEM_FEES/SYSTEM_FLOAT`), balance (BIGINT, cached), version, created_at | Holds each account's balance |
| `transactions` | id, trx_id (unique, human-readable), type, status (`COMPLETED/FAILED/REVERSED`), amount, fee, from_wallet_id, to_wallet_id, initiated_by, idempotency_key, note, created_at | One row per business event |
| `ledger_entries` | id, transaction_id, wallet_id, amount (signed BIGINT: − debit / + credit), balance_after, created_at | The source of truth; each transaction's entries sum to **0** |
| `fee_rules` | type, flat_fee, percent_bp (basis points), agent_commission_bp, min_amount_for_fee | Configurable fees |
| `limit_rules` | type, min_amount, max_per_txn, max_count_day, max_count_month, max_amount_day, max_amount_month (NULL = no limit) | Configurable limits |
| `system_settings` | key, value | e.g. `CUSTOMER_MAX_BALANCE = 50000000` (poisha), `KYC_AUTO_APPROVE` |
| `kyc_submissions` | id, user_id, nid_front_id, nid_back_id, selfie_id (→ user_documents), status (`PENDING/APPROVED/REJECTED`), reviewed_by, reason, submitted_at, reviewed_at | KYC review queue (one row per attempt) |
| `otp_codes` | id, phone, code_hash, purpose, expires_at, attempts, consumed_at | Registration OTPs |
| `refresh_tokens` | id, user_id, token_hash, expires_at, revoked_at, replaced_by | Refresh-token rotation and logout |
| `audit_logs` | id, actor_id, action, target_type, target_id, metadata (JSON), ip, created_at | Who did what and when |

Unique constraint: `(from_wallet_id, idempotency_key)` on `transactions`.
Indexes: `transactions(created_at)`, `transactions(from_wallet_id, created_at)`, `transactions(to_wallet_id, created_at)`, `ledger_entries(wallet_id, created_at)`.

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
Everything below happens inside **one PostgreSQL transaction**. If any step fails, nothing is saved.

1. Validate input (Zod) and check both users are `ACTIVE` and the roles match the flow.
2. Verify the PIN with bcrypt. A wrong PIN increments the attempts counter and may lock the account.
3. **Idempotency:** if a transaction with this `(from_wallet, idempotency_key)` already exists, return it instead of creating a new one. The client generates one UUID per confirm screen, so a double tap or a network retry is safe.
4. **Lock both wallets** with `SELECT ... FOR UPDATE`, **always in ascending id order** so two opposite transfers can't deadlock. Prisma's query API has no row locks, so this step uses `prisma.$queryRaw` inside `prisma.$transaction`.
5. Calculate the fee from `fee_rules` and check `limit_rules` (sum of today's and this month's completed transactions, Asia/Dhaka time).
6. Check the sender's balance ≥ amount + fee, and that a customer receiver won't go above the ৳5,00,000 balance cap.
7. Insert the `transactions` row and its `ledger_entries` (assert the sum = 0), and update each wallet's cached `balance`.
8. Commit, then write an audit log entry and return the receipt.

**Reconciliation** (admin button + script):
- For every wallet, `balance` must equal `SUM(ledger_entries.amount)`.
- The sum over all wallets must be 0.
- Any mismatch is reported.

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
| GET `/wallets/lookup?phone=` | user | Masked name and role of a receiver |
| POST `/transactions/preview` | user | Fee, total and limit check before confirming |
| POST `/transactions/send-money` | customer | — |
| POST `/transactions/cash-out` | customer | — |
| POST `/transactions/payment` | customer | — |
| POST `/transactions/cash-in` | agent | — |
| GET `/transactions` | user | Own history (type, from, to, page) |
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

Money endpoints take an `Idempotency-Key` header.

---

## 10. Security

- **PIN** is hashed with bcrypt and never logged or returned. Lockout after 3 failures.
- **Access token:** JWT, 15-minute life, kept **in memory** on the client (not in localStorage).
- **Refresh token:** random value, stored **hashed** in the DB, 7-day life, **rotated** on every use, sent as an `httpOnly; Secure; SameSite` cookie. Reusing a revoked token revokes the whole session.
- **Hardening:**
  - `helmet` headers.
  - Strict CORS (only the frontend origin).
  - Rate limits on auth and money endpoints.
  - Request body size limit.
  - Zod validation on every input.
  - Prisma parameterised queries (no SQL injection).
- **Authorization:** `requireRole()` middleware; users can only read their own transactions.
- **Secrets:** only in `.env` (git-ignored); `.env.example` is committed with placeholder values.
- **Uploads:**
  - file type, size and count limits enforced in multer (in memory, never written to disk)
  - real content checked with `file-type`
  - re-encoded with `sharp`, which strips EXIF
  - KYC images stored privately; only admins get signed, short-lived URLs
- **NID privacy:** masked in every response except admin KYC review; never written to logs.
- **Audit log:** logins, failed PINs, admin actions (including every time an admin views a KYC record) and money movements.
- **Cross-site cookies:** if the frontend and API end up on different domains, the cookie needs `SameSite=None; Secure`. The alternative is serving the API behind the frontend's domain. Decide at deploy time (§12).

---

## 11. Frontend design

- **Mobile-first:** designed at about 390px wide. On a desktop the app sits in a centred phone-width frame; the admin panel uses a wider layout.
- **Brand:** an original name and logo in a **professional orange & white** palette:

  | Token | Hex | Use |
  |---|---|---|
  | `primary` | `#EA580C` | Brand colour: header bar, balance card, icons, active tab, large text |
  | `primary-dark` | `#C2410C` | Buttons (white text: 5.2:1 contrast, passes WCAG AA), links, pressed states |
  | `primary-light` | `#F97316` | Gradient highlight on the balance card, illustrations (never behind small text) |
  | `primary-50` | `#FFF7ED` | Soft tinted backgrounds: selected rows, info boxes |
  | `surface` | `#FFFFFF` | Main background and cards |
  | `text` | `#0F172A` | Main text |
  | `text-muted` | `#64748B` | Secondary text |
  | `border` | `#E2E8F0` | Dividers, input borders |
  | `success` / `danger` / `warning` | `#16A34A` / `#DC2626` / `#D97706` | Money in / errors and money out / pending KYC |

  White text on plain `#EA580C` is only 3.6:1 contrast, so it's used only for large text (the balance amount, headings). Buttons use `primary-dark`.
- **Customer home:** balance card (tap to reveal), action grid (Send Money, Cash Out, Payment, History), recent transactions and a bottom nav (Home · History · Profile).
- **Transfer flow:** stepper with amount keypad → preview → PIN → success receipt (with a share/print option).
- **Login page:** "Try demo" buttons for Customer, Agent, Merchant and Admin.
- **Registration wizard:**
  - a progress bar (4 steps)
  - camera/gallery image picker with preview, retake and a size check before upload
  - a "Do not upload a real NID" banner on the live demo
- **KYC pending screen:** a friendly "Your account is under review" page; money actions are disabled until approval.
- **States everywhere:** loading skeletons, empty states, clear error toasts.
- **Accessibility basics:** labels on inputs, visible focus, enough colour contrast.

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

---

## 13. Git workflow

- `main` always works and deploys. Each phase is done on a branch: `feat/auth`, `feat/ledger`, `chore/ci`, and so on.
- Commit style is Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Each phase ends with a **pull request** into `main`: a short description, screenshots for UI changes, and a green CI run. Then merge.
- Never commit `.env`, `node_modules` or build output.

---

## 14. Build phases

| # | Phase | Done when… |
|---|---|---|
| 1 | Design doc + ER diagram | This doc is approved and committed; the ERD is in `docs/diagrams/` |
| 2 | Repo setup | client + server scaffolded; TS, ESLint, Prettier; Docker Postgres runs; `/health` returns OK; README skeleton |
| 3 | Auth + registration + uploads | 4-step registration with NID + 3 image uploads to Cloudinary, login, refresh, logout, PIN lockout, role guard; tests pass |
| 4 | Wallet + ledger | Prisma schema migrated; seed creates system wallets, admin and demo users; ledger service + reconciliation; tests pass |
| 5 | Money flows | Send Money, Cash In, Cash Out, Payment, preview, idempotency, limits, fees; concurrency test passes |
| 6 | Frontend screens | All customer, agent and merchant screens connected to the API; works on phone-sized screens |
| 7 | Admin panel + KYC review | All admin pages working; KYC review with signed image URLs, approve/reject/resubmit end-to-end |
| 8 | Tests + CI | Coverage of the critical paths; GitHub Actions green on PRs |
| 9 | Docker + production config | API Dockerfile; env validation; production logging; CORS/cookies set for the real domains |
| 10 | Deploy | Live frontend + API + DB; demo accounts work on the live link |
| 11 | README polish | Screenshots/GIF, architecture + ERD images, "how money is kept safe" section, setup steps, live link |

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
- E. Images: 2 MB max, JPEG/PNG/WebP, re-encoded to WebP and EXIF stripped.
- F. Agent commission is 0.40% of the cash-out amount (my assumption; no public figure found).
- G. Customer wallet balance is capped at ৳5,00,000, as bKash does.
- H. "Priyo Agent" discounted cash-out (bKash charges ৳13.95 per ৳1,000 up to ৳50,000 a month) is left for v2.

## 16. Left to the builder
- Exact component styling within the §11 palette (decided in Phase 6).
- Exact pagination size, toast library and icon set.
- Final hosting choice between equivalent free tiers (Phase 10).
