# PocketPay

A mobile-first digital wallet (bKash-style) built as a full-stack, production-grade project.

> 🚧 Work in progress — **Phase 5 (money flows) complete**: Send Money, Cash In, Cash Out and Payment over the API, with fees, limits, the balance cap, PIN checks, idempotency, preview, receiver lookup, history and receipts. Next up: Phase 6 (frontend screens).

## Features (planned for v1)
- Registration with phone, OTP, 10-digit NID, and NID/selfie photo upload
- Send Money, Cash In, Cash Out, Payment, with fees and limits modelled on bKash
- Double-entry ledger, row locking and idempotency keys, so money is never lost or duplicated
- Customer, Agent, Merchant and Admin roles, plus an admin panel with KYC review

## Tech stack
**Frontend:** React · Vite · TypeScript · Tailwind CSS
**Backend:** Node.js · Express · TypeScript · Zod
**Database:** PostgreSQL · Prisma
**Tooling:** Docker · GitHub Actions · Vitest · ESLint · Prettier

## Documentation
- [Design document](docs/design.md)
- [API reference](docs/api.md)
- [Phase 2 plan](docs/plans/2026-11-23-phase-2-repo-setup.md)
- [Phase 3 plan](docs/plans/2026-11-24-phase-3-auth-registration.md)
- [Phase 4 plan](docs/plans/2026-11-24-phase-4-wallet-ledger.md)
- [Phase 5 plan](docs/plans/2026-11-24-phase-5-money-flows.md)
- [ER diagram](docs/diagrams/erd.md)

