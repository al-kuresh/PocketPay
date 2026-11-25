import { z } from 'zod';
import { TransactionType } from '../../generated/prisma/enums';
import { poishaSchema } from '../../utils/money';
import { isCalendarDate } from '../../utils/time';
import { TRX_ID_PATTERN } from '../../utils/trxId';
import { loginBody, phoneSchema } from '../auth/auth.schemas';
import type { FlowType } from './flows';

// The login PIN format: 5 digits, Bangla digits converted, no strength rules (it's checked
// against the hash, not judged).
const pin = loginBody.shape.pin;

/** The body of the 4 money POSTs. The flow comes from the path. */
export const transferBody = z.object({
  receiverPhone: phoneSchema,
  amount: poishaSchema,
  pin,
  note: z.string().trim().min(1).max(50).optional(),
});

/** A Dhaka calendar date, `YYYY-MM-DD`. */
const dhakaDate = z.string().refine(isCalendarDate, 'Must be a real date in the format YYYY-MM-DD');

/** GET /transactions. `from` and `to` are inclusive Dhaka days; `cursor` is a ledger seq. */
export const historyQuery = z.object({
  type: z.enum(TransactionType).optional(),
  from: dhakaDate.optional(),
  to: dhakaDate.optional(),
  // ≤ 18 digits always fits in Postgres BIGINT (seq).
  cursor: z
    .string()
    .regex(/^\d{1,18}$/, 'cursor must be the nextCursor of an earlier page')
    .transform(BigInt)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type HistoryQuery = z.infer<typeof historyQuery>;

export const trxIdParams = z.object({
  trxId: z.string().regex(TRX_ID_PATTERN, 'Not a PocketPay transaction id'),
});

export const previewBody = z.object({
  type: z.enum(['SEND_MONEY', 'CASH_IN', 'CASH_OUT', 'PAYMENT']) satisfies z.ZodType<FlowType>,
  receiverPhone: phoneSchema,
  amount: poishaSchema,
});
