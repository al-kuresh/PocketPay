import type { Role, User, Wallet } from '../../generated/prisma/client';
import { AppError } from '../../utils/AppError';
import { maskName } from '../../utils/mask';
import { FLOWS, type FlowType } from './flows';
import type { Db } from './rules';

/** One side of a transaction as the API shows it. */
export interface Party {
  name: string;
  phone: string | null;
  role: Role | 'SYSTEM';
}

type Account = User & { wallet: Wallet | null };

/** Also thrown by GET /wallets/lookup. */
export const receiverNotFound = () =>
  new AppError(404, 'RECEIVER_NOT_FOUND', 'No PocketPay account with this phone number');

/** Also thrown by the transfer guard, which re-reads the status inside the transaction. */
export const receiverNotActive = () =>
  new AppError(422, 'RECEIVER_NOT_ACTIVE', "This account can't receive money right now");

export function findAccountByPhone(db: Db, phone: string): Promise<Account | null> {
  return db.user.findUnique({ where: { phone }, include: { wallet: true } });
}

/** A person by their masked name; a merchant by its shop name; a system wallet (no user) as PocketPay. */
export function toParty(user: User | null): Party {
  if (!user) return { name: 'PocketPay', phone: null, role: 'SYSTEM' };
  // A shop name is a public business name, so it isn't masked.
  const name = user.role === 'MERCHANT' && user.shopName ? user.shopName : maskName(user.name);
  return { name, phone: user.phone, role: user.role };
}

/**
 * The receiver checks of a money flow, in this order: exists (an admin doesn't, to a sender),
 * not the initiator, the role the flow needs, ACTIVE.
 */
export function assertReceiver(
  flow: FlowType,
  initiator: User,
  receiver: Account | null,
): asserts receiver is User & { wallet: Wallet } {
  // An admin has no wallet; any other account without one couldn't receive either.
  if (!receiver || receiver.role === 'ADMIN' || !receiver.wallet) {
    throw receiverNotFound();
  }
  if (receiver.id === initiator.id) {
    throw new AppError(422, 'CANNOT_SEND_TO_SELF', "You can't send money to yourself");
  }
  const expectedRole = FLOWS[flow].receiver;
  if (receiver.role !== expectedRole) {
    throw new AppError(422, 'INVALID_RECEIVER', `This must be a ${expectedRole} account`, {
      expectedRole,
    });
  }
  if (receiver.status !== 'ACTIVE') throw receiverNotActive();
}
