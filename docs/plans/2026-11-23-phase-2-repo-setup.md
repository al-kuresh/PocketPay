# Phase 2 — Repo Setup: Implementation Plan

> **How to use this plan:** do the tasks in order. Each task ends with a check you can run and a commit.
> You can paste one task at a time into Claude Code in VS Code and ask it to create the files and explain each one.
> Steps use checkboxes (`- [ ]`). Tick them off as you go.

**Goal:** an empty-but-professional PocketPay repo, made of:
- a running Postgres in Docker
- an Express + TypeScript API whose `/api/v1/health` endpoint is tested
- a React + Vite + Tailwind client in the orange & white palette that calls the API

**Architecture:** two independent packages, `client/` and `server/`, with root-level repo files. The server is split into `app.ts`, which builds the app and is imported by tests, and `server.ts`, which listens on a port. In development the client reaches the API through Vite's proxy, so there's no CORS or cookie trouble locally.

**Tech stack:** Node.js LTS (24.x or newer), npm, TypeScript, Express 5, Zod, helmet, cors, cookie-parser, pino-http, tsx (dev runner), tsup (build), Vitest + Supertest, ESLint + Prettier, React + Vite, Tailwind CSS v4 (`@tailwindcss/vite`), Docker Engine + Compose plugin with `postgres:16-alpine`.

**Spec:** `docs/design.md` (approved 2026-11-23). This plan covers §7.2, §7.3, §11 (palette tokens), §13 (git workflow) and Phase 2 of §14.

## Global constraints
- Dev machine: Zorin OS (Ubuntu-based Linux). Every file uses LF line endings (enforced by `.gitattributes`).
- Never commit `.env`. Only `.env.example` with placeholder values.
- Local Postgres is published on host port **5433**, not 5432, so it can't clash with a natively installed PostgreSQL.
- API port **4000**; client dev port **5173**.
- API base path: `/api/v1`.
- Response shape: `{ "success": true, "data": … }` or `{ "success": false, "error": { "code", "message", "details?" } }`.
- Palette tokens, exactly as in §11:
  - `primary #EA580C`, `primary-dark #C2410C`, `primary-light #F97316`, `primary-50 #FFF7ED`
  - `surface #FFFFFF`, `text #0F172A`, `text-muted #64748B`, `border #E2E8F0`
  - `success #16A34A`, `danger #DC2626`, `warning #D97706`
- Git: the bootstrap commit goes straight to `main`; everything else goes on branch `chore/repo-setup` and is merged with a pull request.
- Commit messages follow Conventional Commits (`chore:`, `feat:`, `docs:`, `test:`).

## Review focus
Problems these tasks' tests won't catch, but that are likely to bite on a Zorin/Ubuntu machine:
1. **Port 5432 already used** by an apt-installed PostgreSQL → we use 5433. Check: `docker compose ps` shows `0.0.0.0:5433->5432`.
2. **`permission denied` on `/var/run/docker.sock`** → your user isn't in the `docker` group yet. Fix: run `sudo usermod -aG docker $USER`, then log out and back in. Check: `docker run hello-world` works without `sudo`.
3. **`.env` accidentally committed** → `.gitignore` covers it. Check: `git status` never lists `.env`.
4. **A missing env var** makes the server crash with a confusing error → `parseEnv` must fail with a message naming the missing key (tested in Task 3).
5. **An unknown API route returns an HTML error page** instead of JSON → the `notFound` middleware returns the JSON error shape (tested in Task 3).

---

### Task 1: Create the repo and root files

**Files:**
- Create: `.gitignore`
- Create: `.gitattributes`
- Create: `.editorconfig`
- Create: `.prettierrc`
- Create: `README.md` (skeleton)
- Add: `docs/design.md`
- Add: `docs/plans/2026-11-23-phase-2-repo-setup.md` (this file)

