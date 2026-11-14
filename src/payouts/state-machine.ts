export type PayoutStatus = 'PROCESSING' | 'PENDING' | 'UNKNOWN' | 'SUCCESS' | 'FAILED';

export const PAYOUT_STATUSES: PayoutStatus[] = ['PROCESSING', 'PENDING', 'UNKNOWN', 'SUCCESS', 'FAILED'];

/**
 * PROCESSING = funds reserved, bank not answered yet
 * PENDING    = bank accepted, outcome not final
 * UNKNOWN    = we do not know what happened (timeout / error) - NEVER treated as failed
 * SUCCESS / FAILED are final: nothing may move out of them.
 */
const ALLOWED: Record<PayoutStatus, PayoutStatus[]> = {
  PROCESSING: ['PENDING', 'UNKNOWN', 'SUCCESS', 'FAILED'],
  PENDING: ['SUCCESS', 'FAILED'],
  UNKNOWN: ['PENDING', 'SUCCESS', 'FAILED'],
  SUCCESS: [],
  FAILED: [],
};

export const canTransition = (from: PayoutStatus, to: PayoutStatus) => ALLOWED[from].includes(to);
export const isTerminal = (s: PayoutStatus) => ALLOWED[s].length === 0;
