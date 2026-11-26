# Phase 7a: Admin panel — KYC review, users and the audit log

> **For Claude Code:** do the tasks in order. For each task: write the tests first, run them and show they fail, implement, run them and show they pass, then run the checks for every package you touched (server: `npm test`, `npm run lint`, `npm run typecheck`; client: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `node design/check-tokens.mjs` from the repo root). Run one test process at a time. Stop and let the user review and commit. Don't commit or push. The user runs `db:reset` / `migrate reset` and `db:seed`, not Claude Code.

**Goal:** the first half of the admin panel. An admin can review KYC submissions (the full NID next to the 3 images, through 5-minute signed links), approve or reject with a reason, and a rejected user can resubmit. An admin can search users, freeze or unfreeze them, and clear a PIN lockout. Every admin action and every KYC view is in the audit log, which the admin can read.

**Phase 7b (next PR):** dashboard numbers, all transactions, agent float top-up, the fees and limits editor, the reconcile button.

**Branch:** `feat/admin-kyc`, from `main` (Phase 6b merged).

**Spec:** `docs/design.md` §5 (statuses), §6.6 (KYC and uploads), §6.7 (admin panel), §9 (API), §10 (security), §11 and §11.3 (look), `design/TASTE.md`.

## Global constraints
- **Admin only:** every `/admin/*` route runs `requireAuth` → `requireRole('ADMIN')`, and is rate limited **per user** (120 a minute, its own budget). A non-admin gets `403 FORBIDDEN`; no admin data in the error.
- **The full NID appears in exactly one response:** `GET /admin/kyc/:id`. Everywhere else, admin screens included, it is masked (`*******123`). Never in logs, audit metadata, URLs or client storage.
- **Signed image links:** 5 minutes (`300` s), generated per request, never stored, never logged, never in audit metadata. The KYC detail response is `Cache-Control: no-store`, and the client keeps it with `gcTime: 0` and never persists it.
- **Every admin write and every KYC view writes an audit row** in the same DB transaction as the change (the view: right after the read). Metadata holds ids, the action and the reason — never the NID, images, URLs, PINs or tokens.
- **Status changes are race-safe:** each one runs in one DB transaction that locks the user row (`SELECT … FOR NO KEY UPDATE`, as in §10) and changes state only from the expected state; anything else is `409`. Two admins acting at once: exactly one wins.
- **Admins can't act on admins** (or themselves): `422 CANNOT_MODIFY_ADMIN`.
- **Fake data only.** Seeded KYC images are generated placeholders that say "DEMO — NOT A REAL NID".
- **Look:** the same Kantha tokens and components, in a wider layout: a sidebar from `lg` up, a phone layout below. No stitch in the admin panel (it stays in its 4 places). Tables on desktop become card lists on a phone. en/bn parity for every string, 44 px targets, WCAG AA, `check-tokens` clean.
- **Everything from Phases 5–6b still holds** (money as strings/BigInt, the access token in memory, no PIN in state/URL/storage/logs, i18n errors by code).

## Review focus
1. Two admins approve and reject the same submission at the same moment → exactly one succeeds, the other gets `409 KYC_ALREADY_REVIEWED`; the user's status matches the winner.
2. A user who was frozen (or whose submission was superseded by a resubmit) while their KYC page was open → approving the old submission is `409`, not a silent status change.
3. A signed link after 5 minutes, with a changed key, or with a changed signature → `403`; a key outside `kyc/` or with `..` → `404`, never a file outside the private root.
4. A rejected user resubmits twice in parallel → one new submission, the other `409`.
5. Freezing a user ends their sessions: their refresh token stops working at once, and the money guard already refuses them with a still-valid access token.

---

## Tasks

### Task 1: Local signed links for private files
**⚙️ extra-high** (it guards the NID images).

Today `LocalStorage.signedUrl` throws `501`. Implement it so local dev and the demo can show KYC images.