- [ ] **Step 1: Create the GitHub repo.** On GitHub: **New repository** → name `PocketPay` → Public → **do not** add a README, .gitignore or license (we add our own).
- [ ] **Step 2: Clone it.**
  ```bash
  cd <your projects folder>
  git clone https://github.com/<your-username>/PocketPay.git
  cd PocketPay
  code .
  ```
- [ ] **Step 3: Add the root files** listed above, using the provided versions.
- [ ] **Step 4: Check line endings and ignores.**
  - Run `git add -A && git status`. Expected: the files above are staged, and no `.env` or `node_modules` appears.
  - Run `git ls-files --eol`. Expected: every file shows `i/lf`.
- [ ] **Step 5: Commit and push to `main`.**
  ```bash
  git commit -m "chore: bootstrap repo with design doc and root config"
  git push -u origin main
  ```
- [ ] **Step 6: Start the phase branch.**
  ```bash
  git switch -c chore/repo-setup
  ```

### Task 2: Local Postgres with Docker

**Files:**
- Create: `docker-compose.yml`

**Produces:** a Postgres reachable at `postgresql://pocketpay:pocketpay@localhost:5433/pocketpay`. Task 3's `.env.example` uses exactly this URL.

- [ ] **Step 1: Write `docker-compose.yml`.** One service, `db`:
  - image `postgres:16-alpine`
  - `POSTGRES_USER=pocketpay`, `POSTGRES_PASSWORD=pocketpay`, `POSTGRES_DB=pocketpay`
  - ports `"5433:5432"`
  - named volume `pocketpay_pgdata` mounted at `/var/lib/postgresql/data`
  - healthcheck `pg_isready -U pocketpay`, checked every 5s
- [ ] **Step 2: Start it.** Run `docker compose up -d`, then `docker compose ps`. Expected: `db` shows `running (healthy)` with `0.0.0.0:5433->5432/tcp`.
- [ ] **Step 3: Check you can connect.**
  ```bash
  docker compose exec db psql -U pocketpay -c "select version();"
  ```
  Expected: one row starting with `PostgreSQL 16`.
- [ ] **Step 4: Commit.**
  ```bash
  git add docker-compose.yml && git commit -m "chore: add local postgres via docker compose"
  ```

### Task 3: Server scaffold with a tested health endpoint

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/eslint.config.js`
- Create: `server/vitest.config.ts`
- Create: `server/.env.example`
- Create: `server/src/config/env.ts`
- Create: `server/src/utils/AppError.ts`
- Create: `server/src/middlewares/notFound.ts`
- Create: `server/src/middlewares/errorHandler.ts`
- Create: `server/src/modules/health/health.routes.ts`
- Create: `server/src/app.ts`
- Create: `server/src/server.ts`
- Test: `server/tests/health.test.ts`
- Test: `server/tests/env.test.ts`

**Interfaces (produced, used by every later phase):**
- `parseEnv(source: Record<string, string | undefined>): Env` in `config/env.ts`
  - fields: `NODE_ENV: 'development' | 'test' | 'production'` (default `development`), `PORT: number` (default `4000`), `CLIENT_ORIGIN: string` (URL, default `http://localhost:5173`), `DATABASE_URL: string` (required)
  - throws an `Error` whose message contains the name of every invalid or missing key
- `env: Env`, equal to `parseEnv(process.env)`, exported from the same file.
- `class AppError extends Error { constructor(statusCode: number, code: string, message: string, details?: unknown) }` in `utils/AppError.ts`.
- `createApp(): Express` in `app.ts`. Middleware order:
  1. `helmet()`
  2. `cors({ origin: env.CLIENT_ORIGIN, credentials: true })`
  3. `express.json({ limit: '100kb' })`
  4. `cookieParser()`
  5. `pino-http` (disabled when `NODE_ENV === 'test'`)
  6. routes under `/api/v1`
  7. `notFound`
  8. `errorHandler`
