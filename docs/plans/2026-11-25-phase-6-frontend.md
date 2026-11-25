# Phase 6: Frontend Screens Implementation Plan

> **For Claude Code:** do the tasks in order. For each task: write the tests first, run them and show they fail, implement, run them and show they pass, run lint + typecheck + build, then stop and let the user review and commit. Explain each file as you create it. Don't add anything outside the task. Don't commit or push.
> Steps use checkboxes (`- [ ]`). Each task names its recommended **⚙️ effort**.

**Goal:** the PocketPay app a recruiter actually uses, in a phone-sized browser:
- login with demo buttons
- the 4-step registration
- the customer, agent and merchant home screens
- the four money flows (Enter → Preview → PIN → Receipt)
- history, receipts and Profile
- in **English and Bangla**

Also the two server endpoints the Profile screen needs: `PATCH /auth/pin` and `PUT /me/photo`.

**Architecture:**
- **Data and state:**
  - **React Router** for pages and role/status guards
  - **TanStack Query** for all server data
  - **Zustand** for the session: the access token **in memory only**, and the user
  - **Axios** with one interceptor that refreshes the token
  - **React Hook Form + Zod** for forms
  - **react-i18next** for the two languages
- **Flows:** one shared `TransferFlow` component drives all four money flows from the same flow table the server uses.
- **Not in this phase:** the admin panel (Phase 7). An admin who logs in sees a "coming in Phase 7" page.

**Spec:**
- `docs/design.md` §5–6 (roles, flows, fees, limits, history), §10 (security), §11 (frontend design)
- `design/TASTE.md` (visual rules, **mandatory**)
- `docs/api.md` (every request and response shape: **the source of truth for the client**)

**Decided with the user (2026-11-25):**
- one pull request for the whole phase
- straight to code (no mockups first; polish with `/design-loop`)
- **English + Bangla toggle**

## Global constraints
- **Design rules:**
  - Read `design/TASTE.md` before any UI.
  - Every visual value comes from the `@theme` block in `client/src/index.css`: no hex, no arbitrary values, no default Tailwind palette.
  - After UI edits, run `node design/check-tokens.mjs` (repo root), then in `client/`: `npm run lint && npm run build`.
- **The access token lives only in memory** (the Zustand store, never `localStorage` or `sessionStorage`). On app start, the client calls `POST /auth/refresh` (the httpOnly cookie) to restore the session. The language preference may live in `localStorage`.
- **The refresh interceptor** (Task 2):
  - on a `401` whose `error.code` is `UNAUTHENTICATED`, run **one** shared refresh (single-flight), then retry the original request **once**
  - a refresh answered `409 REFRESH_IN_PROGRESS` is retried **once** after about 300 ms (design §10)
  - any other refresh failure clears the session and sends the user to `/login`
  - **never refresh on a login, register or refresh request itself**
- **Money in the client:**
  - API amounts are poisha **strings**. Never convert them to `number`; do the maths with `BigInt`.
  - Display goes through one helper, `formatTaka`.
  - Input goes through one parser, `takaToPoisha`, from a typed string. It accepts Bangla digits and at most 2 decimals, and never uses floats.
- **Every user-facing string goes through i18n** (`t('…')`), with a key in **both** `en` and `bn`. A test enforces key parity.
  - **API error codes are mapped to i18n keys** (`errors.<CODE>`). An unknown code gets a generic message, never the raw `message` field.
  - In Bangla mode, numbers and dates show **Bangla digits** (`bn-BD`), with the same lakh grouping. Inputs accept both digit sets.
  - `<html lang>` follows the language.
- **Idempotency:** the money POST's `Idempotency-Key` is `crypto.randomUUID()`, created **once per confirm screen** (when the user reaches the PIN step) and **reused** for every retry of that confirm. A new transfer gets a new key.
- **The PIN:**
  - `type="password"`, `inputMode="numeric"`, `autoComplete="off"`
  - cleared from state after every submit, success or failure
  - never logged, never stored, never put in a URL