**Files:** `server/src/lib/storage/*` (wherever `LocalStorage` lives), `server/src/config/env.ts`, `server/.env.example`, a new `server/src/modules/files/` (route + controller), `app.ts`. Test: `server/tests/files.signed.test.ts`.

- `FILE_URL_SECRET`: a new env var, at least 32 characters, required when `STORAGE_DRIVER=local`. `.env.example` gets a placeholder and a comment to generate one (`openssl rand -base64 48`). Tests set their own.
- `LocalStorage.signedUrl(key, ttlSeconds)` → `/api/v1/files/private/<key>?exp=<unix seconds>&sig=<base64url HMAC-SHA256(secret, "<key>\n<exp>")>`.
- `GET /api/v1/files/private/*key` (no login: the signature is the permission, because an `<img>` can't send the access token):
  - the key must match `^kyc/[0-9a-f-]{36}/[a-z-]+-[0-9a-f-]{36}\.webp$`, otherwise `404`;
  - the resolved path must stay inside `uploads/private`, otherwise `404`;
  - `exp` in the past, or a signature that doesn't match (compare with `timingSafeEqual`) → `403 LINK_EXPIRED_OR_INVALID`;
  - serve with `Content-Type: image/webp`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`;
  - the request log already drops the query string, so `sig` is never logged — add a test that proves it.
- **Tests:** a valid link serves the bytes with those headers; 1 s past `exp` → 403; one changed character in `sig`, in `key` or in `exp` → 403; `..` and a non-`kyc/` key → 404; a missing file with a valid signature → 404; `MemoryStorage` and Cloudinary unchanged; the log line for a signed request contains no `sig=`.

### Task 2: Seed — real KYC state for the demo accounts
**⚙️ high.**

Fixes the Phase 6b carry-over ("Document check: Not submitted") and gives the admin queue something to review.

**Files:** `server/src/db/seed.ts`, a new `server/src/db/demoImages.ts`, `tests/seed.test.ts`.

- `demoImages.ts` makes placeholder images with `sharp` from SVG: an ID card ("DEMO — NOT A REAL NID", the name, the masked NID) for front and back, and a selfie placeholder (initials on a tinted circle). Run them through the existing `processImage` and `storage.put`, with the same keys and `PRIVATE` access as registration.
- The 4 non-admin demo users each get 3 documents and one **APPROVED** submission (`reviewedBy` = the demo admin, `reason: null`), created **only if they have no submission yet** (the seed stays re-runnable, and a profile photo the user uploaded is never replaced).
- Two new demo users (PIN `48213`, a wallet each, no money):
  - `01800000006`, NID `9000000006`, **Jamal Uddin**, AGENT, `PENDING_KYC`, one **PENDING** submission;
  - `01800000007`, NID `9000000007`, **Nusrat Jahan**, CUSTOMER, `REJECTED`, one **REJECTED** submission with the reason "The NID photo is blurry. Please retake it in good light."
- The seed summary prints the two new accounts.
- **Tests:** update the counts (7 users, 8 wallets); every non-admin demo user has a latest submission; the two new ones have the right status and submission; re-running changes nothing (same counts, no new documents); `reconcileLedger()` still ok.

### Task 3: Admin KYC API
**⚙️ extra-high** (full NID, signed links, status changes).

**Files:** `server/src/modules/admin/` (routes, `kyc.service.ts`, schemas), `server/src/middlewares/rateLimit.ts` (the admin limiter), `app.ts`. Tests: `server/tests/admin.kyc.test.ts`.

- `GET /admin/kyc?status=PENDING|APPROVED|REJECTED&cursor&limit` (default `PENDING`, oldest first for PENDING, newest first otherwise; keyset cursor like history): `{ items: [{ id, submittedAt, status, user: { id, name, phone, role, shopName, nidMasked } }], nextCursor }`, plus `pendingCount` (for the sidebar badge).
- `GET /admin/kyc/:id`: `{ id, status, submittedAt, reviewedAt, reason, reviewedBy: { id, name } | null, isLatest, user: { id, name, phone, role, shopName, dateOfBirth, nidNumber (FULL), status }, images: { nidFront, nidBack, selfie } (signed, 300 s), history: [{ id, status, submittedAt, reason }] }`. `Cache-Control: no-store`. Writes audit `KYC_VIEWED` (`{ submissionId, userId }`). Unknown id → `404 KYC_NOT_FOUND`.
- `PATCH /admin/kyc/:id` with `{ decision: 'APPROVE' } | { decision: 'REJECT', reason: string (5–200 chars, trimmed) }`. One transaction:
  1. lock the user row, then read the submission;
  2. it must be `PENDING` **and** the user's latest **and** the user `PENDING_KYC` — otherwise `409 KYC_ALREADY_REVIEWED` (or `409 KYC_NOT_LATEST` / `409 USER_STATUS_CHANGED`);
  3. update the submission (`status`, `reviewedBy`, `reviewedAt`, `reason`) with `updateMany({ where: { id, status: 'PENDING' } })`, and require `count === 1`;
  4. set the user `ACTIVE` (approve) or `REJECTED` (reject);
  5. audit `KYC_APPROVED` / `KYC_REJECTED` (`{ submissionId, userId, reason? }`).
- **Tests:** non-admin → 403 on all three; the list's order, filter, cursor and `pendingCount`; the detail has the full NID only here, signed links that work against Task 1, `no-store`, and one `KYC_VIEWED` row; approve and reject change both rows and audit; reject without a reason or with 4 characters → 400; reviewing twice → 409; **approve and reject in parallel** (`Promise.all`, 10 rounds) → one 200 and one 409 each round, and the final status matches the winner; an old submission after a resubmit → 409; an admin's own account → 422; the audit metadata never contains the NID or a URL.

### Task 4: The user side — KYC status and resubmit
**⚙️ extra-high** (uploads and a status change by the user).

**Files:** `server/src/modules/kyc/` (routes, service), reuse `uploadKycImages` and `processImage`; client `api/kyc.ts`, the KYC banner, a new `pages/kyc/Resubmit.tsx`, i18n. Tests: `server/tests/kyc.resubmit.test.ts`, `client/src/pages/kyc/Resubmit.test.tsx`.

- `GET /kyc` → `{ status, reason, submittedAt, reviewedAt }` of the latest submission (or `null`).
- `POST /kyc/resubmit` (multipart `nidFront`, `nidBack`, `selfie`; 10 MB each, as at registration): only a `REJECTED` user (otherwise `409 KYC_RESUBMIT_NOT_ALLOWED`). One transaction with the user row locked: re-check `REJECTED`, create 3 documents and a new `PENDING` submission, set the user `PENDING_KYC` (or `ACTIVE` with an `APPROVED` submission when `KYC_AUTO_APPROVE` and the user is a CUSTOMER, the same rule as registration), replace the profile photo with the new selfie's avatar copy, audit `KYC_RESUBMITTED`. Uploads happen before the transaction; if it fails, delete the new objects (best effort), as registration does. Old documents and submissions are kept (history). Per-user limit: 5 an hour.
- **Client:** a REJECTED user's banner shows the reason and a "Resubmit documents" button → `/kyc/resubmit`: the 3 image pickers from registration (with on-phone shrinking and the "Do not upload a real NID" banner) and one submit. On success: back home, the banner now says "Under review", and `/me` is refetched.
- **Tests (server):** a rejected user resubmits → 201, a PENDING submission, user `PENDING_KYC`, a new profile photo, an audit row; auto-approve customer → `ACTIVE`; a PENDING or ACTIVE user → 409; two resubmits in parallel → one 201, one 409, one new submission; a bad file → 415 and no DB change, no stored objects left.
- **Tests (client):** the reason and button show only for REJECTED; the form needs all 3 images; one multipart request with the 3 files; success returns home with "Under review"; i18n parity.

### Task 5: Admin users and the audit log API
**⚙️ extra-high** (freezing, sessions and lockouts).

**Files:** `server/src/modules/admin/` (`users.service.ts`, `audit.service.ts`, routes). Tests: `server/tests/admin.users.test.ts`, `server/tests/admin.audit.test.ts`.

- `GET /admin/users?q&role&status&cursor&limit`: `q` matches a phone prefix, a name (case-insensitive, contains), or an exact 10-digit NID; items `{ id, name, phone, role, status, shopName, nidMasked, kycStatus, lockedUntil, createdAt }`; newest first; keyset cursor.
- `GET /admin/users/:id`: the same fields plus `failedPinAttempts`, the wallet balance (string), the latest KYC submission id and status, and the last 10 audit rows about this user.
- `PATCH /admin/users/:id/status` with `{ action: 'FREEZE', reason (5–200) } | { action: 'UNFREEZE', reason (5–200) }`. One transaction, user row locked: FREEZE only from `ACTIVE`, UNFREEZE only from `FROZEN` (→ `ACTIVE`), otherwise `409 USER_STATUS_CHANGED`. FREEZE also revokes every refresh token of that user (`revokedAt = now`). Audit `USER_FROZEN` / `USER_UNFROZEN` with the reason. Approving stays in the KYC endpoint only (one path for approval).
- `POST /admin/users/:id/unlock`: under the user row lock, set `failedPinAttempts = 0`, `lockedUntil = null`; audit `USER_UNLOCKED`. Not locked → 200 with no change and no audit row.
- `GET /admin/audit-logs?actorId&targetId&action&from&to&cursor&limit`: newest first, Dhaka date range (the existing `dhakaDateRange`), items `{ id, createdAt, action, actor: { id, name, role } | null, targetType, targetId, metadata, ip }`.
- **Tests:** non-admin → 403; search by phone prefix, name and exact NID (a 9-digit NID matches nothing by NID); the masked NID everywhere; freeze → the user's refresh is 401 and a money POST with their still-valid access token is `ACCOUNT_NOT_ACTIVE`; unfreeze → login works again; freeze a PENDING_KYC user → 409; freeze and unfreeze in parallel on an ACTIVE user → at most one change; an admin target → 422; unlock clears a real lockout (3 wrong PINs, then unlock, then login works); audit filters, order and cursor; no NID, PIN, token or URL in any metadata returned.

### Task 6: Admin layout
**⚙️ high.**

**Files:** `design/TASTE.md` (an "Admin panel" section first), client `components/layout/AdminLayout.tsx`, `routes/router.tsx` (admin routes, lazy), i18n. Replace the Phase 6 "coming soon" page. Tests: `AdminLayout.test.tsx`, the route guard tests.

- **TASTE first:** the admin uses the same tokens, fonts and buttons; a white `surface` sidebar with `primary-dark` for the active item; tables with `border` row lines, `text-sm` rows, right-aligned money, sticky header; status badges by meaning (`warning` pending, `success-dark` active, `danger` frozen/rejected, `text-muted` other) with a text label, never colour alone; no stitch.
- **From `lg` (1024 px) up:** a 240 px sidebar (PocketPay, then KYC review with the pending count badge, Users, Audit log; the language pill, the admin's name and Log out at the bottom) and a content area up to 1200 px wide.
- **Below `lg`:** the `primary-dark` app bar with the page title and a menu button that opens the same list in a sheet (focus trapped, Esc closes, focus returns to the button).
- `/` for an admin goes to `/admin/kyc`. Admin pages are code-split. A non-admin on `/admin/*` → `/`.
- **Tests:** the sidebar shows at `lg` and the sheet below (mock `matchMedia`); the active item has `aria-current="page"`; the badge shows `pendingCount` and hides at 0; the sheet traps focus and closes on Esc; a customer on `/admin/users` lands on `/`; Log out works; i18n parity.

### Task 7: Admin pages — KYC queue and review, users, audit log
**⚙️ extra-high for the KYC review page** (full NID, signed links, irreversible decisions); the rest is the same session.

**Files:** client `pages/admin/` (`KycQueue.tsx`, `KycReview.tsx`, `Users.tsx`, `UserDetail.tsx`, `AuditLog.tsx`), `api/admin.ts`, a shared `components/ui/DataTable.tsx` (table at `lg`, cards below) and `components/ui/ConfirmDialog.tsx`, i18n. Tests next to each page.

- **KYC queue:** status tabs (Pending · Approved · Rejected), rows with name, role, phone, masked NID, submitted (relative date, Dhaka), and "Load more".
- **KYC review:** the user's details with the **full NID** (in `font-amount` digits so it's easy to compare), date of birth and age, role, shop name; the 3 images side by side at `lg` and stacked below, each opening full size in a dialog; earlier submissions with their reasons. If an image fails to load (link expired), refetch the detail once and retry. `gcTime: 0`, `staleTime: 0`, nothing in storage.
  - **Approve** and **Reject** only on the latest PENDING submission. Each opens a `ConfirmDialog` naming the person ("Approve Jamal Uddin?"). Reject needs a reason (5–200 characters, a counter, 3 quick-fill chips: blurry photo, details don't match, selfie doesn't match the NID photo). Buttons disabled while pending. `409` → a toast with the translated message, and the page refetches.
- **Users:** search box (debounced 300 ms), role and status filters as chips, the table/cards, "Load more". **User detail:** the fields, the balance, the KYC status with a link to the review, the last 10 audit rows; **Freeze / Unfreeze** with a `ConfirmDialog` and a required reason; **Clear PIN lock** only when locked.
- **Audit log:** filters (action, Dhaka date range), the table/cards with time, actor, action (translated label), target and metadata shown as key–value text; "Load more".
- **Tests:** the review shows the full NID and 3 images with the signed links; approve and reject send the right body and refetch; reject is blocked under 5 characters; a 409 shows the toast and refetches; the detail query is gone from the cache after leaving the page; the image-error retry happens once; users search sends `q` after the debounce; freeze needs a reason and sends it; Clear PIN lock shows only when locked; the audit filters send the right query; every page works at 360 px and 1280 px (DataTable switches); i18n parity.

### Task 8: Design loop, docs and the PR
**⚙️ high.**

- `/design-loop` on every admin page in en and bn at **1280×800, 1024×768, 390×844 and 360×800**, plus the customer's rejected banner and Resubmit page, with the Phase 6b checks (overflow, clipped text; at desktop sizes also the sidebar stays in view). Compare with TASTE's new admin section.
- Docs: design.md §6.6 (resubmit details), §6.7 (what 7a built), §9 (the new routes: `/files/private/*`, the exact KYC, users and audit routes), §10 (signed links, admin rate limit, freeze ends sessions), §11 (the admin layout), §15 (new decisions), §14 (Phase 7 → "7a done").
- Full checks (server, client, check-tokens), then the user tests on the S24 and on the laptop, then a fresh review, then the PR.

**Done when:** an admin can approve Jamal and reject-then-see-resubmitted Nusrat end to end in both languages, on a laptop and on a phone; every action is in the audit log; all tests pass; the PR is reviewed and merged.

## Later (Phase 7b and on)
- 7b: `GET /admin/stats`, `GET /admin/transactions`, `POST /admin/agents/:id/float`, the fees and limits editor, `GET /admin/reconcile`.
- Phase 10: the live demo's KYC queue gets used up by visitors (they can approve Jamal) — decide on a scheduled re-seed of the two demo KYC accounts.
