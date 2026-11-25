import { Router } from 'express';
import { requireAuth, requireRole } from '../../middlewares/auth';
import { requireIdempotencyKey } from '../../middlewares/idempotency';
import { moneyLimiter } from '../../middlewares/rateLimit';
import { validateBody } from '../../middlewares/validate';
import { FLOWS, type FlowType } from './flows';
import { preview, transfer } from './transactions.controller';
import { previewBody, transferBody } from './transactions.schemas';

/** The middleware chain of a money POST, in the order the plan fixes. The role comes from FLOWS. */
const money = (type: FlowType) => [
  requireAuth,
  requireRole(FLOWS[type].initiator),
  moneyLimiter,
  requireIdempotencyKey,
  validateBody(transferBody),
  transfer(type),
];

export const transactionsRouter = Router();

transactionsRouter.post('/send-money', ...money('SEND_MONEY'));
transactionsRouter.post('/cash-out', ...money('CASH_OUT'));
transactionsRouter.post('/payment', ...money('PAYMENT'));
transactionsRouter.post('/cash-in', ...money('CASH_IN'));

// No Idempotency-Key: a preview writes nothing.
transactionsRouter.post(
  '/preview',
  requireAuth,
  requireRole('CUSTOMER', 'AGENT'),
  moneyLimiter,
  validateBody(previewBody),
  preview,
);
