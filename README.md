# PocketPay

A mobile-first digital wallet (bKash-style) built as a full-stack, production-grade project.

> 🚧 Work in progress — **Phase 2 (repo setup) complete**; next up: Phase 3 (auth + registration).

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
- [Phase 2 plan](docs/plans/2026-11-23-phase-2-repo-setup.md)

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
3. Start the API (on `http://localhost:4000`):
   ```bash
   cd server && cp .env.example .env && npm ci && npm run dev
   ```
4. In a second terminal, start the web app (on `http://localhost:5173`):
   ```bash
   cd client && npm ci && npm run dev
   ```
5. Open <http://localhost:5173>. You should see **API status: ok**.

### Useful commands
| Where | Command | What it does |
|---|---|---|
| `server/` | `npm test` | Run the API tests (Vitest) |
| `server/` | `npm run lint` | Lint with ESLint |
| `server/` | `npm run typecheck` | Type-check with `tsc` |
| `client/` | `npm run build` | Type-check and build for production |
| `client/` | `npm run lint` | Lint with oxlint |
| repo root | `docker compose down` | Stop the database (data is kept) |
| repo root | `docker compose down -v` | Stop the database **and delete its data** |
