import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requireAuth, requireRole } from '../../middlewares/auth';
import { lookupLimiter } from '../../middlewares/rateLimit';
import { validateQuery } from '../../middlewares/validate';
import { phoneSchema } from '../auth/auth.schemas';
import { findAccountByPhone, receiverNotFound, toParty } from '../transactions/parties';
import { accountNotActive } from '../transactions/transfer.service';

const lookupQuery = z.object({ phone: phoneSchema });

export const walletsRouter = Router();

// GET /wallets/lookup?phone= → who is behind a phone number, before sending to it.
walletsRouter.get(
  '/lookup',
  requireAuth,
  requireRole('CUSTOMER', 'AGENT'),
  lookupLimiter,
  validateQuery(lookupQuery),
  async (req, res) => {
    // Only an account that may send money may look up receivers: a PENDING_KYC or REJECTED
    // account (identity never verified) must not enumerate who is on PocketPay.
    const caller = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { status: true },
    });
    if (caller?.status !== 'ACTIVE') throw accountNotActive(caller?.status);

    const { phone } = res.locals.query as z.infer<typeof lookupQuery>;
    const account = await findAccountByPhone(prisma, phone);
    // An admin answers exactly like an unknown phone, as in assertReceiver.
    if (!account || account.role === 'ADMIN' || !account.wallet) throw receiverNotFound();
    // Name and role only: the caller already knows the phone, and nothing else may leave.
    const { name, role } = toParty(account);
    res.json({ success: true, data: { name, role } });
  },
);
