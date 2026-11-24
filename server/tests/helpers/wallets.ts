import { randomUUID } from 'node:crypto';
import type { Role } from '../../src/generated/prisma/enums';
import { prisma } from '../../src/lib/prisma';
import { postTransaction } from '../../src/modules/ledger/ledger.service';
import type { PostTransactionInput } from '../../src/modules/ledger/ledger.types';

export async function createSystemWallets() {
  const fees = await prisma.wallet.create({ data: { type: 'SYSTEM_FEES' } });
  const float = await prisma.wallet.create({ data: { type: 'SYSTEM_FLOAT' } });
  return { fees, float };
}

/** Admins have no wallet, so they can't be created here. */
export async function createUserWithWallet(opts: {
  phone: string;
  nid: string;
  role?: Exclude<Role, 'ADMIN'>;
}) {
  const role = opts.role ?? 'CUSTOMER';
  const user = await prisma.user.create({
    data: {
      phone: opts.phone,
      nidNumber: opts.nid,
      name: 'Test User',
      dateOfBirth: new Date('1995-06-15'),
      pinHash: 'not-a-real-hash',
      role,
    },
  });
  const wallet = await prisma.wallet.create({ data: { userId: user.id, type: role } });
  return { user, wallet };
}

/** A plain two-wallet SEND_MONEY input with a fresh idempotency key; `extra` overrides any field. */
export function transfer(
  fromWalletId: string,
  toWalletId: string,
  amount: bigint,
  initiatedById: string,
  extra: Partial<PostTransactionInput> = {},
): PostTransactionInput {
  return {
    type: 'SEND_MONEY',
    amount,
    fee: 0n,
    fromWalletId,
    toWalletId,
    postings: [
      { walletId: fromWalletId, amount: -amount },
      { walletId: toWalletId, amount },
    ],
    initiatedById,
    idempotencyKey: randomUUID(),
    ...extra,
  };
}

/** Puts money into a wallet the real way: a FLOAT_TOPUP from SYSTEM_FLOAT through the ledger. */
export async function fund(walletId: string, amount: bigint, initiatedById: string) {
  const float = await prisma.wallet.findFirstOrThrow({ where: { type: 'SYSTEM_FLOAT' } });
  return postTransaction(
    transfer(float.id, walletId, amount, initiatedById, { type: 'FLOAT_TOPUP' }),
  );
}

export async function balanceOf(walletId: string): Promise<bigint> {
  return (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance;
}
