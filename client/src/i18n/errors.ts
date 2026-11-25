import type { TFunction } from 'i18next'
import { ApiError } from '../api/client'

/** Every code in docs/api.md's error tables, plus the client's own NETWORK_ERROR. i18n.test.ts checks both. */
export const ERROR_CODES = [
  // auth
  'VALIDATION_ERROR',
  'PHONE_TAKEN',
  'NID_TAKEN',
  'OTP_COOLDOWN',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_LOCKED',
  'OTP_SEND_FAILED',
  'REGISTRATION_TOKEN_INVALID',
  'MISSING_FILE',
  'UPLOAD_FAILED',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'INVALID_PIN',
  'PIN_UNCHANGED',
  'ACCOUNT_FROZEN',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_IN_PROGRESS',
  'RATE_LIMITED',
  // money
  'IDEMPOTENCY_KEY_REQUIRED',
  'ACCOUNT_NOT_ACTIVE',
  'RECEIVER_NOT_FOUND',
  'CANNOT_SEND_TO_SELF',
  'INVALID_RECEIVER',
  'RECEIVER_NOT_ACTIVE',
  'AMOUNT_BELOW_MINIMUM',
  'AMOUNT_ABOVE_MAXIMUM',
  'LIMIT_EXCEEDED',
  'RECEIVER_LIMIT_EXCEEDED',
  'RECEIVER_BALANCE_LIMIT',
  'INSUFFICIENT_BALANCE',
  'IDEMPOTENCY_KEY_REUSED',
  'TRANSACTION_NOT_FOUND',
  'WALLET_NOT_FOUND',
  // any endpoint
  'INVALID_JSON',
  'PAYLOAD_TOO_LARGE',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  // client only (no response at all)
  'NETWORK_ERROR',
] as const

const KNOWN = new Set<string>(ERROR_CODES)

/** The translated text for a failed call. Never the server's `message`: an unknown code or a non-ApiError is GENERIC. */
export function errorMessage(t: TFunction, err: unknown): string {
  return t(err instanceof ApiError && KNOWN.has(err.code) ? `errors.${err.code}` : 'errors.GENERIC')
}
