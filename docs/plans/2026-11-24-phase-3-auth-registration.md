# Phase 3 — Auth, Registration & Uploads: Implementation Plan

> **For Claude Code:** do the tasks in order. For each task: write the tests first, run them and show they fail, implement, run them and show they pass, run lint + typecheck, then stop and let the user review and commit. Explain each file as you create it. Don't add anything outside the task. Don't commit or push.
> Steps use checkboxes (`- [ ]`).

**Goal:** a complete, tested auth backend:
- 4-step registration: phone → OTP → identity with a 10-digit NID → 3 photos + PIN
- login with PIN lockout
- rotating refresh tokens
- logout, and `GET /me`

All of it backed by PostgreSQL through Prisma 7.

**Architecture:**
- New code lives in `server/src/modules/auth/` (routes → controller → service) and `server/src/modules/me/`.
- Infrastructure goes in `server/src/lib/`: Prisma client, storage drivers, OTP provider, image processing.
- `createApp(deps?)` accepts injected dependencies (storage, OTP provider, the KYC auto-approve flag), so tests run without Cloudinary or SMS.
- Integration tests hit a real Postgres test database (`pocketpay_test`).
- Backend only. The screens come in Phase 6. Wallets are created in Phase 4.

**Tech stack (new in this phase):**
- `@prisma/client`, `@prisma/adapter-pg` and `prisma` (dev dependency), all **pinned to exactly `7.10.1`**. npm's `latest` tag for `prisma` currently points to an 8.0 release candidate, so don't use it.
- `pg`, `jsonwebtoken`, `bcryptjs`, `multer`, `file-type`, `sharp`, `cloudinary`, `express-rate-limit`
- dev: `@types/jsonwebtoken`, `@types/multer`, `@types/pg`

**Spec:** `docs/design.md` §5, §6.1, §6.6, §8.2 (auth tables), §9 (auth endpoints), §10.

## Global constraints
- **Prisma 7 specifics** (tested on 2026-11-24 with 7.10.1):
  - The generator is `provider = "prisma-client"` with `output = "../src/generated/prisma"`.
  - The datasource block has **no `url`**; the URL lives in `server/prisma.config.ts`.
  - The client is created as `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`, imported from `../generated/prisma/client`.
  - `prisma migrate dev` does **not** run `generate`. Always run `npm run db:generate` after a schema change.
- **`prisma.config.ts` must use `url: process.env.DATABASE_URL ?? ''`, not Prisma's `env()` helper.** `env()` throws when `.env` is missing, which breaks `prisma generate` on a fresh clone and in CI.
- **Duplicate-key errors in Prisma 7 with an adapter:** the error has `code === 'P2002'`, but `meta.target` is **absent**. The constraint name is at `err.meta.driverAdapterError.cause.constraint.index`, e.g. `"users_nid_number_key"`. Map errors by that index name.
- **Use `bcryptjs`, not `bcrypt`.** `bcrypt` needs a native build step that npm 11 may skip. PIN hashes use cost 10.
- **npm 11 may skip a dependency's install script.** If `npx prisma migrate dev` complains that the schema engine is missing, run `node node_modules/@prisma/engines/scripts/postinstall.js` once.
- `src/generated/` and `uploads/` are git-ignored and excluded from ESLint.
- Table and column names are snake_case via `@@map`/`@map`; Prisma model names are PascalCase.
- Error responses keep the Phase 2 shape. Every error code used in this phase:

  | Code | HTTP |
  |---|---|
  | `VALIDATION_ERROR` (with `details: [{ path, message }]`) | 400 |
  | `PHONE_TAKEN` | 409 |
  | `NID_TAKEN` | 409 |
  | `OTP_COOLDOWN` | 429 |
  | `OTP_INVALID` (with `details: { attemptsLeft }`) | 400 |
  | `OTP_EXPIRED` | 400 |
  | `OTP_LOCKED` | 429 |
  | `REGISTRATION_TOKEN_INVALID` | 401 |
  | `MISSING_FILE` | 400 |
  | `FILE_TOO_LARGE` | 413 |
  | `UNSUPPORTED_FILE_TYPE` | 415 |
  | `INVALID_CREDENTIALS` | 401 |
  | `ACCOUNT_LOCKED` (with `details: { lockedUntil }`) | 423 |
  | `ACCOUNT_FROZEN` | 403 |
  | `UNAUTHENTICATED` | 401 |
  | `FORBIDDEN` | 403 |
  | `REFRESH_TOKEN_INVALID` | 401 |
  | `RATE_LIMITED` | 429 |
