import type { RequestHandler } from 'express';
import type { FlowType } from './flows';
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

/** POST /transactions/preview. A flow the caller's role can't start → 403 from the service. */
export const preview: RequestHandler = async (req, res) => {
  const { type, receiverPhone, amount } = req.body;
  res.json({
    success: true,
    data: await previewTransfer({ type, initiatorId: req.user!.id, receiverPhone, amount }),
  });
};