- `errorHandler`:
  - `AppError` → its own status and `{ success:false, error:{ code, message, details } }`
  - anything else → 500 with code `INTERNAL_ERROR`; the real message is hidden when `NODE_ENV === 'production'`
- `GET /api/v1/health` → 200 `{ success:true, data:{ status:'ok', uptime:number, timestamp:string(ISO) } }`.

**npm scripts in `server/package.json`:**
- `dev`: `tsx watch src/server.ts`
- `build`: `tsup src/server.ts --format esm --clean`
- `start`: `node dist/server.js`
- `test`: `vitest run`
- `lint`: `eslint .`
- `typecheck`: `tsc --noEmit`

The package uses `"type": "module"`. `tsconfig` uses `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"strict": true` and `"target": "ES2022"`, so imports don't need `.js` extensions.

- [ ] **Step 1: Set up the package.** In `server/`:
  - Run `npm init -y`.
  - Install runtime deps: `express zod helmet cors cookie-parser pino pino-http dotenv`.
  - Install dev deps: `typescript tsx tsup vitest supertest @types/express @types/cors @types/cookie-parser @types/supertest @types/node eslint @eslint/js typescript-eslint prettier`.
  - Write `tsconfig.json`, `eslint.config.js`, the scripts and `.env.example`. `.env.example` sets `DATABASE_URL=postgresql://pocketpay:pocketpay@localhost:5433/pocketpay`, `PORT=4000` and `CLIENT_ORIGIN=http://localhost:5173`.
  - Copy `.env.example` to `.env`.
- [ ] **Step 2: Write the failing tests.**
  - `vitest.config.ts` sets `test.env` to `NODE_ENV=test` and `DATABASE_URL=postgresql://test:test@localhost:5433/test`.
  - `tests/env.test.ts`:
    ```ts
    it('applies defaults', () => {
      const e = parseEnv({ DATABASE_URL: 'postgresql://a:b@localhost:5433/c' });
      expect(e.PORT).toBe(4000);
      expect(e.NODE_ENV).toBe('development');
      expect(e.CLIENT_ORIGIN).toBe('http://localhost:5173');
    });
    it('names the missing key', () => {
      expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    });
    it('rejects a non-numeric PORT', () => {
      expect(() => parseEnv({ DATABASE_URL: 'postgresql://a:b@h:1/c', PORT: 'abc' })).toThrow(/PORT/);
    });
    ```
  - `tests/health.test.ts`:
    ```ts
    it('GET /api/v1/health returns ok', async () => {
      const res = await request(createApp()).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
      expect(typeof res.body.data.uptime).toBe('number');
    });
    it('unknown route returns JSON 404', async () => {
      const res = await request(createApp()).get('/api/v1/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: expect.any(String) } });
    });
    ```
- [ ] **Step 3: Run the tests and confirm they fail.** Run `npm test`. Expected: FAIL, because the modules don't exist yet.
- [ ] **Step 4: Implement** `env.ts`, `AppError.ts`, `notFound.ts`, `errorHandler.ts`, `health.routes.ts`, `app.ts` and `server.ts`.
  - `server.ts` imports `dotenv/config` first, then `env`, then calls `createApp().listen(env.PORT)` and logs `PocketPay API listening on :4000`.
- [ ] **Step 5: Run the checks.**
  - `npm test` → all 5 tests PASS.
  - `npm run lint` and `npm run typecheck` → no errors.
  - `npm run dev`, then open `http://localhost:4000/api/v1/health` → shows the JSON.
- [ ] **Step 6: Commit.**
  ```bash
  git add server && git commit -m "feat(server): express ts scaffold with env validation and health endpoint"
  ```

### Task 4: Client scaffold with the PocketPay palette