- **Values from the spec:**
  - BD phone: `^01[3-9]\d{8}$`
  - NID: `^\d{10}$`, unique
  - PIN: exactly 5 digits. Rejected: all the same digit, and ascending or descending runs (`01234`, `12345` … `56789` and the reverse).
  - Age: 18 or over, judged by **Asia/Dhaka** today's date
  - OTP: 6 digits, 5-minute expiry, 5 attempts, 60-second resend cooldown
  - Registration token: 15 minutes, single use
  - Access token: JWT HS256, 15 minutes
  - Refresh token: random, stored hashed, 7 days, rotated on every use
  - Lockout: 3 wrong PINs lock the account for 30 minutes
  - Images: JPEG/PNG/WebP, max 2 MB each, re-encoded to WebP at most 1600px wide with EXIF stripped. The profile photo is a 512×512 crop.
- **The NID is never logged and never returned unmasked** in this phase. Masked form: `*******` followed by the last 3 digits.
- Registration roles: `CUSTOMER`, `AGENT`, `MERCHANT`. `ADMIN` is rejected.

## Review focus
Inputs the main tests don't cover that would most likely hurt a real user. Each one has a test in its task:
1. **Double-submit of registration step 4.** Two simultaneous `complete` requests with the same registration token must create exactly **one** user. One gets 201; the other gets 401 `REGISTRATION_TOKEN_INVALID` or 409. *(Task 5)*
2. **Phone typed as `+8801712345678` or with spaces** must be rejected with 400 and a message saying the format is `01XXXXXXXXX`, not silently fail later. *(Task 2)*
3. **Lockout expiry.** After `locked_until` has passed, the correct PIN logs in and the failure counter resets to 0. *(Task 6)*
4. **A HEIC photo** (some phone cameras save these) or a renamed `.txt` file must get 415 with a message listing the accepted types. *(Task 4)*
5. **A reused refresh token.** Presenting an already-rotated token must revoke the whole session family, so the newest token stops working too. *(Task 6)*

---

### Task 1: Prisma, the auth tables and the test database

**Files:**
- Modify: `docker-compose.yml` (add the init-script volume)
- Create: `docker/postgres/init/01-create-test-db.sql`
- Create: `server/prisma.config.ts`, `server/prisma/schema.prisma`, and the `server/prisma/migrations/…_init_auth/` migration
- Create: `server/src/lib/prisma.ts`
- Create: `server/tests/global-setup.ts`, `server/tests/helpers/db.ts`
- Modify: `server/vitest.config.ts`, `server/package.json`, `server/eslint.config.js`, `server/.env.example`, root `.gitignore`
- Test: `server/tests/db.test.ts`

**Interfaces produced:**
- `prisma: PrismaClient` from `src/lib/prisma.ts`, built with `PrismaPg` and `env.DATABASE_URL`.
- `resetDb(): Promise<void>` from `tests/helpers/db.ts`. It truncates every table except `_prisma_migrations`, with `RESTART IDENTITY CASCADE`.
- Prisma enums: `Role { CUSTOMER AGENT MERCHANT ADMIN }`, `UserStatus { PENDING_KYC ACTIVE FROZEN REJECTED }`, `DocumentKind { NID_FRONT NID_BACK SELFIE PROFILE }`, `DocumentAccess { PRIVATE PUBLIC }`, `KycStatus { PENDING APPROVED REJECTED }`, `OtpPurpose { REGISTER }`.
- Models, mapped to the tables in design §8.2. All ids are uuid; timestamps are `timestamptz`.
  - `User` → `users`:
    - `phone` unique
    - `nidNumber` unique, `@map("nid_number")`
    - `name`, `dateOfBirth` (`@db.Date`), `shopName?`, `pinHash`
    - `role`, `status`
    - `failedPinAttempts` (Int, default 0), `lockedUntil?`
    - `profilePhotoKey?`
    - `createdAt`, `updatedAt`
  - `UserDocument` → `user_documents`: `userId`, `kind`, `storageKey`, `access`, `mime`, `sizeBytes`, `width`, `height`, `createdAt`
  - `KycSubmission` → `kyc_submissions`: `userId`, `nidFrontId`, `nidBackId`, `selfieId` (relations to `UserDocument`), `status`, `reviewedById?`, `reason?`, `submittedAt`, `reviewedAt?`
  - `OtpCode` → `otp_codes`: `phone`, `codeHash`, `purpose`, `expiresAt`, `attempts` (default 0), `verifiedAt?`, `consumedAt?`, `createdAt`. Index on `(phone, createdAt)`.
  - `RefreshToken` → `refresh_tokens`: `userId`, `tokenHash` (unique), `family` (uuid), `expiresAt`, `revokedAt?`, `replacedById?`, `userAgent?`, `ip?`, `createdAt`
  - `AuditLog` → `audit_logs`: `actorId?`, `action`, `targetType?`, `targetId?`, `metadata` (Json?), `ip?`, `createdAt`

