import { z } from 'zod';
import { KycStatus, Role, UserStatus } from '../../generated/prisma/enums';
import { toAsciiDigits } from '../../utils/digits';
import { historyQuery } from '../transactions/transactions.schemas';

export const idParams = z.object({ id: z.uuid() });

/** `cursor` is the `nextCursor` (an id) of the previous page. */
const page = {
  cursor: z.uuid('cursor must be the nextCursor of an earlier page').optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

/** Why an admin rejected or froze: shown to admins and, for KYC, to the user. */
export const reasonSchema = z.string().trim().min(5).max(200);

/** GET /admin/kyc */
export const kycListQuery = z.object({ status: z.enum(KycStatus).default('PENDING'), ...page });
export type KycListQuery = z.infer<typeof kycListQuery>;

/** GET /admin/users. `q`: a phone prefix, part of a name, or a full 10-digit NID. */
export const usersListQuery = z.object({
  q: z.string().trim().min(1).max(60).transform(toAsciiDigits).optional(),
  role: z.enum(Role).optional(),
  status: z.enum(UserStatus).optional(),
  ...page,
});
export type UsersListQuery = z.infer<typeof usersListQuery>;

/** PATCH /admin/users/:id/status. Approval is not here: it only happens through KYC review. */
export const userStatusBody = z.object({ action: z.enum(['FREEZE', 'UNFREEZE']), reason: reasonSchema });
export type UserStatusBody = z.infer<typeof userStatusBody>;

/** GET /admin/audit-logs. `from`/`to` are inclusive Dhaka days, as in history. */
export const auditListQuery = z.object({
  actorId: z.uuid().optional(),
  targetId: z.uuid().optional(),
  action: z.string().regex(/^[A-Z_]{1,40}$/, 'action is an audit action name, e.g. USER_FROZEN').optional(),
  from: historyQuery.shape.from,
  to: historyQuery.shape.to,
  ...page,
});
export type AuditListQuery = z.infer<typeof auditListQuery>;

/** PATCH /admin/kyc/:id */
export const kycReviewBody = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVE') }),
  z.object({ decision: z.literal('REJECT'), reason: reasonSchema }),
]);
export type KycReviewBody = z.infer<typeof kycReviewBody>;
