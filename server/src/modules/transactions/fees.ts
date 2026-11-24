import type { FeeRule } from '../../generated/prisma/client';
import { percentOfBp } from '../../utils/money';

type FeeRuleFields = Pick<
  FeeRule,
  'flatFee' | 'percentBp' | 'agentCommissionBp' | 'minAmountForFee'
>;

/** The fee on `amount` (only strictly above `minAmountForFee`) and the agent's share of it. */
export function calculateFee(
  rule: FeeRuleFields | null,
  amount: bigint,
): { fee: bigint; commission: bigint } {
  // The commission comes out of the fee (design §15 #13): no fee, no commission.
  if (!rule || amount <= rule.minAmountForFee) return { fee: 0n, commission: 0n };
  const fee = rule.flatFee + percentOfBp(amount, rule.percentBp);
  const commission = percentOfBp(amount, rule.agentCommissionBp);
  if (commission > fee) {
    throw new Error(`Bad fee rule: commission ${commission} is greater than fee ${fee}`);
  }
  return { fee, commission };
}