- [ ] **Step 1: Set up the test database.**
  - `01-create-test-db.sql` contains `CREATE DATABASE pocketpay_test OWNER pocketpay;`.
  - In `docker-compose.yml`, mount `./docker/postgres/init:/docker-entrypoint-initdb.d:ro`.
  - Init scripts only run on a **fresh** volume, so for your existing DB also run, once: `docker compose exec db createdb -U pocketpay pocketpay_test`.
- [ ] **Step 2: Install the dependencies** listed in the Tech stack, with the exact versions for Prisma.
- [ ] **Step 3: Add the scripts and ignores.**
  - npm scripts: `db:generate` = `prisma generate`, `db:migrate` = `prisma migrate dev`, `db:deploy` = `prisma migrate deploy`, `db:studio` = `prisma studio`, `postinstall` = `prisma generate`.
  - Ignore `src/generated` in ESLint.
  - Add `server/src/generated/` and `server/uploads/` to the root `.gitignore`.
- [ ] **Step 4: Write `prisma.config.ts` and `schema.prisma`** as specified above. Run `npm run db:migrate -- --name init_auth`, then `npm run db:generate`.
- [ ] **Step 5: Write `src/lib/prisma.ts`.**
- [ ] **Step 6: Set up the test infrastructure.**
  - In `vitest.config.ts`:
    - set `test.env.DATABASE_URL` to `postgresql://pocketpay:pocketpay@localhost:5433/pocketpay_test`
    - add `globalSetup: ['tests/global-setup.ts']` and `fileParallelism: false`
    - also add the Task 2 env values to `test.env`: `JWT_SECRET` (any 40+ character string), `OTP_DEV_ECHO=true`, `KYC_AUTO_APPROVE=false`, `STORAGE_DRIVER=local`
  - `global-setup.ts` runs `npx prisma migrate deploy` with `DATABASE_URL` set to the test URL, using `execSync` with `stdio: 'inherit'`.
- [ ] **Step 7: Write the failing test** `tests/db.test.ts`, with `beforeEach(resetDb)`:
  ```ts
  it('creates and reads a user', …)  // create with all required fields → findUnique by phone returns it, status PENDING_KYC by default
  it('rejects a duplicate NID with P2002 on users_nid_number_key', async () => {
    // create user A (nid 1234567890), then user B (different phone, same nid)
    // expect error.code === 'P2002'
    // expect error.meta.driverAdapterError.cause.constraint.index === 'users_nid_number_key'
  });
  ```
- [ ] **Step 8: Run the checks.** `npm test` → all PASS (7 old + 2 new). `npm run lint` and `npm run typecheck` → clean.

### Task 2: Config and validation rules

**Files:**
- Modify: `server/src/config/env.ts`, `server/.env.example`, `server/vitest.config.ts`
- Create: `server/src/modules/auth/auth.schemas.ts`
- Create: `server/src/utils/time.ts`, `server/src/utils/mask.ts`
- Create: `server/src/middlewares/validate.ts`
- Test: `server/tests/unit/auth.schemas.test.ts`, `server/tests/unit/mask.test.ts`, `server/tests/env.test.ts` (extend)

**Interfaces produced:**
- New env keys:
  - `JWT_SECRET` (string, **min 32 characters**, required)
  - `OTP_DEV_ECHO` (`z.stringbool()`, default `true`)
  - `KYC_AUTO_APPROVE` (`z.stringbool()`, default `false`)
  - `STORAGE_DRIVER` (`'local' | 'cloudinary'`, default `'local'`)
  - `CLOUDINARY_URL` (optional string, but required when `STORAGE_DRIVER=cloudinary`, enforced with `superRefine`)
- In `.env.example`, `JWT_SECRET` gets a placeholder and the comment `# generate: openssl rand -base64 48`.
- `phoneSchema`, `nidSchema`, `pinSchema`, `dobSchema` (an ISO `YYYY-MM-DD` string; 18+ in Dhaka; not in the future; year ≥ 1900), `registrationRoleSchema`.
- `requestOtpBody = { phone }`, `verifyOtpBody = { phone, code: /^\d{6}$/ }`.
- `completeRegistrationBody`:
  - `name`: trimmed, 2–60 characters
  - `dateOfBirth`, `nidNumber`, `role`, `pin`
  - `confirmPin`, which must equal `pin`
  - `shopName`: trimmed, 2–80 characters, **required only when `role === 'MERCHANT'`**
