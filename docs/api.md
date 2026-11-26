# PocketPay API (v1)

Auth, registration and sessions; change PIN and profile photo; wallets, money flows, history and receipts.

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

**Rate limits** (`RateLimit` / `RateLimit-Policy` headers, draft-8):

| Endpoint | Limit | Counted per |
|---|---|---|
| `POST /auth/register/request-otp` | 5 per 15 minutes | client IP |
| `POST /auth/login` | 10 per 15 minutes | client IP |
| `PATCH /auth/pin` | 5 per 15 minutes | **user** |
| the 4 money POSTs + `POST /transactions/preview` | 30 per minute, one budget for all five | **user** |
| `GET /wallets/lookup` | 30 per minute | **user** |

The PIN-change, money and lookup limits count per signed-in user, not per IP: on Bangladeshi mobile
networks many phones share one IP (CGNAT).

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
- `status`: `PENDING_KYC` · `ACTIVE` · `FROZEN` · `REJECTED`. Only `ACTIVE` accounts can send or
  receive money.
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
| `nidFront`, `nidBack`, `selfie` | files: JPEG, PNG or WebP (checked by content, not file name), max 10 MB each |

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
| `413 FILE_TOO_LARGE` | an image is over 10 MB |
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

The signed-in user and their wallet. **Auth:** `Authorization: Bearer <accessToken>`.

**200**

```json
{
  "success": true,
  "data": {
    "user": { "…PublicUser…": "" },
    "wallet": { "id": "0b6e4c1a-9d2f-4e3b-8a7c-5f1e2d3c4b5a", "type": "CUSTOMER", "balance": "1000000" }
  }
}
```

- `wallet.balance` is **poisha as a string**: `"1000000"` is ৳10,000.00. Money is always a
  string in JSON, because JavaScript numbers can't hold every amount exactly.