## Run locally
### Prerequisites
- [Node.js](https://nodejs.org/) LTS — 22.18+ or 24.11+ (install via [nvm](https://github.com/nvm-sh/nvm))
- [Git](https://git-scm.com/)
- [Docker Engine](https://docs.docker.com/engine/install/) + the [Compose plugin](https://docs.docker.com/compose/install/linux/)

### Steps
1. Clone the repo:
   ```bash
   git clone git@github.com:al-kuresh/PocketPay.git && cd PocketPay
   ```
2. Start Postgres (published on `localhost:5433`):
   ```bash
   docker compose up -d
   ```
3. Create the test database (once; a brand-new Docker volume creates it automatically):
   ```bash
   docker compose exec db createdb -U pocketpay pocketpay_test
   ```
4. Configure the API, set a real `JWT_SECRET`, and apply the database migrations:
   ```bash
   cd server && cp .env.example .env
   # replace the JWT_SECRET placeholder in .env with the output of:
   openssl rand -base64 48
   npm ci && npm run db:deploy
   ```
   Then load the system wallets, fee and limit rules and the [demo accounts](#demo-accounts):
   ```bash
   npm run db:seed
   ```
5. Start the API (on `http://localhost:4000`):
   ```bash
   npm run dev
   ```
6. In a second terminal, start the web app (on `http://localhost:5173`):
   ```bash
   cd client && npm ci && npm run dev
   ```
7. Open <http://localhost:5173>. You should see **API status: ok**.

### Try the auth flow with curl
With the API running (step 5). Uses fake data; never upload a real NID. Any three JPEG photos
work (the server only checks they are real images). Full reference: [docs/api.md](docs/api.md).

```bash
API=http://localhost:4000/api/v1

# 1. Request an OTP (in dev the code comes back as devOtp; no SMS is sent)
curl -s -X POST $API/auth/register/request-otp \
  -H 'Content-Type: application/json' -d '{"phone":"01700000000"}'

# 2. Verify it (use the devOtp from step 1) and keep the registration token
REG_TOKEN=$(curl -s -X POST $API/auth/register/verify-otp \
  -H 'Content-Type: application/json' -d '{"phone":"01700000000","code":"<devOtp>"}' \
  | sed -E 's/.*"registrationToken":"([^"]+)".*/\1/')

# 3. Complete registration with 3 photos; the refresh cookie goes into cookies.txt
curl -s -X POST $API/auth/register/complete -H "Authorization: Bearer $REG_TOKEN" \
  -F name="Test User" -F dateOfBirth=1995-06-15 -F nidNumber=1234567890 \
  -F role=CUSTOMER -F pin=48213 -F confirmPin=48213 \
  -F nidFront=@front.jpg -F nidBack=@back.jpg -F selfie=@selfie.jpg \
  -c cookies.txt
# → copy "accessToken" from the response

# 4. Who am I?
curl -s $API/me -H "Authorization: Bearer <accessToken>"

# 5. Refresh (rotates the cookie) and log out
curl -s -X POST $API/auth/refresh -b cookies.txt -c cookies.txt
curl -s -X POST $API/auth/logout -b cookies.txt -c cookies.txt -o /dev/null -w '%{http_code}\n'
```

Uploaded images land in `server/uploads/` (git-ignored). Users can't be deleted (their
documents and audit history must stay), so to run the flow again use another phone and NID,
e.g. `01700000001` / `1234567891`.

### Try it with curl: send money
With the API running and the database seeded (the [demo accounts](#demo-accounts) below).
Money is poisha as a string: `"50000"` is ৳500.00.

```bash
API=http://localhost:4000/api/v1

# 1. Log in as Rahim and keep the access token
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"phone":"01800000002","pin":"48213"}' \
  | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')

# 2. Who is 01800000003? → { "name": "Karim H***", "role": "CUSTOMER" }
curl -s "$API/wallets/lookup?phone=01800000003" -H "Authorization: Bearer $TOKEN"

# 3. Preview ৳500: fee "500" (৳5), total "50500"
curl -s -X POST $API/transactions/preview -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"SEND_MONEY","receiverPhone":"01800000003","amount":"50000"}'

# 4. Send it. One new Idempotency-Key per transaction → 201 with the receipt
KEY=$(node -p 'crypto.randomUUID()')
curl -s -X POST $API/transactions/send-money -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" \
  -d '{"receiverPhone":"01800000003","amount":"50000","pin":"48213"}' \
  -w '\nHTTP %{http_code}\n'

# 5. The same request with the same key (a retry) → 200, "replayed": true, money moved once
curl -s -X POST $API/transactions/send-money -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" \
  -d '{"receiverPhone":"01800000003","amount":"50000","pin":"48213"}' \
  -w '\nHTTP %{http_code}\n'

# 6. History, newest first
curl -s "$API/transactions?limit=5" -H "Authorization: Bearer $TOKEN"
```

Then `npm run ledger:check` (in `server/`) proves the ledger still balances.

### Demo accounts
Created by `npm run db:seed`. All use the PIN **`48213`** and are already `ACTIVE`. The phones and
NIDs are fake.

| Phone | Name | Role | Starting balance |
|---|---|---|---|
| `01800000001` | Demo Admin | ADMIN | no wallet |
| `01800000002` | Rahim Uddin | CUSTOMER | ৳10,000 |
| `01800000003` | Karim Hasan | CUSTOMER | ৳5,000 |
| `01800000004` | Demo Agent | AGENT | ৳85,000 |
| `01800000005` | Demo Store | MERCHANT | ৳0 |

The balances are real ledger history, not edited numbers: the admin tops up the agent's float
by ৳1,00,000, and the agent cashes in ৳10,000 to Rahim and ৳5,000 to Karim.

### Seed and reset
- `npm run db:seed` is safe to run again: it only creates what's missing, and the demo money uses
  fixed idempotency keys, so a second run replays it instead of paying twice. It refuses to run
  with `NODE_ENV=production`, and against any database host except `localhost`, `127.0.0.1` or
  `[::1]` (the demo PIN is public). To seed another host on purpose, list it in
  `DEMO_SEED_ALLOWED_HOSTS` (see `server/.env.example`).
- To start over with an empty database: `npm run db:reset` (it asks for confirmation and
  **deletes all data**), then `npm run db:seed`, because Prisma 7's reset no longer seeds on its
  own. **Run the reset yourself**: Prisma refuses `migrate reset` when an AI agent runs it.

### Useful commands
| Where | Command | What it does |
|---|---|---|
| `server/` | `npm test` | Run the API tests (Vitest) |
| `server/` | `npm run lint` | Lint with ESLint |
| `server/` | `npm run typecheck` | Type-check with `tsc` |
| `server/` | `npm run db:seed` | Create system wallets, rules and demo accounts (safe to re-run) |
| `server/` | `npm run ledger:check` | Prove the ledger balances (exit code 1 if it doesn't) |
| `client/` | `npm run build` | Type-check and build for production |
| `client/` | `npm run lint` | Lint with oxlint |
| repo root | `docker compose down` | Stop the database (data is kept) |
| repo root | `docker compose down -v` | Stop the database **and delete its data** |