- `loginBody = { phone, pin: /^\d{5}$/ }`. Weak-PIN rules aren't applied at login.
- `dhakaToday(now?: Date): string` returns `YYYY-MM-DD` in Asia/Dhaka, using `Intl.DateTimeFormat` with `timeZone: 'Asia/Dhaka'`.
- `maskNid(nid: string): string` returns `'*******' + last 3`.
- `validateBody(schema: ZodType): RequestHandler`. On failure it calls `next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request', issues.map(i => ({ path: i.path.join('.'), message: i.message }))))`. On success it replaces `req.body` with the parsed data.

- [ ] **Step 1: Write the failing tests.** Use exact cases:
  - phone: `01712345678` ✓. `+8801712345678` ✗, and the message must contain `01XXXXXXXXX`. Also ✗: `0171234567`, `01212345678`, `017 1234 5678`.
  - nid: `1234567890` ✓. `123456789`, `12345678901`, `12345abcde` and the 17-digit `19901234567890123` ✗.
  - pin: `48213` ✓. `11111`, `12345`, `54321`, `01234`, `98765`, `1234`, `123456` and `12a45` ✗.
  - dob, with `now` fixed at 2026-11-24 in Dhaka: `2008-11-24` ✓ (turns 18 today), `2008-11-25` ✗, `2030-01-01` ✗, `1899-12-31` ✗.
  - complete body: `role: 'MERCHANT'` without `shopName` ✗. `role: 'ADMIN'` ✗. `confirmPin` mismatch ✗, with the error path `confirmPin`.
  - `maskNid('1234567890') === '*******890'`.
  - env: `STORAGE_DRIVER=cloudinary` without `CLOUDINARY_URL` throws, naming `CLOUDINARY_URL`. A `JWT_SECRET` shorter than 32 characters throws, naming `JWT_SECRET`.
- [ ] **Step 2: Run them and confirm they FAIL.**
- [ ] **Step 3: Implement.** For age, compare `dateOfBirth` with `dhakaToday()` minus 18 years, as strings or as calendar dates, not with millisecond arithmetic.
- [ ] **Step 4: Run the checks.** All tests PASS; lint and typecheck clean.

### Task 3: OTP request and verify

**Files:**
- Create: `server/src/lib/otp.ts`, `server/src/modules/auth/otp.service.ts`, `server/src/modules/auth/tokens.ts`, `server/src/modules/auth/auth.routes.ts`, `server/src/modules/auth/auth.controller.ts`, `server/src/lib/audit.ts`
- Modify: `server/src/app.ts`
- Test: `server/tests/auth.otp.test.ts`

**Interfaces produced:**
- `createApp(deps?: AppDeps)`, where `AppDeps = { storage?: StorageProvider; otpProvider?: OtpProvider; kycAutoApprove?: boolean }`. Defaults come from env. Mount `app.use('/api/v1/auth', createAuthRouter(deps))`.
- `interface OtpProvider { send(phone: string, code: string): Promise<void> }`. `ConsoleOtpProvider` logs `OTP for 017******78: 123456`, with the phone masked.
- `signRegistrationToken({ phone, otpId }): string` and `verifyRegistrationToken(token): { phone, otpId }`. JWT HS256, `aud: 'registration'`, 15 minutes. It throws `AppError(401, 'REGISTRATION_TOKEN_INVALID')`.
- `writeAudit(db: PrismaClient | Prisma.TransactionClient, entry: { actorId?: string; action: string; targetType?: string; targetId?: string; metadata?: object; ip?: string }): Promise<void>`.
- The OTP code hash is HMAC-SHA256, keyed with `JWT_SECRET`, over `${phone}:${code}`. The code comes from `crypto.randomInt(0, 1_000_000)`, zero-padded to 6 digits.
- `POST /auth/register/request-otp` `{ phone }`:
  - 409 `PHONE_TAKEN` if a user already has this phone
  - 429 `OTP_COOLDOWN` (`details: { retryAfterSeconds }`) if the last OTP for this phone is less than 60 seconds old
  - otherwise it marks earlier unconsumed OTPs for this phone as consumed, creates a new one and calls `otpProvider.send`
  - 200 `{ expiresInSeconds: 300, resendInSeconds: 60, devOtp?: string }`. `devOtp` is included only when `OTP_DEV_ECHO` is true.
- `POST /auth/register/verify-otp` `{ phone, code }`: checks the latest unconsumed OTP for the phone, in this order:
  - none, or expired → 400 `OTP_EXPIRED`
  - `attempts >= 5` → 429 `OTP_LOCKED`
  - wrong code → increment attempts, then 400 `OTP_INVALID` with `attemptsLeft`. The 5th wrong attempt returns `OTP_LOCKED`.
  - correct → set `verifiedAt`, then 200 `{ registrationToken, expiresInSeconds: 900 }`

