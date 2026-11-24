import type { Role } from '../../generated/prisma/client';

export type FlowType = 'SEND_MONEY' | 'CASH_IN' | 'CASH_OUT' | 'PAYMENT';

export interface FlowSpec {
  /** Role of the `from` side, who starts the transaction. */
  initiator: Role;
  /** Role of the `to` side. */
  receiver: Role;
  /** Which side's wallet the daily and monthly limits count against (always the customer). */
  limitSide: 'from' | 'to';
  feePaidBy: 'sender' | 'receiver';
}

/** Who may pay whom. The single source of truth: the flow table in the Phase 5 plan. */
export const FLOWS: Record<FlowType, FlowSpec> = {
  SEND_MONEY: {
    initiator: 'CUSTOMER',
    receiver: 'CUSTOMER',
    limitSide: 'from',
    feePaidBy: 'sender',
  },
  CASH_IN: { initiator: 'AGENT', receiver: 'CUSTOMER', limitSide: 'to', feePaidBy: 'sender' },
  CASH_OUT: { initiator: 'CUSTOMER', receiver: 'AGENT', limitSide: 'from', feePaidBy: 'sender' },
  PAYMENT: {
    initiator: 'CUSTOMER',
    receiver: 'MERCHANT',
    limitSide: 'from',
    feePaidBy: 'receiver',
  },
};
