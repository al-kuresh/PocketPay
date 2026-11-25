import { z } from 'zod';
import { poishaSchema } from '../../utils/money';
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

export const previewBody = z.object({
  type: z.enum(['SEND_MONEY', 'CASH_IN', 'CASH_OUT', 'PAYMENT']) satisfies z.ZodType<FlowType>,
  receiverPhone: phoneSchema,
  amount: poishaSchema,
});