- [ ] **Step 1: Write the failing tests**, each with `beforeEach(resetDb)` and a fake `otpProvider` that records calls:
  - request: 200 with a 6-digit `devOtp`; the fake provider was called once with that phone and code; an `otp_codes` row exists whose `codeHash` ≠ the code
  - request for a phone that already has a user → 409 `PHONE_TAKEN`
  - two requests within 60 seconds → the second is 429 `OTP_COOLDOWN`. To test this, set the first row's `createdAt` 61 seconds in the past, and the next request should be 200.
  - verify with the right code → 200, and `verifyRegistrationToken(registrationToken).phone` matches
  - wrong code → 400 `OTP_INVALID` with `attemptsLeft: 4`. After 5 wrong attempts → 429 `OTP_LOCKED`, and the right code is also refused.
  - expired: set `expiresAt` in the past → 400 `OTP_EXPIRED`
  - invalid phone body → 400 `VALIDATION_ERROR`
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, lint and typecheck.**

### Task 4: Image processing and storage

**Files:**
- Create: `server/src/lib/images.ts`, `server/src/lib/storage/types.ts`, `server/src/lib/storage/memory.ts`, `server/src/lib/storage/local.ts`, `server/src/lib/storage/cloudinary.ts`, `server/src/lib/storage/index.ts`
- Create: `server/src/middlewares/upload.ts`
- Test: `server/tests/unit/images.test.ts`, `server/tests/unit/storage.memory.test.ts`

**Interfaces produced:**
- `processImage(input: Buffer, opts: { mode: 'document' | 'avatar' }): Promise<{ data: Buffer; width: number; height: number; sizeBytes: number; mime: 'image/webp' }>`:
  - Detect the type with `fileTypeFromBuffer`. Anything other than `image/jpeg`, `image/png` or `image/webp` throws `AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only JPEG, PNG or WebP images are allowed')`.
  - Pipeline: `sharp(input).rotate()` (fixes phone-photo orientation **before** the metadata is stripped). Then, for `document`: `.resize({ width: 1600, withoutEnlargement: true })`. For `avatar`: `.resize(512, 512, { fit: 'cover' })`. Then `.webp({ quality: 80 }).toBuffer({ resolveWithObject: true })`.
- `interface StorageProvider`:
  - `put(o: { key: string; body: Buffer; contentType: string; access: 'PRIVATE' | 'PUBLIC' }): Promise<void>`
  - `delete(key: string, access: 'PRIVATE' | 'PUBLIC'): Promise<void>`
  - `publicUrl(key: string): string`
  - `signedUrl(key: string, ttlSeconds: number): Promise<string>`
- The three drivers:
  - `MemoryStorage`, for tests. It exposes `.objects: Map<string, { body; access; contentType }>`. Its `signedUrl` returns `memory://${key}?ttl=${ttl}`.
  - `LocalStorage(rootDir = 'uploads')`. It writes to `uploads/{private|public}/{key}`. `publicUrl` returns `/uploads/${key}`; `app.ts` serves `uploads/public` at `/uploads` with `express.static`. `signedUrl` throws `AppError(501, 'NOT_IMPLEMENTED')` for now; the admin viewer comes in Phase 7.
  - `CloudinaryStorage`, configured from `CLOUDINARY_URL`. `put` uses `upload_stream` with `{ public_id: key, resource_type: 'image', type: access === 'PRIVATE' ? 'private' : 'upload', overwrite: false }`. `signedUrl` uses `cloudinary.utils.private_download_url(key, 'webp', { type: 'private', expires_at: now + ttl })`. `publicUrl` uses `cloudinary.url(key, { secure: true })`. Not unit-tested; checked manually in Step 5.
- `createStorage(env): StorageProvider` picks the driver from `STORAGE_DRIVER`.
- `uploadKycImages` is a multer middleware:
  - `memoryStorage`
  - `limits: { fileSize: 2 * 1024 * 1024, files: 3, fields: 10 }`
  - `.fields([{ name: 'nidFront', maxCount: 1 }, { name: 'nidBack', maxCount: 1 }, { name: 'selfie', maxCount: 1 }])`
  - Multer's `LIMIT_FILE_SIZE` error is mapped to `AppError(413, 'FILE_TOO_LARGE', 'Each image must be 2 MB or smaller')`.
  - A missing field gives 400 `MISSING_FILE` with `details: { field }`. This check runs in the controller.

