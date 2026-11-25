import type { LimitRule, UserStatus } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/AppError';
import { poishaToString } from '../../utils/money';
import { invalidPin, verifyPinWithLockout } from '../auth/pinLockout';
import { postTransaction } from '../ledger/ledger.service';
import type { PostTransactionInput } from '../ledger/ledger.types';
import { calculateFee } from './fees';
import { FLOWS, type FlowType } from './flows';
import { checkAmountBounds, checkBalanceCap, checkPeriodLimits } from './limits';
import {
  assertReceiver,
  findAccountByPhone,
  type Party,
  receiverNotActive,
  toParty,
} from './parties';
import { buildPostings } from './postings';
import { type PublicReceipt, toReceipt } from './receipt.presenter';
import { loadCustomerMaxBalance, loadRules } from './rules';

export interface TransferRequest {
  type: FlowType;
  initiatorId: string;
  receiverPhone: string;
  amount: bigint;
  now?: Date;
}

export interface TransferPreview {
  type: FlowType;
  amount: string;
  fee: string;
  /** What leaves the sender's wallet. */
  total: string;
  receiver: Party;
}

type Guard = NonNullable<PostTransactionInput['guard']>;

const forbidden = () => new AppError(403, 'FORBIDDEN', 'You do not have access to this');
const accountNotActive = (status: UserStatus | undefined) =>
  new AppError(403, 'ACCOUNT_NOT_ACTIVE', "Your account can't move money right now", { status });

/**
 * The checks that must hold under the ledger's wallet locks, in this order: both users still
 * ACTIVE (a freeze after the pre-checks, or under a still-valid token), the customer's period
 * limits, and the balance cap of a CUSTOMER receiver on its LOCKED balance. Every read uses `tx`.
 */
export function makeTransferGuard(a: {
  type: FlowType;
  initiatorId: string;
  receiverId: string;
  limit: LimitRule | null;
  customerWalletId: string;
  receiverWalletId: string;
  /** The business amount: what the limits count. */
  amount: bigint;
  /** What the receiver's wallet gains: what the cap checks. */
  credit: bigint;
  now: Date;
}): Guard {
  return async ({ tx, wallets }) => {
    const users = await tx.user.findMany({
      where: { id: { in: [a.initiatorId, a.receiverId] } },
      select: { id: true, status: true },
    });
    const statusOf = (id: string) => users.find((u) => u.id === id)?.status;
    const initiatorStatus = statusOf(a.initiatorId);
    if (initiatorStatus !== 'ACTIVE') throw accountNotActive(initiatorStatus);
    if (statusOf(a.receiverId) !== 'ACTIVE') throw receiverNotActive();

    await checkPeriodLimits(tx, {
      type: a.type,
      limit: a.limit,
      customerWalletId: a.customerWalletId,
      side: FLOWS[a.type].limitSide,
      amount: a.amount,
      now: a.now,
    });

    const receiver = wallets.get(a.receiverWalletId)!; // present: every posting wallet is locked
    if (receiver.type === 'CUSTOMER') {
      checkBalanceCap({
        receiverType: receiver.type,
        balance: receiver.balance,
        credit: a.credit,
        cap: await loadCustomerMaxBalance(tx),
      });
    }
  };
}

/** Request-order steps 2–4 (initiator, receiver, amount and fee), then the postings and guard. */
async function prepare(req: TransferRequest) {
  const flow = FLOWS[req.type];

  const initiator = await prisma.user.findUnique({
    where: { id: req.initiatorId },
    include: { wallet: true },
  });
  // Users are never deleted, so a missing one is a forged or stale token: no access either way.
  if (!initiator?.wallet || initiator.role !== flow.initiator) throw forbidden();
  if (initiator.status !== 'ACTIVE') throw accountNotActive(initiator.status);

  // The full user row: only toParty()/toReceipt() output may leave this module.
  const receiver = await findAccountByPhone(prisma, req.receiverPhone);
  assertReceiver(req.type, initiator, receiver);

  const rules = await loadRules(prisma, req.type);
  checkAmountBounds(rules.limit, req.amount);
  const { fee, commission } = calculateFee(rules.fee, req.amount);
  // A receiver-paid fee comes out of the amount: the merchant must still get more than 0.
  if (flow.feePaidBy === 'receiver' && fee >= req.amount) {
    throw new AppError(422, 'AMOUNT_BELOW_MINIMUM', 'The amount must be more than its fee', {
      min: poishaToString(fee + 1n),
    });
  }

  const fees = await prisma.wallet.findFirstOrThrow({ where: { type: 'SYSTEM_FEES' } });
  const fromWalletId = initiator.wallet.id;
  const toWalletId = receiver.wallet.id;
  const postings = buildPostings(
    req.type,
    { fromWalletId, toWalletId, feesWalletId: fees.id },
    { amount: req.amount, fee, commission },
  );
  const postingOf = (id: string) => postings.find((p) => p.walletId === id)!.amount;

  const guard = makeTransferGuard({
    type: req.type,
    initiatorId: initiator.id,
    receiverId: receiver.id,
    limit: rules.limit,
    customerWalletId: flow.limitSide === 'from' ? fromWalletId : toWalletId,
    receiverWalletId: toWalletId,
    amount: req.amount,
    credit: postingOf(toWalletId),
    now: req.now ?? new Date(),
  });
  return {
    initiator,
    receiver,
    fee,
    postings,
    fromWalletId,
    toWalletId,
    total: -postingOf(fromWalletId),
    guard,
  };
}

/** What a transfer would cost and whether it would pass right now. Binding only in executeTransfer. */
export async function previewTransfer(req: TransferRequest): Promise<TransferPreview> {
  const p = await prepare(req);

  // The guard's checks on plain reads, without locks: a parallel request can still change them.
  const wallets = await prisma.wallet.findMany({
    where: { id: { in: p.postings.map((x) => x.walletId) } },
    select: { id: true, type: true, balance: true },
  });
  await p.guard({ tx: prisma, wallets: new Map(wallets.map((w) => [w.id, w])) });
  const sender = wallets.find((w) => w.id === p.fromWalletId)!;
  if (sender.balance < p.total) {
    throw new AppError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
  }

  return {
    type: req.type,
    amount: poishaToString(req.amount),
    fee: poishaToString(p.fee),
    total: poishaToString(p.total),
    receiver: toParty(p.receiver),
  };
}

/**
 * Moves the money. The PIN is checked only after every request check passed, so a typo in the
 * phone or amount never costs an attempt. Limits and the cap are checked again in the guard.
 */
export async function executeTransfer(
  req: TransferRequest & {
    pin: string;
    note?: string;
    idempotencyKey: string;
    meta: { ip?: string };
  },
): Promise<{ receipt: PublicReceipt; replayed: boolean }> {
  const p = await prepare(req);

  await verifyPinWithLockout(p.initiator, req.pin, {
    meta: req.meta,
    wrongPin: invalidPin,
    failedAction: 'TRANSACTION_PIN_FAILED',
  });

  // A replay returns before the guard runs, so a used-up limit can't block it.
  const { transaction, replayed } = await postTransaction({
    type: req.type,
    amount: req.amount,
    fee: p.fee,
    fromWalletId: p.fromWalletId,
    toWalletId: p.toWalletId,
    postings: p.postings,
    initiatedById: p.initiator.id,
    idempotencyKey: req.idempotencyKey,
    note: req.note,
    guard: p.guard,
  });
  const receipt = toReceipt(transaction, { from: p.initiator, to: p.receiver }, p.fromWalletId);
  return { receipt, replayed };
}
