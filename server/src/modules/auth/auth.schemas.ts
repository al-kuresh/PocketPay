import { z } from 'zod';
import { toAsciiDigits } from '../../utils/digits';
import { dhakaToday, isCalendarDate } from '../../utils/time';

/** Convert Bangla digits to ASCII before `schema` runs its regex and refine checks. */
const asciiDigits = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' ? toAsciiDigits(v) : v), schema);

export const phoneSchema = asciiDigits(
  z
    .string()
    .regex(/^01[3-9]\d{8}$/, 'Phone must be 11 digits in the format 01XXXXXXXXX (no +88, no spaces)'),
);

export const nidSchema = asciiDigits(z.string().regex(/^\d{10}$/, 'NID must be exactly 10 digits'));

const ASCENDING = '0123456789';
const DESCENDING = '9876543210';

export const pinSchema = asciiDigits(
  z
    .string()
    .regex(/^\d{5}$/, 'PIN must be exactly 5 digits')
    .refine((pin) => !/^(\d)\1{4}$/.test(pin), 'PIN cannot be the same digit repeated')
    .refine(
      (pin) => !ASCENDING.includes(pin) && !DESCENDING.includes(pin),
      'PIN cannot be a sequence like 12345 or 54321',
    ),
);

/** `YYYY-MM-DD`, minus `years` years, as a string (same month and day). */
const yearsBefore = (isoDate: string, years: number) =>
  `${String(Number(isoDate.slice(0, 4)) - years).padStart(4, '0')}${isoDate.slice(4)}`;

// Dates are compared as YYYY-MM-DD strings (lexicographic order = date order), never with
// millisecond maths, so time zones and leap years can't shift the 18th birthday.
export const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in the format YYYY-MM-DD')
  .refine(isCalendarDate, 'Date of birth is not a real date')
  .refine((dob) => dob >= '1900-01-01', 'Date of birth must be in 1900 or later')
  .refine((dob) => dob <= dhakaToday(), 'Date of birth cannot be in the future')
  .refine((dob) => dob <= yearsBefore(dhakaToday(), 18), 'You must be at least 18 years old');

export const registrationRoleSchema = z.enum(['CUSTOMER', 'AGENT', 'MERCHANT'], {
  message: 'Role must be CUSTOMER, AGENT or MERCHANT',
});

export const requestOtpBody = z.object({ phone: phoneSchema });

export const verifyOtpBody = z.object({
  phone: phoneSchema,
  code: asciiDigits(z.string().regex(/^\d{6}$/, 'Code must be 6 digits')),
});

export const completeRegistrationBody = z
  .object({
    name: z.string().trim().min(2).max(60),
    dateOfBirth: dobSchema,
    nidNumber: nidSchema,
    role: registrationRoleSchema,
    pin: pinSchema,
    confirmPin: asciiDigits(z.string()),
    shopName: z.string().trim().min(2).max(80).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.confirmPin !== body.pin) {
      ctx.addIssue({ code: 'custom', path: ['confirmPin'], message: 'PINs do not match' });
    }
    if (body.role === 'MERCHANT' && !body.shopName) {
      ctx.addIssue({
        code: 'custom',
        path: ['shopName'],
        message: 'Shop name is required for merchants',
      });
    }
  })
  // Only merchants have a shop: drop a stray shopName so it can never reach the users table.
  .transform(({ shopName, ...rest }) => (rest.role === 'MERCHANT' ? { ...rest, shopName } : rest));

// Weak-PIN rules aren't applied to an existing PIN: it is checked against its hash, not judged.
const existingPinSchema = asciiDigits(z.string().regex(/^\d{5}$/, 'PIN must be exactly 5 digits'));

export const loginBody = z.object({ phone: phoneSchema, pin: existingPinSchema });

export const changePinBody = z.object({ currentPin: existingPinSchema, newPin: pinSchema });
