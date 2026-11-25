// Client copies of the server's input rules (server/src/modules/auth/auth.schemas.ts). Messages are i18n keys.
import { z } from 'zod'
import { dhakaToday, isCalendarDate, yearsBefore } from './dates'
import { toAsciiDigits } from './digits'

/** Bangla digits → ASCII, then the regex. Input and output are both strings. */
const digits = (re: RegExp, message: string) =>
  z
    .string()
    .transform((s) => toAsciiDigits(s.trim()))
    .pipe(z.string().regex(re, message))

export const phoneSchema = digits(/^01[3-9]\d{8}$/, 'validation.phone')
export const otpSchema = digits(/^\d{6}$/, 'validation.otp')
export const nidSchema = digits(/^\d{10}$/, 'validation.nid')

/** An existing PIN (login, confirm). PinInput already hands over ASCII digits. */
export const pinSchema = z.string().regex(/^\d{5}$/, 'validation.pin')

/** 11111, 12345, 54321 and the like: refused by the server for a new PIN. */
export function isWeakPin(pin: string): boolean {
  return /^(\d)\1{4}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)
}

/** A new PIN (registration, change PIN): 5 digits and not weak. */
export const newPinSchema = pinSchema.refine((pin) => !isWeakPin(pin), 'validation.pinWeak')

/** `YYYY-MM-DD`, a real date, 1900 or later, and 18+ by today's date in Dhaka. */
export const dobSchema = z
  .string()
  .refine(isCalendarDate, 'validation.dob')
  .refine((dob) => dob >= '1900-01-01', 'validation.dob')
  .refine((dob) => dob <= yearsBefore(dhakaToday(), 18), 'validation.under18')