- [ ] **Step 1: Write the failing tests.** Build test images in code with `sharp({ create: … })`:
  - a 2400×1200 PNG in `document` mode → WebP, 1600×800
  - a 300×200 JPEG in `document` mode → WebP, 300×200 (not enlarged)
  - `avatar` mode → 512×512
  - a JPEG made with `.withMetadata({ exif: { IFD0: { Copyright: 'x' } } })` → the output's `sharp(out).metadata()` has no `exif`
  - `Buffer.from('hello')` → 415 `UNSUPPORTED_FILE_TYPE`
  - a GIF buffer → 415
  - a HEIC-style buffer whose first bytes are `ftypheic` → 415, and the message contains `JPEG, PNG or WebP`
  - `MemoryStorage`: put, then delete, round-trips correctly
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, lint and typecheck.**
- [ ] **Step 5 (manual, optional now): check Cloudinary.**
  - Create a free account and put its `CLOUDINARY_URL` in `server/.env` with `STORAGE_DRIVER=cloudinary`.
  - Run a tiny throwaway script that `put`s one private image and prints `signedUrl(key, 300)`. The URL should download the image.
  - Delete the script and switch back to `STORAGE_DRIVER=local`. **Never commit the URL.**

### Task 5: Completing registration

**Files:**
- Create: `server/src/modules/auth/pin.ts`, `server/src/modules/auth/registration.service.ts`, `server/src/modules/auth/user.presenter.ts`
- Create: `server/src/modules/auth/refresh.service.ts` (the issuing part only; Task 6 adds rotation)
- Modify: `auth.routes.ts`, `auth.controller.ts`, `tokens.ts`
- Test: `server/tests/auth.register.test.ts`, `server/tests/helpers/images.ts`

**Interfaces produced:**
- `hashPin(pin: string): Promise<string>` (bcryptjs, cost 10) and `verifyPin(pin: string, hash: string): Promise<boolean>`.
- `signAccessToken({ userId, role }): string`, with `aud: 'access'`, `sub: userId`, a `role` claim and 15 minutes. `verifyAccessToken(token): { userId, role }`, which throws `AppError(401, 'UNAUTHENTICATED')`.
- `issueRefreshToken(db, { userId, family?, userAgent?, ip? }): Promise<{ token: string; expiresAt: Date }>`. The token is 32 random bytes, base64url. The DB stores `sha256(token)`. A new `family` uuid is created when none is given.
- `setRefreshCookie(res, token, expiresAt)` sets cookie `pp_rt`: `httpOnly: true`, `sameSite: 'lax'`, `secure: env.NODE_ENV === 'production'`, `path: '/api/v1/auth'`, `expires: expiresAt`. `clearRefreshCookie(res)` uses the same path.
- `toPublicUser(user: User & { kycSubmissions: KycSubmission[] }, storage): PublicUser`, where `PublicUser = { id, phone, name, role, status, nidMasked, profilePhotoUrl: string | null, kycStatus }`. `kycStatus` comes from the latest submission by `submittedAt`, or `null` if there is none. `profilePhotoUrl` is `storage.publicUrl(profilePhotoKey)`, or `null`. Every query that feeds the presenter includes `kycSubmissions`.
- `POST /auth/register/complete`:
  - Header: `Authorization: Bearer <registrationToken>`.
  - Body: `multipart/form-data` with the text fields from `completeRegistrationBody` and the files `nidFront`, `nidBack`, `selfie`.
  - Middleware order: `uploadKycImages` → registration-token check → `validateBody(completeRegistrationBody)` → controller.
  - The service:
    1. Re-check that the phone matches the token, and that the OTP row has `verifiedAt` set and `consumedAt` null. Otherwise → 401.
    2. Fail early with 409 `PHONE_TAKEN` or `NID_TAKEN` when either is already used.
    3. `processImage` all 3 files (`document` mode), plus the selfie again in `avatar` mode.
    4. Generate `userId = crypto.randomUUID()`. Upload to the keys `kyc/{userId}/nid-front-{uuid}.webp`, `kyc/{userId}/nid-back-{uuid}.webp` and `kyc/{userId}/selfie-{uuid}.webp` (PRIVATE), and `profile/{userId}/{uuid}.webp` (PUBLIC).
    5. In **one** `prisma.$transaction`:
       - Consume the OTP with `updateMany({ where: { id: otpId, consumedAt: null }, data: { consumedAt: now } })`. If `count !== 1`, throw 401 `REGISTRATION_TOKEN_INVALID`.
       - Create the user with the given id. Status is `ACTIVE` when `kycAutoApprove && role === 'CUSTOMER'`, otherwise `PENDING_KYC`. Set `profilePhotoKey`.
       - Create the 4 `UserDocument` rows.
       - Create the `KycSubmission`: `APPROVED` with `reason: 'auto-approved'` when auto-approved, otherwise `PENDING`.
       - Write the audit entry `REGISTERED` (metadata: role, autoApproved; **never the NID**).
       - Issue the refresh token.
    6. If anything after the uploads fails, delete the 4 uploaded objects (best effort) and rethrow. Map P2002 on `users_phone_key` to 409 `PHONE_TAKEN` and on `users_nid_number_key` to 409 `NID_TAKEN`.
    7. Respond 201 `{ user: PublicUser, accessToken }` and set the refresh cookie.

