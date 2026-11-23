# PocketPay API (v1): auth

Base URL: `http://localhost:4000/api/v1` in local dev. Every example uses **fake data**
(phone `01700000000`, NID `1234567890`). Never send a real NID to a demo server.

## Conventions

**Response shape.** Every JSON response is one of:

```json
{ "success": true, "data": { "…": "…" } }
{ "success": false, "error": { "code": "SOME_CODE", "message": "Human-readable text", "details": {} } }
```

`details` appears only on the codes that say so in the [error-code table](#error-codes).

**Digits.** Phone, NID, PIN and OTP fields accept ASCII digits or Bangla digits (`০১৭…`);
the server converts Bangla to ASCII before validating.

**Tokens.**

| Token | Where it lives | Lifetime | Sent as |
|---|---|---|---|
| Registration token | client memory, during sign-up only | 15 min, single use | `Authorization: Bearer <token>` on `register/complete` |
| Access token | client memory (never localStorage) | 15 min | `Authorization: Bearer <token>` |
| Refresh token | `pp_rt` cookie: `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth`, `Secure` in production | 7 days, **rotated on every use** | sent by the browser automatically to `/auth/*` |

The three token types are not interchangeable: a registration token used as an access token
gets `401 UNAUTHENTICATED`.

**Rate limits** (per client IP, `RateLimit` / `RateLimit-Policy` headers, draft-8):

| Endpoint | Limit |
|---|---|
| `POST /auth/register/request-otp` | 5 per 15 minutes |
| `POST /auth/login` | 10 per 15 minutes |

Over the limit: `429 RATE_LIMITED`.

## The user object (`PublicUser`)

Returned by registration, login, refresh and `/me`. It never contains the full NID, the PIN
hash or the date of birth.

```json
{
  "id": "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
  "phone": "01700000000",
  "name": "Test User",
  "role": "CUSTOMER",
  "status": "PENDING_KYC",
  "shopName": null,
  "nidMasked": "*******890",
  "profilePhotoUrl": "/uploads/profile/6f1c2a7e-…/1d2e….webp",
  "kycStatus": "PENDING"
}
```

- `role`: `CUSTOMER` · `AGENT` · `MERCHANT` · `ADMIN`
- `status`: `PENDING_KYC` · `ACTIVE` · `FROZEN` · `REJECTED`. Only `ACTIVE` accounts will be
  able to move money (Phase 5).
- `kycStatus`: status of the latest KYC submission (`PENDING` · `APPROVED` · `REJECTED`), or `null`.
- `shopName`: merchants only, otherwise `null`.

---

## Registration (4 steps)

### 1. `POST /auth/register/request-otp`

Sends a 6-digit code to the phone. **Auth:** none. **Rate limit:** 5 / 15 min.

```json
{ "phone": "01700000000" }
```

**200**

```json
{ "success": true, "data": { "expiresInSeconds": 300, "resendInSeconds": 60, "devOtp": "482913" } }
```

`devOtp` is present only when the server runs with `OTP_DEV_ECHO=true` (dev and demo; there is
no real SMS gateway yet).

| Error | When |
|---|---|
| `400 VALIDATION_ERROR` | phone isn't `01XXXXXXXXX` (no `+88`, no spaces) |
| `409 PHONE_TAKEN` | an account already uses this phone |
| `429 OTP_COOLDOWN` | a code was sent less than 60 s ago. `details: { retryAfterSeconds }` |
| `502 OTP_SEND_FAILED` | the code couldn't be sent. Nothing is kept, so **retrying immediately is safe** (no cooldown) |
| `429 RATE_LIMITED` | more than 5 requests in 15 minutes from this IP |

### 2. `POST /auth/register/verify-otp`

Checks the code and returns a registration token. **Auth:** none.

```json
{ "phone": "01700000000", "code": "482913" }
```

**200**

```json
{ "success": true, "data": { "registrationToken": "eyJhbGciOiJIUzI1NiIs…", "expiresInSeconds": 900 } }
```

| Error | When |
|---|---|
| `400 VALIDATION_ERROR` | bad phone, or the code isn't 6 digits |
| `400 OTP_EXPIRED` | no code was requested, it expired (5 min), or a newer code replaced it |
| `400 OTP_INVALID` | wrong code. `details: { attemptsLeft }` |
| `429 OTP_LOCKED` | 5 wrong attempts: request a new code |

### 3 + 4. `POST /auth/register/complete`

Creates the account with identity details, 3 photos and a PIN, and logs the user in.
**Auth:** `Authorization: Bearer <registrationToken>`, checked **before** the upload is read.
**Body:** `multipart/form-data`.

| Field | Rules |
|---|---|
| `name` | 2–60 characters (trimmed) |
| `dateOfBirth` | `YYYY-MM-DD`, a real date, 1900 or later, 18+ by today's date in Asia/Dhaka |
| `nidNumber` | exactly 10 digits, not already registered |
| `role` | `CUSTOMER`, `AGENT` or `MERCHANT` |
| `shopName` | 2–80 characters, **required for `MERCHANT`**, ignored for other roles |
| `pin`, `confirmPin` | 5 digits, equal; not one digit repeated (`11111`) and not a run (`12345`, `54321`) |
| `nidFront`, `nidBack`, `selfie` | files: JPEG, PNG or WebP (checked by content, not file name), max 2 MB each |

```bash
curl -X POST http://localhost:4000/api/v1/auth/register/complete \
  -H "Authorization: Bearer $REG_TOKEN" \
  -F name="Test User" -F dateOfBirth=1995-06-15 -F nidNumber=1234567890 \
  -F role=CUSTOMER -F pin=48213 -F confirmPin=48213 \
  -F nidFront=@front.jpg -F nidBack=@back.jpg -F selfie=@selfie.jpg \
  -c cookies.txt
```

**201**, plus `Set-Cookie: pp_rt=…; Path=/api/v1/auth; HttpOnly; SameSite=Lax`

```json
{ "success": true, "data": { "user": { "…PublicUser…": "" }, "accessToken": "eyJhbGciOiJIUzI1NiIs…" } }
```

The images are re-encoded to WebP (max 1600 px wide, EXIF/GPS stripped) and stored privately;
the selfie also becomes the public 512×512 profile photo. New accounts are `PENDING_KYC`
(except customers when the server runs with `KYC_AUTO_APPROVE=true`, then `ACTIVE`).

| Error | When |
|---|---|
| `401 REGISTRATION_TOKEN_INVALID` | missing, expired, garbage or already-used token. Two submissions with the same token create **one** account; the other gets this (or a 409) |
| `413 FILE_TOO_LARGE` | an image is over 2 MB |
| `400 VALIDATION_ERROR` | a field breaks a rule above (`details: [{ path, message }]`), or the upload itself is malformed: an unknown file field or too many files (`details: { field, reason }`) |
| `400 MISSING_FILE` | one of the 3 images is missing. `details: { field }` |
| `415 UNSUPPORTED_FILE_TYPE` | not JPEG/PNG/WebP (e.g. an iPhone HEIC photo or a renamed `.txt`), damaged, or over 50 megapixels |
| `409 PHONE_TAKEN` / `409 NID_TAKEN` | already registered (also caught if another sign-up wins a race) |
| `502 UPLOAD_FAILED` | the photos couldn't be stored. Nothing was saved and the token is still valid, so **retrying with the same token is safe** |

---

## Sessions

### `POST /auth/login`

**Auth:** none. **Rate limit:** 10 / 15 min.

```json
{ "phone": "01700000000", "pin": "48213" }
```

**200**, plus a new `pp_rt` cookie (a new session)

```json
{ "success": true, "data": { "user": { "…PublicUser…": "" }, "accessToken": "eyJhbGciOiJIUzI1NiIs…" } }
```

`PENDING_KYC` and `REJECTED` users can log in (to see their status); `FROZEN` users can't.

| Error | When |
|---|---|
| `400 VALIDATION_ERROR` | bad phone, or the PIN isn't 5 digits |
| `401 INVALID_CREDENTIALS` | unknown phone or wrong PIN (same message for both). For a wrong PIN, `details: { attemptsLeft }` |
| `423 ACCOUNT_LOCKED` | 3 wrong PINs lock the account for 30 minutes, **even for the right PIN**. `details: { lockedUntil }` (ISO time) |
| `403 ACCOUNT_FROZEN` | right PIN, but an admin froze the account |
| `429 RATE_LIMITED` | more than 10 logins in 15 minutes from this IP |

### `POST /auth/refresh`

Swaps the refresh cookie for a new one (rotation) and returns a new access token. Call it when
an API call returns `401 UNAUTHENTICATED`, or on app start. **Auth:** the `pp_rt` cookie (no body).

**200**, plus a new `pp_rt` cookie (the old one stops working)

```json
{ "success": true, "data": { "user": { "…PublicUser…": "" }, "accessToken": "eyJhbGciOiJIUzI1NiIs…" } }
```

| Error | When | Cookie |
|---|---|---|
| `409 REFRESH_IN_PROGRESS` | another refresh with the same cookie (e.g. a second tab) won a moment ago | **left alone**: the winner already set the new cookie. **Retry the refresh once**; it will use the new cookie |
| `401 REFRESH_TOKEN_INVALID` | no cookie, unknown, expired (7 days), logged out, or reused (below) | **cleared** |
| `403 ACCOUNT_FROZEN` | the account was frozen since login | **cleared** |

**Reuse detection.** Each refresh token works once. Presenting one that was already rotated
means someone kept a copy, so the server revokes **every** token in that session, including
the newest, and the user has to log in again. A 10-second grace window keeps this from firing
on a normal race: a rotated token presented within 10 s of its rotation gets
`409 REFRESH_IN_PROGRESS` instead, and nothing is revoked.

**Client rule:** let only one refresh run at a time; on `409` retry once; on any other refresh
error, go to the login screen.

### `POST /auth/logout`

Ends this session. **Auth:** the `pp_rt` cookie (optional).

**204** (no body). The refresh token is revoked and the cookie cleared. Calling it with no or
an unknown cookie also returns 204. The access token stays valid until it expires (15 min),
so the client drops it from memory.

### `GET /me`

The signed-in user. **Auth:** `Authorization: Bearer <accessToken>`.

**200**

```json
{ "success": true, "data": { "user": { "…PublicUser…": "" } } }
```

| Error | When |
|---|---|
| `401 UNAUTHENTICATED` | missing, expired or invalid access token (a registration token counts as invalid) |

---

## Error codes

Every code the auth endpoints return:

| Code | HTTP | Details | Retry? |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | `[{ path, message }]`, or `{ field, reason }` for a malformed upload | fix the input |
| `PHONE_TAKEN` | 409 | | no: log in instead |
| `NID_TAKEN` | 409 | | no |
| `OTP_COOLDOWN` | 429 | `{ retryAfterSeconds }` | after the wait |
| `OTP_INVALID` | 400 | `{ attemptsLeft }` | with the right code |
| `OTP_EXPIRED` | 400 | | request a new code |
| `OTP_LOCKED` | 429 | | request a new code |
| `OTP_SEND_FAILED` | 502 | | **yes, immediately** (nothing was kept, no cooldown) |
| `REGISTRATION_TOKEN_INVALID` | 401 | | restart from step 1 |
| `MISSING_FILE` | 400 | `{ field }` | add the file |
| `UPLOAD_FAILED` | 502 | | **yes, with the same token** (nothing was saved) |
| `FILE_TOO_LARGE` | 413 | | with a smaller image |
| `UNSUPPORTED_FILE_TYPE` | 415 | | with a JPEG, PNG or WebP |
| `INVALID_CREDENTIALS` | 401 | `{ attemptsLeft }` for a wrong PIN | with the right PIN |
| `ACCOUNT_LOCKED` | 423 | `{ lockedUntil }` | after `lockedUntil` |
| `ACCOUNT_FROZEN` | 403 | | no: contact support |
| `UNAUTHENTICATED` | 401 | | refresh, then retry |
| `FORBIDDEN` | 403 | | no |
| `REFRESH_TOKEN_INVALID` | 401 | | no: log in again |
| `REFRESH_IN_PROGRESS` | 409 | | **yes, once** (with the new cookie) |
| `RATE_LIMITED` | 429 | | later (see the `RateLimit` header) |

Codes any endpoint can return:

| Code | HTTP | When |
|---|---|---|
| `INVALID_JSON` | 400 | the JSON body doesn't parse |
| `PAYLOAD_TOO_LARGE` | 413 | a JSON body over 100 KB |
| `NOT_FOUND` | 404 | unknown route |
| `INTERNAL_ERROR` | 500 | a server bug; the message is generic in production |

---

## Coming next

Planned in [design.md §9](design.md#9-api-v1), not implemented yet:

| Group | Endpoints | Phase |
|---|---|---|
| Account | `PATCH /auth/pin` (change PIN), `PUT /me/photo` (replace profile photo) | 6 (with the Profile screen) |
| Wallet | `GET /wallets/lookup?phone=` | 4–5 |
| Transactions | `POST /transactions/preview`, `/send-money`, `/cash-out`, `/payment`, `/cash-in`; `GET /transactions`, `GET /transactions/:trxId` | 5 |
| KYC | `GET /kyc`, `POST /kyc/resubmit` | 7 |
| Admin | `/admin/stats`, `/admin/users`, `/admin/kyc`, `/admin/transactions`, `/admin/agents/:id/float`, `/admin/fees`, `/admin/limits`, `/admin/reconcile`, `/admin/audit-logs` | 7 |