- `wallet.type`: `CUSTOMER` · `AGENT` · `MERCHANT` (the same as the user's role).
- `wallet` is `null` for admins, who have no wallet.

Login, refresh and registration responses don't include the wallet.

| Error | When |
|---|---|
| `401 UNAUTHENTICATED` | missing, expired or invalid access token (a registration token counts as invalid) |

---

## Account

### `PATCH /auth/pin`

Changes the PIN. **Auth:** `Authorization: Bearer <accessToken>`, plus the `pp_rt` cookie,
which the browser sends here on its own. **Rate limit:** 5 / 15 min per user.

```json
{ "currentPin": "48213", "newPin": "73915" }
```

| Field | Rules |
|---|---|
| `currentPin` | 5 digits; checked against the stored PIN under the **same 3-strike lockout as login and money** |
| `newPin` | 5 digits; not one digit repeated (`11111`) and not a run (`12345`, `54321`); different from the current PIN |

**204** (no body). **Every other session of the user is logged out** (their refresh tokens are
revoked, so their next refresh gets `401 REFRESH_TOKEN_INVALID`). The caller's own session,
identified by the `pp_rt` cookie, keeps working. With no cookie, every session ends. Other
devices' access tokens stay valid until they expire (15 min).

| Error | When |
|---|---|
| `400 VALIDATION_ERROR` | a PIN isn't 5 digits, or the new PIN is weak (`details: [{ path, message }]`) |
| `401 UNAUTHENTICATED` | missing, expired or invalid access token |
| `403 INVALID_PIN` | wrong current PIN. `details: { attemptsLeft }`. This counts toward the lockout shared with login and money |
| `423 ACCOUNT_LOCKED` | 3 wrong PINs (here, at login or on a money request) lock the account for 30 minutes, **even for the right PIN**. `details: { lockedUntil }` |
| `422 PIN_UNCHANGED` | the new PIN is the same as the current one. Nothing changed and no session was logged out |
| `429 RATE_LIMITED` | more than 5 changes in 15 minutes |

### `PUT /me/photo`

Replaces the public profile photo. **Auth:** `Authorization: Bearer <accessToken>`, checked
**before** the upload is read. **Body:** `multipart/form-data` with one file field, `photo`:
JPEG, PNG or WebP (checked by content, not file name), max 10 MB.

```bash
curl -X PUT http://localhost:4000/api/v1/me/photo \
  -H "Authorization: Bearer $ACCESS_TOKEN" -F photo=@me.jpg
```

**200**

```json
{ "success": true, "data": { "user": { "…PublicUser…": "", "profilePhotoUrl": "https://…/profile/….webp" } } }
```

The photo is turned upright, re-encoded to a 512×512 WebP with EXIF/GPS stripped, and stored
publicly at a **new URL** (so caches never show the old one). The old photo is deleted. The
private NID and selfie images are never changed.

| Error | When |
|---|---|
| `401 UNAUTHENTICATED` | missing, expired or invalid access token |
| `400 MISSING_FILE` | no `photo` file. `details: { field: "photo" }` |
| `400 VALIDATION_ERROR` | malformed upload: another file field, more than one file, or a text field (`details: { field, reason }`) |
| `413 FILE_TOO_LARGE` | over 10 MB |
| `415 UNSUPPORTED_FILE_TYPE` | not JPEG/PNG/WebP (e.g. a PDF renamed `.jpg`), damaged, or over 50 megapixels |
| `502 UPLOAD_FAILED` | the photo couldn't be stored. Nothing changed; retrying is safe |

---

## Money

All endpoints below need `Authorization: Bearer <accessToken>`. Examples use the
[demo accounts](../README.md#demo-accounts): Rahim (`01800000002`, ৳10,000), Karim (`01800000003`),
Demo Agent (`01800000004`), Demo Store (`01800000005`).

**Money is poisha as a string**, in requests and responses: `"50000"` is ৳500.00. A request
`amount` is 1–15 digits and > 0; `"15.50"`, `500` (a number) or `"-5"` → `400 VALIDATION_ERROR`.

**People are shown masked** (`"Karim H***"`), merchants by their **shop name**, and system
wallets as `PocketPay`. A response never contains a full name, an NID or a PIN hash. A **party**:

```json
{ "name": "Karim H***", "phone": "01800000003", "role": "CUSTOMER" }
```

`role` is `CUSTOMER` · `AGENT` · `MERCHANT`, or `SYSTEM` (then `phone` is `null`).

### The 4 money POSTs

| Endpoint | Who may call it | Receiver | Fee (seed) | Who pays it |
|---|---|---|---|---|
| `POST /transactions/send-money` | CUSTOMER | a CUSTOMER | ৳5 above ৳100 | sender |
| `POST /transactions/cash-out` | CUSTOMER | an AGENT | 1.85% (agent gets 0.40% of it) | sender |
| `POST /transactions/payment` | CUSTOMER | a MERCHANT | 0 (configurable) | **merchant**: deducted from its credit |
| `POST /transactions/cash-in` | AGENT | a CUSTOMER | 0 | sender |

**Headers:** `Authorization: Bearer <accessToken>` and **`Idempotency-Key: <UUID>`**.
**Rate limit:** 30 / min per user (shared with preview).

The `Idempotency-Key` is a new UUID for each transaction the user confirms. Sending the same
request again with the same key (a double tap, a timeout, a retry) **doesn't pay twice**: it
returns the original transaction with `200` and `replayed: true`. The same key with a
different amount, type or receiver → `409 IDEMPOTENCY_KEY_REUSED`.

**Body**

| Field | Rules |
|---|---|
| `receiverPhone` | `01XXXXXXXXX` (Bangla digits accepted) |
| `amount` | poisha as a digit string, > 0 |
| `pin` | the user's 5-digit PIN (Bangla digits accepted) |
| `note` | optional, trimmed, 1–50 characters |

```bash
curl -s -X POST $API/transactions/send-money \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: 3f8b6c2e-1d4a-4b7e-9c3f-2a1b0c9d8e7f" \
  -d '{"receiverPhone":"01800000003","amount":"50000","pin":"48213","note":"rent"}'
```

**201** a new transaction · **200** the same key again (`"replayed": true`, same receipt)

```json
{
  "success": true,
  "data": {
    "replayed": false,
    "receipt": {
      "trxId": "PP7K2M9QXA",
      "type": "SEND_MONEY",
      "status": "COMPLETED",
      "amount": "50000",
      "fee": "500",
      "note": "rent",
      "createdAt": "2026-11-25T04:12:09.512Z",
      "from": { "name": "Rahim U***", "phone": "01800000002", "role": "CUSTOMER" },
      "to": { "name": "Karim H***", "phone": "01800000003", "role": "CUSTOMER" },
      "mine": { "amount": "-50500", "balanceAfter": "949500" }
    }
  }
}
```

- `amount` is what the receiver is sent; `fee` is the whole fee (on a Cash Out it includes the
  agent's commission).
- `mine` is the **caller's own** ledger entry: signed (`-` out, `+` in) and the balance after it.
  On a Cash Out of ৳1,000 the customer's `mine.amount` is `"-101850"`; on a ৳250 payment with a
  1% merchant fee, the merchant would see `"24750"`.

**Order of checks.** The receiver and the amount are checked **before** the PIN, so a typo in
the phone or the amount never costs a PIN attempt:

1. body and `Idempotency-Key` → `400 VALIDATION_ERROR`, `400 IDEMPOTENCY_KEY_REQUIRED`
2. the caller: role → `403 FORBIDDEN`; status → `403 ACCOUNT_NOT_ACTIVE`
3. the receiver → `404 RECEIVER_NOT_FOUND`, `422 CANNOT_SEND_TO_SELF`, `422 INVALID_RECEIVER`, `422 RECEIVER_NOT_ACTIVE`
4. the amount → `422 AMOUNT_BELOW_MINIMUM`, `422 AMOUNT_ABOVE_MAXIMUM`
5. the PIN → `403 INVALID_PIN`, `423 ACCOUNT_LOCKED` (the same 3-strike lockout as login)
6. under the wallet locks, in this order → `422 INSUFFICIENT_BALANCE` (the sender's own balance,
   first: a sender who can't pay learns nothing about the receiver), `403 ACCOUNT_NOT_ACTIVE` /
   `422 RECEIVER_NOT_ACTIVE` (a freeze since step 2), `422 LIMIT_EXCEEDED` (the caller's own
   limit) or `422 RECEIVER_LIMIT_EXCEEDED` (a Cash In customer's limit), `422 RECEIVER_BALANCE_LIMIT`

A replay runs steps 1–5 again, then returns the original transaction (step 6 is skipped). So a
replay after the receiver was frozen gets `422 RECEIVER_NOT_ACTIVE` rather than the receipt.

### `POST /transactions/preview`

The fee and total before the PIN screen. Runs checks 1–4 above (without the `Idempotency-Key`),
then, without locking anything: the sender's balance, both accounts' status and the limits.
It does **not** check the receiver's balance cap: an answer about the cap would tell anyone the
receiver's balance, so only the real POST checks it. **Who:** CUSTOMER or AGENT (for the flows
their role can start). **Rate limit:** shared with the money POSTs. **No `Idempotency-Key`**:
nothing is written.

```json
{ "type": "SEND_MONEY", "receiverPhone": "01800000003", "amount": "50000" }
```

`type`: `SEND_MONEY` · `CASH_OUT` · `PAYMENT` · `CASH_IN`.

**200**

```json
{
  "success": true,
  "data": {
    "type": "SEND_MONEY",
    "amount": "50000",
    "fee": "500",
    "total": "50500",
    "receiver": { "name": "Karim H***", "phone": "01800000003", "role": "CUSTOMER" }
  }
}
```

`total` is what leaves the sender's wallet (on a Payment it equals `amount`: the merchant pays
the fee). A preview is informative only: a parallel request can still change the outcome, and
only the money POST's own checks are binding.

Errors: the same as the money POSTs, except the PIN, `Idempotency-Key` and replay ones,
`RECEIVER_BALANCE_LIMIT` and `RECEIVER_LIMIT_EXCEEDED`. A preview only checks things about the
caller: an answer about the receiver (their balance under the cap, a Cash In customer's limits)
would let anyone probe it. So a preview can pass and the POST still be refused by those two. A
`type` the caller's role can't start (an agent previewing `SEND_MONEY`) → `403 FORBIDDEN`.

### `GET /wallets/lookup?phone=`

Who is behind a phone number, before sending to it. **Who:** an `ACTIVE` CUSTOMER or AGENT (an
account still in KYC, or rejected, can't enumerate who is on PocketPay).
**Rate limit:** 30 / min per user (slows down phone-number enumeration).

```bash
curl -s "$API/wallets/lookup?phone=01800000003" -H "Authorization: Bearer $TOKEN"
```

**200**: only the name and role; the caller already has the phone.

```json
{ "success": true, "data": { "name": "Karim H***", "role": "CUSTOMER" } }
```

A merchant → `{ "name": "Demo Store", "role": "MERCHANT" }` (its shop name).

| Error | When |
|---|---|
| `400 VALIDATION_ERROR` | `phone` missing or not `01XXXXXXXXX` |
| `404 RECEIVER_NOT_FOUND` | no account with this phone, **or an admin's phone** (answered the same) |
| `403 FORBIDDEN` | the caller is a merchant or an admin |
| `403 ACCOUNT_NOT_ACTIVE` | the caller isn't `ACTIVE` (`PENDING_KYC`, `REJECTED`, `FROZEN`). `details: { status }` |

### `GET /transactions`

The caller's own history, newest first. **Who:** any signed-in user (an admin, who has no
wallet, gets an empty list).

| Query | Rules |
|---|---|
| `type` | optional: `SEND_MONEY` · `CASH_IN` · `CASH_OUT` · `PAYMENT` · `FLOAT_TOPUP` |
| `from`, `to` | optional `YYYY-MM-DD` dates in **Asia/Dhaka**, both **inclusive** |
| `cursor` | optional: the `nextCursor` of the previous page |
| `limit` | 1–50, default 20 |

```bash
curl -s "$API/transactions?limit=2" -H "Authorization: Bearer $TOKEN"
```

**200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "trxId": "PP7K2M9QXA",
        "type": "SEND_MONEY",
        "direction": "OUT",
        "amount": "50500",
        "counterparty": { "name": "Karim H***", "phone": "01800000003", "role": "CUSTOMER" },
        "balanceAfter": "949500",
        "createdAt": "2026-11-25T04:12:09.512Z"
      },
      {
        "trxId": "PPM3W8R2NE",
        "type": "CASH_IN",
        "direction": "IN",
        "amount": "1000000",
        "counterparty": { "name": "Demo A***", "phone": "01800000004", "role": "AGENT" },
        "balanceAfter": "1000000",
        "createdAt": "2026-11-24T10:03:41.118Z"
      }
    ],
    "nextCursor": "17"
  }
}
```

- `amount` is what **the caller's** balance changed by (no sign; `direction` says which way). The
  sender of ৳500 sees `"50500"` (with the fee), the receiver `"50000"`.
- `counterparty` is the other side: for the sender, the receiver; for anyone credited, the
  sender. A float top-up comes from `{ "name": "PocketPay", "phone": null, "role": "SYSTEM" }`.
- **Next page:** pass `nextCursor` back as `cursor`. It is `null` on the last page. Pages are cut
  on the ledger order, so a transaction made while paging never shifts, repeats or skips items.

| Error | When |
|---|---|
| `400 VALIDATION_ERROR` | a bad `type`, `cursor`, `limit` or date (`2026-02-30`, `24-11-2026`) |

### `GET /transactions/:trxId`

One receipt, as the caller sees it (the same shape as `data.receipt` above; `mine` is the
caller's own entry). **Who:** a user whose wallet is part of the transaction.

```bash
curl -s $API/transactions/PP7K2M9QXA -H "Authorization: Bearer $TOKEN"
```

| Error | When |
|---|---|
| `400 VALIDATION_ERROR` | not a trxId (`PP` + 8 of `ABCDEFGHJKMNPQRSTUVWXYZ23456789`) |
| `404 TRANSACTION_NOT_FOUND` | no such transaction, **or the caller's wallet isn't in it**: the answer is the same, so nobody can probe other people's trxIds |

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
| `INVALID_PIN` | 403 | `{ attemptsLeft }` | `PATCH /auth/pin`: with the right current PIN |
| `PIN_UNCHANGED` | 422 | | `PATCH /auth/pin`: with a different new PIN |
| `ACCOUNT_FROZEN` | 403 | | no: contact support |
| `UNAUTHENTICATED` | 401 | | refresh, then retry |
| `FORBIDDEN` | 403 | | no |
| `REFRESH_TOKEN_INVALID` | 401 | | no: log in again |
| `REFRESH_IN_PROGRESS` | 409 | | **yes, once** (with the new cookie) |
| `RATE_LIMITED` | 429 | | later (see the `RateLimit` header) |

Money codes (the money POSTs, preview, lookup, history and receipts). The auth codes above that
also appear here mean the same: `ACCOUNT_LOCKED` (423, shared lockout with login), `FORBIDDEN`,
`UNAUTHENTICATED`, `VALIDATION_ERROR`, `RATE_LIMITED`.

| Code | HTTP | Details | Retry? |
|---|---|---|---|
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | | add an `Idempotency-Key` header with a UUID |
| `ACCOUNT_NOT_ACTIVE` | 403 | `{ status }` (`PENDING_KYC`, `FROZEN`, `REJECTED`) | no: wait for KYC approval or contact support |
| `INVALID_PIN` | 403 | `{ attemptsLeft }` | with the right PIN (3 wrong PINs → `ACCOUNT_LOCKED`) |
| `RECEIVER_NOT_FOUND` | 404 | | with the right phone |
| `CANNOT_SEND_TO_SELF` | 422 | | no |
| `INVALID_RECEIVER` | 422 | `{ expectedRole }` | to an account of that role |
| `RECEIVER_NOT_ACTIVE` | 422 | | no: the receiver can't take money right now |
| `AMOUNT_BELOW_MINIMUM` | 422 | `{ min }` (poisha) | with a larger amount. Also: a payment whose merchant fee would be ≥ the amount |
| `AMOUNT_ABOVE_MAXIMUM` | 422 | `{ max }` (poisha) | with a smaller amount |
| `LIMIT_EXCEEDED` | 422 | the caller's own limit: `{ period: "DAY"\|"MONTH", kind: "COUNT"\|"AMOUNT", limit, used }`, all strings (poisha for `AMOUNT`) | tomorrow / next month (Asia/Dhaka), or a smaller amount |
| `RECEIVER_LIMIT_EXCEEDED` | 422 | none: the customer's totals aren't the caller's business | no: the receiving customer's own Cash In limit (day or month) is used up |
| `RECEIVER_BALANCE_LIMIT` | 422 | | no: the receiving customer would go over ৳5,00,000 |
| `INSUFFICIENT_BALANCE` | 422 | | no: the wallet doesn't have enough money (amount + fee) |
| `IDEMPOTENCY_KEY_REUSED` | 409 | | no: the key was already used for a different transaction (type, amount or receiver). Use a new key for a new transaction |
| `TRANSACTION_NOT_FOUND` | 404 | | no |
| `WALLET_NOT_FOUND` | 404 | | no (an internal ledger check; not expected from these endpoints) |

Admin and file codes (`/admin/*` and `/files/private/*`). `FORBIDDEN` (not an admin),
`UNAUTHENTICATED`, `VALIDATION_ERROR` and `RATE_LIMITED` (120 a minute per admin) mean the same as above.

| Code | HTTP | Details | Retry? |
|---|---|---|---|
| `LINK_EXPIRED_OR_INVALID` | 403 | | no: reload the KYC page for fresh links (they last 5 minutes) |
| `KYC_NOT_FOUND` | 404 | | no |
| `KYC_ALREADY_REVIEWED` | 409 | | no: another admin decided first. Reload |
| `KYC_NOT_LATEST` | 409 | | no: the user sent a newer submission. Review that one |
| `USER_STATUS_CHANGED` | 409 | `{ status }` (the user's status now) | no: reload. Also: freeze from anything but `ACTIVE`, unfreeze from anything but `FROZEN` |
| `USER_NOT_FOUND` | 404 | | no |
| `CANNOT_MODIFY_ADMIN` | 422 | | no: admins can't act on admin accounts, their own included |

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
| KYC | `GET /kyc`, `POST /kyc/resubmit` | 7 |
| Admin | `/admin/stats`, `/admin/transactions`, `/admin/agents/:id/float`, `/admin/fees`, `/admin/limits`, `/admin/reconcile` (`/admin/kyc`, `/admin/users` and `/admin/audit-logs` are built in 7a; documented here in Task 8) | 7b |