- [ ] **Step 1: Write the failing tests.** Use `createApp({ storage: new MemoryStorage(), otpProvider: fake, kycAutoApprove })` and a helper `registerToToken(phone)` that requests and verifies an OTP:
  - happy path → 201:
    - `user.status === 'PENDING_KYC'`, `user.kycStatus === 'PENDING'`, `user.nidMasked === '*******890'`
    - the response contains no `pinHash` and no full NID
    - `Set-Cookie` includes `pp_rt=`, `HttpOnly`, `Path=/api/v1/auth` and `SameSite=Lax`
    - storage holds 3 PRIVATE objects and 1 PUBLIC object
    - the DB has 4 documents and 1 submission
    - `users.pin_hash` ≠ the PIN, and `verifyPin` returns true
    - one `REGISTERED` audit row, whose metadata JSON doesn't contain the NID
  - `kycAutoApprove: true` + CUSTOMER → `ACTIVE` / `APPROVED`. `kycAutoApprove: true` + AGENT → still `PENDING_KYC`.
  - reusing the same registration token after success → 401 `REGISTRATION_TOKEN_INVALID`
  - **Review focus #1:** fire two `complete` requests with the same token through `Promise.all` → exactly one 201, exactly one user row, and the other response is 401 or 409
  - duplicate NID (another user already has it) → 409 `NID_TAKEN`, and storage holds 0 new objects
  - missing `selfie` → 400 `MISSING_FILE` with `details.field === 'selfie'`
  - a `.txt` file sent as `nidFront` → 415
  - a 3 MB file → 413 `FILE_TOO_LARGE`
  - MERCHANT without `shopName` → 400 `VALIDATION_ERROR`
  - an under-18 date of birth → 400
  - weak PIN `12345` → 400
  - no or garbage `Authorization` → 401 `REGISTRATION_TOKEN_INVALID`
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, lint and typecheck.**

### Task 6: Login, refresh, logout, `/me` and the auth guards

**Files:**
- Create: `server/src/middlewares/auth.ts`, `server/src/types/express.d.ts`, `server/src/modules/me/me.routes.ts`
- Modify: `refresh.service.ts`, `auth.routes.ts`, `auth.controller.ts`, `app.ts`
- Test: `server/tests/auth.session.test.ts`, `server/tests/unit/requireRole.test.ts`

**Interfaces produced:**
- `src/types/express.d.ts` adds `user?: { id: string; role: Role }` to Express's `Request`, through `declare global { namespace Express { interface Request … } }`.
- `requireAuth`: reads `Authorization: Bearer <access>`, verifies it and sets `req.user`. Missing or invalid → 401 `UNAUTHENTICATED`.
- `requireRole(...roles: Role[])`: when `req.user.role` isn't in the list → 403 `FORBIDDEN`.
- `rotateRefreshToken(db, rawToken, meta): Promise<{ user: User; token: string; expiresAt: Date }>`. In one transaction it finds the row by `sha256(raw)`:
  - not found, or expired → 401 `REFRESH_TOKEN_INVALID`
  - already revoked → **reuse detected**: revoke every token in that `family`, write the audit entry `REFRESH_TOKEN_REUSE`, then 401 `REFRESH_TOKEN_INVALID`
  - otherwise: revoke this row, issue a new token in the same family and set `replacedById`
  - a FROZEN user → 403 `ACCOUNT_FROZEN`
- `revokeRefreshToken(db, rawToken): Promise<void>`. It's idempotent.
- `POST /auth/login` `{ phone, pin }`:
  - **Unknown phone** → 401 `INVALID_CREDENTIALS`. Same message as a wrong PIN, so attackers can't tell which phones are registered.
  - If `lockedUntil > now` → 423 `ACCOUNT_LOCKED` with `lockedUntil`, **even when the PIN is right**.
  - **Wrong PIN** → increment `failedPinAttempts`. On reaching 3: set `lockedUntil = now + 30 min`, reset the counter to 0, write audit `ACCOUNT_LOCKED`, return 423. Before that, return 401 `INVALID_CREDENTIALS` with `details: { attemptsLeft }` and write audit `LOGIN_FAILED`.
  - **Right PIN:** if the user is FROZEN → 403 `ACCOUNT_FROZEN`. Otherwise reset `failedPinAttempts` to 0, clear `lockedUntil`, write audit `LOGIN_SUCCESS`, then 200 `{ user, accessToken }` and set the refresh cookie.
  - PENDING_KYC and REJECTED users **can** log in.
