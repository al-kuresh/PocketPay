import type { Role, TxType } from '../../api/types'

export interface Flow {
  /** The money POST and the client route: /transactions/<path> and /<path>. */
  path: string
  initiator: Role
  receiver: Role
  titleKey: string
}

/** Client copy of the server's flow table (server/src/modules/transactions/flows.ts): who may pay whom. */
export const FLOWS: Record<TxType, Flow> = {
  SEND_MONEY: { path: 'send-money', initiator: 'CUSTOMER', receiver: 'CUSTOMER', titleKey: 'flows.SEND_MONEY.title' },
  CASH_OUT: { path: 'cash-out', initiator: 'CUSTOMER', receiver: 'AGENT', titleKey: 'flows.CASH_OUT.title' },
  PAYMENT: { path: 'payment', initiator: 'CUSTOMER', receiver: 'MERCHANT', titleKey: 'flows.PAYMENT.title' },
  CASH_IN: { path: 'cash-in', initiator: 'AGENT', receiver: 'CUSTOMER', titleKey: 'flows.CASH_IN.title' },
}
