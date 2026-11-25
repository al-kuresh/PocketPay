import type { RequestHandler } from 'express';
import type { FlowType } from './flows';
import { getReceipt, listHistory } from './history.service';
import type { HistoryQuery } from './transactions.schemas';
import { executeTransfer, previewTransfer } from './transfer.service';

// Thin layer: read the (already validated) request, call the service, send the response.
// req.user is set: requireAuth runs before every handler here.

/** A money POST for `type`: 201 for a new transaction, 200 for an idempotent replay. */
export const transfer =
  (type: FlowType): RequestHandler =>
  async (req, res) => {
    const { receiverPhone, amount, pin, note } = req.body;
    const result = await executeTransfer({
      type,
      initiatorId: req.user!.id,
      receiverPhone,
      amount,
      pin,
      note,
      idempotencyKey: res.locals.idempotencyKey,
      meta: { ip: req.ip },
    });
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
  };

/** GET /transactions: the caller's own history (validateQuery put the query on res.locals). */
export const history: RequestHandler = async (req, res) => {
  res.json({ success: true, data: await listHistory(req.user!.id, res.locals.query as HistoryQuery) });
};

/** GET /transactions/:trxId: a receipt, only if the caller's wallet is in the transaction. */
export const receipt: RequestHandler = async (req, res) => {
  const { trxId } = res.locals.params as { trxId: string };
  res.json({ success: true, data: await getReceipt(req.user!.id, trxId) });
};

/** POST /transactions/preview. A flow the caller's role can't start → 403 from the service. */
export const preview: RequestHandler = async (req, res) => {
  const { type, receiverPhone, amount } = req.body;
  res.json({
    success: true,
    data: await previewTransfer({ type, initiatorId: req.user!.id, receiverPhone, amount }),
  });
};