- `POST /auth/refresh` reads the `pp_rt` cookie and returns 200 `{ user, accessToken }` with a new cookie.
- `POST /auth/logout` revokes the cookie's token if there is one, clears the cookie, writes audit `LOGOUT` when a user is known, and returns 204.
- `GET /api/v1/me` (requires auth) returns 200 `{ user: PublicUser }`.

- [ ] **Step 1: Write the failing tests.** Seed users directly with Prisma plus `hashPin`; no need to go through registration.
  - login OK → 200, the cookie is set, and the access token verifies with the right `userId` and `role`
  - wrong PIN → 401 with `attemptsLeft: 2`, then `1`. The 3rd → 423 with `lockedUntil` about 30 minutes ahead. The right PIN while locked → 423.
  - **Review focus #3:** set `lockedUntil` 1 minute in the past → the right PIN gives 200, and `failedPinAttempts === 0`
  - unknown phone → 401 `INVALID_CREDENTIALS`, with the same message text as a wrong PIN
  - FROZEN user with the right PIN → 403 `ACCOUNT_FROZEN`
  - refresh → 200 with a new cookie value ≠ the old one. The old cookie then → 401.
  - **Review focus #5:** after that reuse, the **new** cookie is also 401, and an audit row `REFRESH_TOKEN_REUSE` exists
  - logout → 204, and that refresh cookie then → 401. Logout without a cookie → 204.
  - `GET /me` without a token → 401 `UNAUTHENTICATED`. With a token → `PublicUser` with `nidMasked`.
  - `requireRole('ADMIN')` unit test with a fake `req.user.role = 'CUSTOMER'` → `next` is called with a 403 `FORBIDDEN` AppError
- [ ] **Step 2: Run them and confirm they FAIL.** **Step 3: Implement.** **Step 4: Run all tests, lint and typecheck.**

### Task 7: Rate limits, docs and the pull request

**Files:**
- Create: `server/src/middlewares/rateLimit.ts`, `docs/api.md`
- Modify: `auth.routes.ts`, `README.md`, `server/.env.example`

- [ ] **Step 1: Add the rate limits.** Use `express-rate-limit` v8: `rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, handler })`. The handler sends 429 `RATE_LIMITED` in our error shape.
  - `otpLimiter`: 5 per 15 minutes per IP, on `request-otp`
  - `loginLimiter`: 10 per 15 minutes per IP, on `login`
  - `skip: () => env.NODE_ENV === 'test'`
  - Add a comment: in production, behind a proxy, `app.set('trust proxy', 1)` is needed so the real client IP is used. That's Phase 9.
- [ ] **Step 2: Write `docs/api.md`.** One section per auth endpoint, with method + path, auth, a request example, a response example and the error codes. Use **fake** data in the examples (phone `01700000000`, NID `1234567890`).
- [ ] **Step 3: Update the README.** "Run locally" gains: create the test DB once (`docker compose exec db createdb -U pocketpay pocketpay_test`), `npm run db:deploy`, and setting `JWT_SECRET` in `.env`. Add a "Try the auth flow with curl" snippet: request-otp → verify-otp → complete, using `-F nidFront=@front.jpg …` → `/me`.
- [ ] **Step 3b: Update `docs/design.md`** to record this phase's decisions:
  - §7.3 Auth row: `jsonwebtoken + bcryptjs`
  - §8.2: `KYC_AUTO_APPROVE` is an env var, not a `system_settings` row
  - §6.6: the profile photo is a 512×512 WebP crop of the selfie
  - §12: tests use a `MemoryStorage` driver and local dev uses `LocalStorage` (`STORAGE_DRIVER=local`); Cloudinary is for production
- [ ] **Step 4: Run everything.** `npm test`, lint and typecheck, all clean. Then:
  - start the dev server and walk through the curl flow once by hand, with 3 real JPEG photos of anything (not your real NID)
  - check that `uploads/` gets files and that `git status` doesn't show them
- [ ] **Step 5: Hand over to the user.** Stop here; the user commits per task, pushes `feat/auth` and opens the PR.

---

**Phase 3 is done when:**
- every test passes (the Phase 2 tests plus about 50 new ones), and lint and typecheck are clean
- the curl walkthrough registers a user, logs in, refreshes and reads `/me`
- no NID, PIN, OTP code or Cloudinary secret appears in logs, responses (except the masked NID) or git
- the PR is merged into `main`
