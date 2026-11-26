// The seed: system wallets, the fee and limit rules from design §6.3–6.4, and the demo accounts.
// Safe to re-run: every row is create-if-missing (an existing row is left as it is, so admin
// edits to fees or limits survive a re-seed), and demo money goes through postTransaction with
// fixed idempotency keys, so a second run replays instead of paying twice. KYC documents are
// only made for a user with no submission yet.
import { randomUUID } from 'node:crypto';
import type { KycStatus, Prisma, User, Wallet } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import type { StorageProvider } from '../lib/storage';
import { hashPin } from '../modules/auth/pin';
import { postTransaction } from '../modules/ledger/ledger.service';
import type { PostTransactionInput } from '../modules/ledger/ledger.types';
import { reconcileLedger } from '../modules/ledger/reconcile';
import { taka } from '../utils/money';
import { demoKycImages } from './demoImages';

export const DEMO_PIN = '48213';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * The demo accounts have a published PIN, and one of them is an ADMIN, so they only go into a
 * local database, or one whose host is listed in DEMO_SEED_ALLOWED_HOSTS (comma-separated, exact
 * match). Checks the target database, not just NODE_ENV: a laptop with NODE_ENV unset can still
 * point DATABASE_URL at a hosted database.
 */
export function assertDemoSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Demo seeding is disabled in production; Phase 10 decides how the live demo is seeded',
    );
  }
  let host = '';
  try {
    host = new URL(env.DATABASE_URL ?? '').hostname;
  } catch {
    // Not a URL. The parse error carries the raw string (password included), so it is dropped.
  }
  if (!host) throw new Error('Demo seeding refused: DATABASE_URL has no host');
  const extra = (env.DEMO_SEED_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim());
  if (![...LOCAL_HOSTS, ...extra.filter(Boolean)].includes(host)) {
    // The hostname only: the full URL contains the database password.
    throw new Error(
      `Demo seeding only runs against a local database, not "${host}". ` +
        'To allow this host, add it to DEMO_SEED_ALLOWED_HOSTS',
    );
  }
}

const free = { flatFee: 0n, percentBp: 0, agentCommissionBp: 0, minAmountForFee: 0n };
// §6.3. Send Money: ৳5 above ৳100. Cash Out: 1.85%, of which 0.40% is the agent's commission.
const FEE_RULES: Prisma.FeeRuleCreateInput[] = [
  { type: 'SEND_MONEY', ...free, flatFee: 500n, minAmountForFee: 10_000n },
  { type: 'CASH_OUT', ...free, percentBp: 185, agentCommissionBp: 40 },
  { type: 'CASH_IN', ...free },
  { type: 'PAYMENT', ...free },
  { type: 'FLOAT_TOPUP', ...free },
];

// §6.4, in poisha. Omitted max* fields stay NULL = no limit. FLOAT_TOPUP has no row: admin-only.
const LIMIT_RULES: Prisma.LimitRuleCreateInput[] = [
  {
    type: 'SEND_MONEY',
    minAmount: taka(10),
    maxPerTxn: taka(50_000),
    maxCountDay: 100,
    maxCountMonth: 250,
    maxAmountDay: taka(50_000),
    maxAmountMonth: taka(300_000),
  },
  {
    type: 'CASH_IN',
    minAmount: taka(50),
    maxPerTxn: taka(50_000),
    maxCountDay: 100,
    maxCountMonth: 250,
    maxAmountDay: taka(50_000),
    maxAmountMonth: taka(300_000),
  },
  {
    type: 'CASH_OUT',
    minAmount: taka(50),
    maxPerTxn: taka(30_000),
    maxCountDay: 100,
    maxCountMonth: 250,
    maxAmountDay: taka(30_000),
    maxAmountMonth: taka(200_000),
  },
  { type: 'PAYMENT', minAmount: taka(1) },
];

const SETTINGS = [{ key: 'CUSTOMER_MAX_BALANCE', value: taka(500_000).toString() }];

