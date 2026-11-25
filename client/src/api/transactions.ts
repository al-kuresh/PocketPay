import { api } from './client'
import type { Envelope, HistoryPage, LookupResult, Preview, Receipt, TxType } from './types'

/** GET /wallets/lookup: the masked name and role behind a phone. */
export async function lookup(phone: string) {
  const { data } = await api.get<Envelope<LookupResult>>('/wallets/lookup', { params: { phone } })
  return data.data
}

/** POST /transactions/preview: fee and total, before the PIN. Writes nothing. */
export async function preview(body: { type: TxType; receiverPhone: string; amount: string }) {
  const { data } = await api.post<Envelope<Preview>>('/transactions/preview', body)
  return data.data
}

export interface TransferBody {
  receiverPhone: string
  amount: string
  pin: string
  note?: string
}

/**
 * One of the money POSTs (`path` is send-money, cash-out, payment or cash-in). The same `idempotencyKey` again
 * never pays twice: the server answers the original receipt with `replayed: true`.
 */
export async function transfer(path: string, body: TransferBody, idempotencyKey: string) {
  const { data } = await api.post<Envelope<{ replayed: boolean; receipt: Receipt }>>(`/transactions/${path}`, body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  })
  return data.data
}

/** GET /transactions: the caller's history, newest first. */
export async function history(params: { limit?: number; cursor?: string; type?: string; from?: string; to?: string } = {}) {
  const { data } = await api.get<Envelope<HistoryPage>>('/transactions', { params })
  return data.data
}

/** GET /transactions/:trxId: one receipt, as the caller sees it. */
export async function receipt(trxId: string) {
  const { data } = await api.get<Envelope<Receipt>>(`/transactions/${encodeURIComponent(trxId)}`)
  return data.data
}