- **Routing by role and status:**
  - a CUSTOMER sees customer pages, an AGENT agent pages, a MERCHANT merchant pages
  - a page of another role redirects to the user's own home
  - `PENDING_KYC` and `REJECTED` users see their home with a status banner and **every money action disabled** (design §5)
  - FROZEN users can't log in (the server refuses)
- **Dev proxy:** `/api` and `/uploads` go to `http://localhost:4000` (`client/vite.config.ts`), so the browser sees one origin and the refresh cookie (`Path=/api/v1/auth`) works.
- **New dependencies:** use the latest stable version of each, and check that each package is the official one on npm before installing.
  - runtime: `react-router`, `@tanstack/react-query`, `zustand`, `axios`, `react-hook-form`, `zod`, `@hookform/resolvers`, `react-i18next`, `i18next`, `lucide-react` (the one icon set; TASTE.md: "ask before adding", and this is that ask), `@fontsource/noto-sans-bengali` (consistent Bangla rendering on every device)
  - dev: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `msw`
  - Nothing else without asking.
- **Server changes are only Task 1.** Everything else is `client/`, plus docs in Task 9.

## Review focus
These are the inputs and states most likely to break a real user's session or money that the main tests don't cover. Each one has a test in its task.
1. **Two requests expire together:** both get 401 → exactly **one** `/auth/refresh` call, and both original requests are retried and succeed. *(Task 2)*
2. **A double tap or network retry on confirm** reuses the same `Idempotency-Key`, so the server replays instead of paying twice. A new transfer gets a new key. *(Task 6)*
3. **Amount typing:** `"1,500.50"`, `"১৫০০.৫০"`, `"0.5"` and `"100.1"` parse to the right poisha; `"1.234"`, `"-5"`, `"1e3"` and `""` are refused. No float anywhere. *(Task 3)*
4. **A KYC-pending user** sees the home page but can't open any money flow, even by typing the URL. *(Task 5)*
5. **A Bangla key missing** for a new string fails the test suite, not a user's screen. *(Task 3)*

---

### Task 1: Server: change PIN and change profile photo
**⚙️ Effort: extra-high.** Security code: PIN verification and image upload.