/** System wallets, fee and limit rules, settings. Needed by every environment, demo or not. */
export async function seedSystem(): Promise<{ fees: Wallet; float: Wallet }> {
  // ON CONFLICT DO NOTHING: the partial unique index allows one wallet per system type.
  await prisma.wallet.createMany({
    data: [{ type: 'SYSTEM_FEES' }, { type: 'SYSTEM_FLOAT' }],
    skipDuplicates: true,
  });
  for (const r of FEE_RULES) {
    await prisma.feeRule.upsert({ where: { type: r.type }, create: r, update: {} });
  }
  for (const r of LIMIT_RULES) {
    await prisma.limitRule.upsert({ where: { type: r.type }, create: r, update: {} });
  }
  for (const s of SETTINGS) {
    await prisma.systemSetting.upsert({ where: { key: s.key }, create: s, update: {} });
  }
  const system = (type: 'SYSTEM_FEES' | 'SYSTEM_FLOAT') =>
    prisma.wallet.findFirstOrThrow({ where: { type, userId: null } });
  return { fees: await system('SYSTEM_FEES'), float: await system('SYSTEM_FLOAT') };
}

const DEMO_USERS = [
  {
    key: 'admin',
    phone: '01800000001',
    nidNumber: '9000000001',
    name: 'Demo Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
  },
  {
    key: 'rahim',
    phone: '01800000002',
    nidNumber: '9000000002',
    name: 'Rahim Uddin',
    role: 'CUSTOMER',
    status: 'ACTIVE',
  },
  {
    key: 'karim',
    phone: '01800000003',
    nidNumber: '9000000003',
    name: 'Karim Hasan',
    role: 'CUSTOMER',
    status: 'ACTIVE',
  },
  {
    key: 'agent',
    phone: '01800000004',
    nidNumber: '9000000004',
    name: 'Demo Agent',
    role: 'AGENT',
    status: 'ACTIVE',
  },
  {
    key: 'store',
    phone: '01800000005',
    nidNumber: '9000000005',
    name: 'Demo Store',
    role: 'MERCHANT',
    shopName: 'Demo Store',
    status: 'ACTIVE',
  },
  // The admin KYC queue's demo cases: one to review, one rejected (who can resubmit).
  {
    key: 'jamal',
    phone: '01800000006',
    nidNumber: '9000000006',
    name: 'Jamal Uddin',
    role: 'AGENT',
    status: 'PENDING_KYC',
  },
  {
    key: 'nusrat',
    phone: '01800000007',
    nidNumber: '9000000007',
    name: 'Nusrat Jahan',
    role: 'CUSTOMER',
    status: 'REJECTED',
  },
] as const;
type DemoKey = (typeof DEMO_USERS)[number]['key'];

// Each non-admin demo user's one KYC submission. APPROVED and REJECTED are reviewed by the admin.
const approved = { status: 'APPROVED', reason: null } as const;
const DEMO_KYC: Record<Exclude<DemoKey, 'admin'>, { status: KycStatus; reason: string | null }> = {
  rahim: approved,
  karim: approved,
  agent: approved,
  store: approved,
  jamal: { status: 'PENDING', reason: null },
  nusrat: {
    status: 'REJECTED',
    reason: 'The NID photo is blurry. Please retake it in good light.',
  },
};

/**
 * A demo user's 3 KYC images and one submission, stored like registration's (same keys, PRIVATE).
 * Skipped for a user who already has a submission: an admin's decision or a resubmit survives a
 * re-seed. No PROFILE document: the profile photo is never touched.
 */