**Files:**
- Create (via template): `client/` from `npm create vite@latest client -- --template react-ts`
- Modify: `client/vite.config.ts` (Tailwind plugin + `/api` proxy)
- Modify: `client/src/index.css` (Tailwind import + palette tokens)
- Modify: `client/src/App.tsx` (placeholder home screen)
- Create: `client/src/components/layout/MobileShell.tsx`
- Delete: `client/src/App.css`, `client/src/assets/react.svg`, `client/public/vite.svg`

**Interfaces:**
- Consumes: `GET /api/v1/health` from Task 3.
- Produces:
  - Tailwind colour utilities named after the tokens: `bg-primary`, `bg-primary-dark`, `text-text-muted`, `bg-primary-50`, `border-border`, and so on.
  - `<MobileShell>{children}</MobileShell>`: a centred phone-width frame (`max-w-[420px]`, full height, white surface, subtle border on wider screens). Every customer, agent and merchant page in Phase 6 is wrapped in it.

- [ ] **Step 1: Scaffold and install.**
  ```bash
  npm create vite@latest client -- --template react-ts
  cd client
  npm install
  npm install -D tailwindcss @tailwindcss/vite prettier
  ```
- [ ] **Step 2: Configure Vite.** Add the `tailwindcss()` plugin. Add `server.proxy` that sends `'/api'` to `http://localhost:4000`. Set the dev port to 5173.
- [ ] **Step 3: Set up the palette.**
  - `index.css` starts with `@import "tailwindcss";`.
  - Then an `@theme { … }` block that defines `--color-primary`, `--color-primary-dark`, `--color-primary-light`, `--color-primary-50`, `--color-surface`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-success`, `--color-danger` and `--color-warning`, with the exact hex values from Global constraints.
  - Body: `bg-[#F8FAFC]` outside the shell, text colour `text`, system font stack.
- [ ] **Step 4: Build the placeholder screen.** `App.tsx` renders `MobileShell` containing:
  - an orange (`bg-primary`) header with the word **PocketPay** in white, large and bold
  - a white card showing **API status: ok** (in `success` green) when `fetch('/api/v1/health')` succeeds, or **API status: offline** (in `danger` red) when it fails
  - a `bg-primary-dark` button labelled "Get started" (it does nothing yet)
- [ ] **Step 5: Check it.**
  - `npm run build` and `npm run lint` → no errors.
  - With the server running (`npm run dev` in `server/`), run `npm run dev` in `client/` and open `http://localhost:5173` → orange header and "API status: ok".
  - Stop the server and reload → "API status: offline".
  - In DevTools, choose a phone size (iPhone 12 Pro) → the layout fits with no sideways scrolling.
- [ ] **Step 6: Commit.**
  ```bash
  git add client && git commit -m "feat(client): vite react ts scaffold with tailwind palette and api health check"
  ```

### Task 5: README setup section and pull request

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Fill in the README "Run locally" section** with:
  - prerequisites: Node LTS (via nvm), Git, Docker Engine + Compose plugin
  - `docker compose up -d`
  - `cd server && cp .env.example .env && npm install && npm run dev`
  - `cd client && npm install && npm run dev`
  - open `http://localhost:5173`
- [ ] **Step 2: Do a fresh-clone check.** Clone the repo into a temporary folder, follow only the README, and confirm you see "API status: ok". If any step was missing, fix the README.
- [ ] **Step 3: Commit, push and open a PR.**
  ```bash
  git add README.md && git commit -m "docs: add local setup instructions"
  git push -u origin chore/repo-setup
  ```
  - On GitHub, open a PR from `chore/repo-setup` → `main`, titled **"chore: Phase 2 — repo setup"**.
  - In the description, list what was added and attach a screenshot of the placeholder screen.
  - Merge it.
- [ ] **Step 4: Sync your local `main`.**
  ```bash
  git switch main && git pull
  ```

---

**Phase 2 is done when** a fresh clone, following only the README, shows the orange PocketPay screen with "API status: ok", `npm test` passes in `server/`, and the PR is merged.