**Files:**
- Modify: `server/src/modules/auth/auth.routes.ts`, `auth.controller.ts`, `auth.schemas.ts`, `server/src/modules/me/me.routes.ts`, `server/src/middlewares/rateLimit.ts`
- Create: `server/src/modules/auth/pin.service.ts` (or extend `session.service.ts` if that's cleaner, and say why), `server/src/modules/me/photo.service.ts`
- Test: `server/tests/auth.changePin.test.ts`, `server/tests/me.photo.test.ts`

**Endpoints:**
- **`PATCH /api/v1/auth/pin`** (any logged-in user), body `{ currentPin, newPin }`:
  1. `currentPin` is checked with **`verifyPinWithLockout`**, sharing the login and money lockout, with `failedAction: 'PIN_CHANGE_FAILED'` and `wrongPin: invalidPin`.
  2. `newPin` uses `pinSchema` (the strength rules) and must differ from the current PIN → otherwise `422 PIN_UNCHANGED`.
  3. On success, store the new hash, **revoke every other refresh-token family of the user** (keep the current session's family, from the refresh cookie if present), write a `PIN_CHANGED` audit row, and return 204.
  4. It uses `moneyLimiter`-style per-user rate limiting (a new `pinChangeLimiter`, 5 per 15 minutes per user).
- **`PUT /api/v1/me/photo`** (any logged-in user), `multipart/form-data`, field `photo`:
  - **Reuse** the Phase 3 upload pipeline: multer memory, 2 MB, `file-type` check, `sharp` with `.rotate()`, EXIF stripped, the 512×512 WebP avatar.
  - Store it as a **public** object, create a `user_documents` row (`kind: PROFILE`, `access: PUBLIC`), and set `users.profile_photo_key`.
  - Delete the previous public profile object (best effort: a failed delete is logged by key, never fails the request).
  - Return `{ user: PublicUser }`.
  - The NID and selfie documents are never touched.

- [ ] **Step 1: Write the failing tests.**
  - **change PIN:**
    - right current PIN → 204; login works with the new PIN, not the old one
    - another session's refresh cookie is revoked, while the caller's own still refreshes
    - one `PIN_CHANGED` audit row
    - wrong current PIN → 403 `INVALID_PIN { attemptsLeft: 2 }`, and the shared counter moved (a following wrong **login** completes the 3 → 423)
    - a locked account → 423, even with the right current PIN
    - a weak new PIN (`11111`, `12345`) → 400 `VALIDATION_ERROR`; new = current → 422 `PIN_UNCHANGED`
    - no token → 401
    - the response and the audit row never contain a PIN or a hash
  - **photo:**
    - a JPEG → 200
    - the user's `profilePhotoUrl` changes
    - a `PROFILE` / `PUBLIC` document exists
    - the stored object is a 512×512 WebP
    - the old public object is deleted from `MemoryStorage`; the NID front, back and selfie objects are untouched
    - a PDF renamed `.jpg` → 400 (`file-type`); 3 MB → 413
    - no file → 400
    - no token → 401
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all server tests, lint and typecheck.** Add both endpoints and `PIN_UNCHANGED` to `docs/api.md`.

### Task 2: Client foundation: router, data, session and the refresh interceptor
**⚙️ Effort: extra-high.** If the refresh logic is wrong, users get logged out at random, or the client loops on refreshes.

**Files (client/):**
- Modify: `package.json` (deps; scripts `test`, `typecheck`, `dev:phone` = `vite --host`), `vite.config.ts` (`/uploads` proxy, Vitest config: jsdom, setup file), `src/main.tsx`, `src/App.tsx`
- Create:
  - `src/api/client.ts` (the axios instance and interceptors)
  - `src/api/auth.ts` (`login`, `logout`, `refresh`, `me`)
  - `src/stores/session.ts`
  - `src/routes/router.tsx`
  - `src/routes/guards.tsx` (`RequireAuth`, `RequireRole`, `RequireActive`)
  - `src/test/setup.ts`, `src/test/server.ts` (MSW)
- Test: `src/api/client.test.ts`, `src/routes/guards.test.tsx`

**Interfaces produced:**
```ts
// stores/session.ts
interface SessionState { accessToken: string | null; user: PublicUser | null; status: 'loading' | 'authenticated' | 'anonymous';
  signIn(data: { user: PublicUser; accessToken: string }): void; setToken(t: string): void; clear(): void }
// api/client.ts
export const api: AxiosInstance                 // baseURL '/api/v1', withCredentials: true
export class ApiError extends Error { status: number; code: string; details?: unknown }   // every failed call rejects with this
export async function restoreSession(): Promise<void>   // POST /auth/refresh on app start
```
`PublicUser` and the other response types go in `src/api/types.ts`, copied from `docs/api.md` with money as `string`.

- [ ] **Step 1: Write the failing tests** (MSW):
  - a request carries `Authorization: Bearer <token>` from the store
  - **Review focus #1:** two parallel requests both get 401 `UNAUTHENTICATED` → **exactly one** `/auth/refresh` call; both requests are retried with the new token and resolve
  - a refresh answered 409 `REFRESH_IN_PROGRESS` once, then 200 → the original request succeeds (2 refresh calls in total)
  - a refresh answered 401 → the session is cleared (`status: 'anonymous'`), and the original call rejects with an `ApiError`
  - a 401 on `/auth/login` is **not** refreshed (0 refresh calls)
  - a retried request that 401s again is not refreshed a second time (no loop)
  - an error body → an `ApiError` with `status` and `code`; a network failure → `ApiError` with code `NETWORK_ERROR`
  - `restoreSession`: 200 → `authenticated` with the user; 401 → `anonymous`
  - guards:
    - anonymous at `/` → `/login`
    - a CUSTOMER at an agent page → the customer home
    - a `PENDING_KYC` customer at `/send-money` → home (**Review focus #4**)
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.** Keep the temporary scaffold page replaced by a minimal router with placeholder pages.

### Task 3: Language, money, dates and error messages
**⚙️ Effort: high.** Pure helpers with exact tests, plus the translation files.

**Files (client/src/):**
- Create:
  - `lib/money.ts`, `lib/digits.ts`, `lib/dates.ts`, `lib/phone.ts`
  - `i18n/index.ts`, `i18n/en.json`, `i18n/bn.json`, `i18n/errors.ts`
  - `stores/language.ts`
- Modify: `index.css` (the Bangla font in the font stack, from `@fontsource/noto-sans-bengali`), `main.tsx`
- Test: `lib/money.test.ts`, `lib/dates.test.ts`, `i18n/i18n.test.ts`

**Interfaces produced:**
```ts
export function formatTaka(poisha: string, opts?: { sign?: 'in' | 'out'; lang?: 'en' | 'bn' }): string
  // "150050" → "৳1,500.50"; "1234567" → "৳12,345.67"; in bn → "৳১,৫০০.৫০"; sign 'out' → "−৳500.00" (U+2212)
export function takaToPoisha(input: string): string | null    // "1,500.50" → "150050"; invalid → null
export function toAsciiDigits(s: string): string               // "০১৭" → "017"
export function formatDateTime(iso: string, lang: 'en' | 'bn'): string   // always Asia/Dhaka
export function maskPhoneForDisplay(phone: string): string     // only if a screen needs it
export function errorMessage(t: TFunction, err: unknown): string   // ApiError code → errors.<CODE>, else errors.GENERIC
```
- **Lakh grouping:** use the `en-IN` / `bn-BD` grouping on the **whole-taka part as a BigInt**, and add the poisha part as two digits. Never `Number(poisha) / 100`.
- **The language store:** `lang: 'en' | 'bn'`, persisted in `localStorage`, applied to i18next and `<html lang>`. The default is `en`.

- [ ] **Step 1: Write the failing tests.**
  - `formatTaka`:
    - `"0"` → `৳0.00`; `"5"` → `৳0.05`; `"150050"` → `৳1,500.50`
    - `"1234567890"` → `৳1,23,45,678.90`
    - `"99999999999999"` (beyond `Number.MAX_SAFE_INTEGER / 100`) → still exact
    - `sign: 'out'` uses U+2212
    - bn → Bangla digits
  - **Review focus #3**, `takaToPoisha`:
    - accepted: `"500"` → `"50000"`; `"1,500.50"` → `"150050"`; `"0.5"` → `"50"`; `"100.1"` → `"10010"`; `"১৫০০.৫০"` → `"150050"`; `" 20 "` → `"2000"`
    - refused (null): `"1.234"`, `"-5"`, `"1e3"`, `""`, `"abc"`, `"0"`, `"."`
  - `formatDateTime`: `2026-11-24T18:30:00Z` → 25 Nov 2026, 12:30 am in Dhaka (en), the same with Bangla digits (bn)
  - **Review focus #5:** `en.json` and `bn.json` have **exactly** the same set of keys, including nested ones; no value is empty
  - **every error code** in `docs/api.md`'s error table has an `errors.<CODE>` key (keep the code list as an array in `i18n/errors.ts`, and test the array against both files). `errorMessage` of an unknown code → the generic text; of a non-`ApiError` → the generic text.
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** Claude Code writes the Bangla strings; **mark the file for the user's review** in the task report. **Step 4: test, lint, typecheck, build.**

### Task 4: The UI kit
**⚙️ Effort: high.** Small components, all on tokens.

**Files (client/src/components/):**
- `ui/`: `Button`, `Input`, `PhoneInput`, `AmountInput`, `PinInput`, `Card`, `Skeleton`, `EmptyState`, `Toast` (with a `useToast`), `StatusBanner`, `ImagePicker`, `LanguageToggle`
- `layout/`: `AppShell` (the existing `MobileShell` + a header + an optional bottom nav), `BottomNav` (Home, History, Profile, with `pb-safe`)
- Test: `ui/ui.test.tsx`

**Rules:**
- Everything follows TASTE.md:
  - `h-12` inputs and primary buttons
  - `min-h-11` tap targets
  - `rounded-xl` controls, `rounded-2xl` cards
  - borders, not shadows (except the toast)
  - icons from `lucide-react` only
  - `tabular-nums` on money, phone numbers and TrxIDs
- **`AmountInput`** shows `৳`, accepts typing in either digit set, and reports the parsed poisha (via `takaToPoisha`) or an error key.
- **`PinInput`** is 5 boxes backed by one hidden `type="password"` input, so paste and the phone's numeric keypad work. It has a `clear()` method the parent calls after every submit.
- **`ImagePicker`** uses `accept="image/jpeg,image/png,image/webp"`, with a `capture` option for the selfie. It refuses over 2 MB before upload (with a translated error), and shows a preview with "retake".
- **`StatusBanner`** covers PENDING_KYC (`warning-dark` text), REJECTED, and the demo banner "Do not upload a real NID".

- [ ] **Step 1: Write the failing tests:**
  - `PinInput`: typing 5 digits calls `onComplete("48213")`; Bangla digits are accepted; `clear()` empties it; the value is never in the DOM as text
  - `AmountInput`: `"1,500.50"` reports `"150050"`; `"1.234"` reports the error key
  - `ImagePicker`: a 3 MB file → the size error, and `onChange` isn't called
  - `Button`: `disabled` and `loading` states can't be clicked
  - every component renders in `bn`
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: tests, `node design/check-tokens.mjs` (zero findings), lint, build.**

### Task 5: Login, registration and the KYC states
**⚙️ Effort: high.**

**Files (client/src/):**
- `pages/auth/Login.tsx`
- `pages/auth/register/` (`RegisterWizard.tsx`, `PhoneStep.tsx`, `OtpStep.tsx`, `IdentityStep.tsx`, `PhotosAndPinStep.tsx`)
- `pages/admin/ComingSoon.tsx`
- `api/register.ts`
- Tests: `pages/auth/Login.test.tsx`, `pages/auth/register/RegisterWizard.test.tsx`

**Behaviour:**
- **Login:**
  - phone + PIN
  - **"Try demo"** buttons for Customer (Rahim, `01800000002`), Agent (`01800000004`), Merchant (`01800000005`) and Admin (`01800000001`), all with PIN `48213`. Each one logs in directly.
  - the language toggle
  - error messages through `errorMessage` (INVALID_CREDENTIALS with attempts left, ACCOUNT_LOCKED with the time, ACCOUNT_FROZEN)
  - after login, go to the role's home; an admin goes to the "Admin panel arrives in Phase 7" page, with a logout button
- **Registration wizard** (design §6.1), with a progress bar for the 4 steps:
  1. **phone** → request OTP. In dev the API echoes the code; show it in a dev-only hint.
  2. **verify OTP** → keep the registration token **in memory only**
  3. **identity**: name, date of birth (18+, checked client-side too), NID (10 digits), role, shop name (merchants only)
  4. **photos + PIN**: NID front, NID back, selfie (`capture="user"`), PIN + confirm, with the "Do not upload a real NID" banner. Submit is one `multipart/form-data` request, which logs the user in.
  - Losing the token (expired: 401) → back to step 1 with a message.
- **After registration:** a `PENDING_KYC` user lands on their home with the KYC banner. With the demo's `KYC_AUTO_APPROVE`, a customer is `ACTIVE` immediately.

- [ ] **Step 1: Write the failing tests** (MSW):
  - login success → the store is authenticated, and the route is the customer home
  - wrong PIN → the translated `INVALID_CREDENTIALS` message with attempts left
  - the demo Agent button logs in as the agent
  - the admin login → the Phase 7 page
  - the wizard:
    - the happy path through all 4 steps sends one multipart request with the 3 files and the fields
    - the step-3 shop-name field appears only for a merchant
    - an under-18 date of birth is blocked client-side
    - PIN ≠ confirm is blocked
    - an expired registration token → back to step 1
  - the registration token never touches `localStorage` or `sessionStorage` (spy on both)
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: tests, check-tokens, lint, typecheck, build.**

### Task 6: Customer home and the money flows
**⚙️ Effort: extra-high.** The screens where money moves: idempotency, PIN errors and the balance refresh.

**Files (client/src/):**
- `features/transfer/flows.ts`: the client copy of the flow table (type → path, initiator role, receiver role, title key)
- `features/transfer/TransferFlow.tsx`, with the steps `EnterStep`, `PreviewStep`, `PinStep`, `ReceiptView`
- `api/transactions.ts`: `lookup`, `preview`, `transfer`, `history`, `receipt`
- `pages/customer/Home.tsx`, `pages/customer/SendMoney.tsx`, `CashOut.tsx`, `Payment.tsx` (each a thin wrapper: `<TransferFlow type="SEND_MONEY" />`)
- Tests: `features/transfer/TransferFlow.test.tsx`, `pages/customer/Home.test.tsx`

**Behaviour:**
- **Home:**
  - the balance card (the gradient, marked `design-ok: balance card`), hidden as `৳ ••••` until tapped
  - the action grid (Send Money, Cash Out, Payment, History)
  - the 5 most recent history items
  - the bottom nav
  - for a non-ACTIVE user: the status banner, and the money actions disabled (not hidden)
- **`TransferFlow`:**
  1. **Enter:** the receiver's phone, debounced `GET /wallets/lookup` showing the masked name and role or a translated error; then the amount; then an optional note
  2. **Preview:** `POST /transactions/preview`, showing amount, fee and total (the total biggest), plus the receiver
  3. **PIN:** create the `Idempotency-Key` **here**, then submit
  4. **Receipt:** TrxID, parties, amount, fee, `mine.balanceAfter`, and the time. Buttons: "Done" (home) and "Share" (`navigator.share` when available, otherwise copy the TrxID).
  - Back from Preview or PIN returns to Enter with the values kept. Changing anything after the PIN step's key was created **drops the key** (a new confirm gets a new key).
- **Error handling on submit:**
  - `INVALID_PIN` → stay on PIN, cleared, showing attempts left
  - `ACCOUNT_LOCKED` → a message with the unlock time, back to home
  - `INSUFFICIENT_BALANCE`, `LIMIT_EXCEEDED` (with its details), `RECEIVER_LIMIT_EXCEEDED`, `RECEIVER_BALANCE_LIMIT`, `RECEIVER_NOT_ACTIVE` → back to Preview with the translated message
  - `NETWORK_ERROR` → stay on PIN with a **"Try again"** button that resends **with the same key**
- **After success:** invalidate the `me` and `history` queries, so the balance and the recent list update.

- [ ] **Step 1: Write the failing tests** (MSW records each request's headers and body):
  - the happy Send Money path: lookup → preview → PIN → receipt; the POST body has `receiverPhone`, `amount` as the poisha string, `pin`, and the `Idempotency-Key` header is a UUID
  - **Review focus #2:**
    - a network error on submit, then "Try again" → the second POST has the **same** key, and the receipt shows (the mock answers 200 `replayed: true`)
    - going back to Enter, changing the amount and confirming again → a **different** key
  - `INVALID_PIN` → still on the PIN step, the PIN cleared, "2 attempts left" (translated)
  - `LIMIT_EXCEEDED` → back on Preview with the message
  - the receipt's balance comes from `mine.balanceAfter`; after success the `me` query is refetched
  - Home: the balance is hidden until tapped; a `PENDING_KYC` user's Send Money button is disabled; the amounts are formatted, and the money-out ones in `text-danger` with U+2212
  - the same component drives Cash Out and Payment (one test each: the right path and the receiver-role error when looking up a wrong-role phone)
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: tests, check-tokens, lint, typecheck, build.**

### Task 7: History, receipts, and the agent and merchant homes
**⚙️ Effort: high.**

**Files (client/src/):**
- `pages/shared/History.tsx` (`useInfiniteQuery` on `nextCursor`; filters: type and date range, as Dhaka dates)
- `pages/shared/Receipt.tsx` (`/transactions/:trxId`)
- `pages/agent/AgentHome.tsx`, `pages/agent/CashIn.tsx` (`<TransferFlow type="CASH_IN" />`)
- `pages/merchant/MerchantHome.tsx`
- Tests: `pages/shared/History.test.tsx`, `pages/agent/AgentHome.test.tsx`

**Behaviour:**
- **History rows:**
  - the direction sign and colour (+ `success-dark`, − `danger`), the counterparty name, the type label, the time
  - tapping a row → its receipt
  - the empty state; skeletons while loading; "Load more" (or on scroll) until `nextCursor` is null
- **The agent home:** the e-money balance, actions **Cash In** and **History**, and recent items (Cash Outs received show the commission-included amount, as the API gives it).
- **The merchant home:** balance, recent payments, History, and a "Your number for payments" card with the merchant's phone (QR is v2).
- **Receipt of someone else's transaction:** the API's 404 → a translated "not found" page.

- [ ] **Step 1: Write the failing tests:**
  - history renders 2 pages from the mock (`nextCursor` then null), with no duplicate rows
  - the type filter sends `type=CASH_OUT`; the date filter sends `from` and `to` as `YYYY-MM-DD`
  - the empty state
  - a receipt 404 → the not-found page
  - the agent home shows Cash In and no Send Money; the merchant home shows no money action
  - a CUSTOMER at `/cash-in` → redirected home
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: tests, check-tokens, lint, typecheck, build.**

### Task 8: Profile
**⚙️ Effort: high.**

**Files (client/src/):**
- `pages/shared/Profile.tsx`, `pages/shared/ChangePin.tsx`, `api/me.ts` (`changePin`, `changePhoto`)
- Test: `pages/shared/Profile.test.tsx`

**Behaviour:**
- **Profile shows:**
  - photo, name, phone, masked NID, role, shop name, status and KYC status
  - **Language** (the toggle)
  - **Change PIN** (current, new, confirm; the new PIN uses the same strength rules as registration, client-side too)
  - **Change photo** (`ImagePicker` → `PUT /me/photo` → refresh `me`)
  - **Log out** (`POST /auth/logout`, clear the store, go to `/login`)
- **After a PIN change:** a success toast; the other sessions are signed out (by the server); the current one stays.

- [ ] **Step 1: Write the failing tests:**
  - change PIN: success toast; a wrong current PIN → the translated `INVALID_PIN` with attempts left; `PIN_UNCHANGED`; a weak new PIN blocked client-side
  - change photo: the multipart field is `photo`; the image updates after `me` refetches
  - logout clears the store and calls `/auth/logout`
  - switching to Bangla changes the visible labels and `<html lang="bn">`
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: tests, check-tokens, lint, typecheck, build.**

### Task 9: Polish, phone check, docs and the pull request
**⚙️ Effort: high.**

- [ ] **Step 1: Visual pass with `/design-loop`** on each main screen (login, register steps, customer home, Send Money's 4 steps, history, receipt, agent home, merchant home, profile), **in both languages**. If the design-loop skill needs a browser that isn't installed, stop and tell the user what to install.
- [ ] **Step 2: Every screen has its states:** loading skeleton, empty state, error toast, and the disabled money actions while KYC is pending (TASTE.md).
- [ ] **Step 3: Docs:**
  - `docs/design.md`:
    - §11: the language toggle (Bangla digits in `bn`); the font; the client architecture (session in memory, the single-flight refresh, the idempotency key per confirm screen)
    - §14: the Phase 6 row is done
    - §15: a "Phase 6 build" block with the user's decisions (one PR, no mockups, English + Bangla) and any others
  - `docs/api.md`: the two Task 1 endpoints, if not already in
  - `README.md`:
    - status: Phase 6 complete
    - how to run the client (`cd client && npm run dev`, or `npm run dev:phone` to open it on a phone on the same Wi-Fi)
    - space for screenshots (the user adds them in Phase 11)
- [ ] **Step 4: Run everything:**
  - server: `npm test`, lint, typecheck
  - client: `npm test`, lint, typecheck, build
  - `node design/check-tokens.mjs` → zero findings

  Then stop. **The user** tests on the Galaxy S24 Ultra (`npm run dev:phone`, then the LAN URL in Samsung Internet, since Chrome's HTTPS-only setting blocks plain-HTTP LAN addresses), reviews the Bangla text, commits, pushes `feat/frontend` and opens the PR.

---

**Phase 6 is done when:**
- all server and client tests pass, with lint, typecheck and build clean, and `check-tokens` reports nothing
- a recruiter can log in with a demo button and send money, cash in, cash out and pay a merchant, in either language, on a phone-sized screen
- the user has tried it on the S24 Ultra and reviewed the Bangla text
- the PR is reviewed by a fresh session and merged into `main`