async function seedDemoKyc(
  user: User,
  kyc: (typeof DEMO_KYC)[keyof typeof DEMO_KYC],
  admin: User,
  storage: StorageProvider,
) {
  if ((await prisma.kycSubmission.count({ where: { userId: user.id } })) > 0) return;

  const images = await demoKycImages(user);
  const docs = (
    [
      ['NID_FRONT', images.nidFront, 'nid-front'],
      ['NID_BACK', images.nidBack, 'nid-back'],
      ['SELFIE', images.selfie, 'selfie'],
    ] as const
  ).map(([kind, image, name]) => ({
    id: randomUUID(),
    kind,
    image,
    key: `kyc/${user.id}/${name}-${randomUUID()}.webp`,
  }));
  const [front, back, selfie] = docs;

  try {
    for (const d of docs) {
      await storage.put({
        key: d.key,
        body: d.image.data,
        contentType: d.image.mime,
        access: 'PRIVATE',
      });
    }
    await prisma.$transaction(async (tx) => {
      await tx.userDocument.createMany({
        data: docs.map((d) => ({
          id: d.id,
          userId: user.id,
          kind: d.kind,
          storageKey: d.key,
          access: 'PRIVATE' as const,
          mime: d.image.mime,
          sizeBytes: d.image.sizeBytes,
          width: d.image.width,
          height: d.image.height,
        })),
      });
      await tx.kycSubmission.create({
        data: {
          userId: user.id,
          nidFrontId: front!.id,
          nidBackId: back!.id,
          selfieId: selfie!.id,
          status: kyc.status,
          reason: kyc.reason,
          ...(kyc.status !== 'PENDING' && { reviewedById: admin.id, reviewedAt: new Date() }),
        },
      });
    });
  } catch (err) {
    // Nothing committed points at these files: remove them (best effort), then fail the seed.
    await Promise.all(docs.map((d) => storage.delete(d.key, 'PRIVATE').catch(() => undefined)));
    throw err;
  }
}

/**
 * The 7 demo accounts (PIN 48213), their KYC documents and their starting money. Run
 * seedSystem() first. The KYC images go to `storage` (tests pass MemoryStorage).
 */
export async function seedDemo(
  storage: StorageProvider,
): Promise<{ users: Record<DemoKey, User> }> {
  assertDemoSeedAllowed();
  const pinHash = await hashPin(DEMO_PIN);
  const users = {} as Record<DemoKey, User>;
  for (const { key, ...u } of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { phone: u.phone },
      create: {
        ...u,
        pinHash,
        // 'YYYY-MM-DD' parses as UTC midnight: the stored DATE is exactly this day.
        dateOfBirth: new Date('1995-01-01'),
      },
      update: {},
    });
    // update: {} keeps an existing user as it is, so it must already have the demo role: else
    // the demo money would go to (and come from) the wrong kind of wallet.
    if (user.role !== u.role) {
      throw new Error(`Phone ${u.phone} already belongs to a ${user.role}, not the demo ${u.role}`);
    }
    if (user.role !== 'ADMIN') {
      await prisma.wallet.upsert({
        where: { userId: user.id },
        create: { userId: user.id, type: user.role },
        update: {},
      });
    }
    users[key] = user;
  }
  for (const [key, kyc] of Object.entries(DEMO_KYC)) {
    await seedDemoKyc(users[key as DemoKey], kyc, users.admin, storage);
  }

  const walletOf = (u: User) => prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
  const float = await prisma.wallet.findFirstOrThrow({
    where: { type: 'SYSTEM_FLOAT', userId: null },
  });
  const [agent, rahim, karim] = await Promise.all(
    [users.agent, users.rahim, users.karim].map(walletOf),
  );
  const move = (
    idempotencyKey: string,
    type: PostTransactionInput['type'],
    from: Wallet,
    to: Wallet,
    amount: bigint,
    by: User,
  ) =>
    postTransaction({
      type,
      amount,
      fee: 0n,
      fromWalletId: from.id,
      toWalletId: to.id,
      postings: [
        { walletId: from.id, amount: -amount },
        { walletId: to.id, amount },
      ],
      initiatedById: by.id,
      idempotencyKey,
    });
  await move('seed:float:agent', 'FLOAT_TOPUP', float, agent!, taka(100_000), users.admin);
  await move('seed:cashin:rahim', 'CASH_IN', agent!, rahim!, taka(10_000), users.agent);
  await move('seed:cashin:karim', 'CASH_IN', agent!, karim!, taka(5_000), users.agent);

  return { users };
}

/** seedSystem + seedDemo, then proves the ledger balances. */
export async function seedAll(storage: StorageProvider) {
  assertDemoSeedAllowed(); // before seedSystem, so a refused run writes nothing at all
  const system = await seedSystem();
  const demo = await seedDemo(storage);
  const report = await reconcileLedger();
  if (!report.ok) {
    throw new Error('The ledger does not balance after seeding; run npm run ledger:check');
  }
  return { ...system, ...demo, report };
}
