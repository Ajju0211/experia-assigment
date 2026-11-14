import { maskTail } from '../../shared/utils/redact.util';
import { PayoutStatus } from '../state-machine';

export interface PayoutRow {
  id: string;
  merchant_id: string;
  idempotency_key: string;
  request_hash: string;
  beneficiary_ref: string;
  amount_paise: number;
  status: PayoutStatus;
  bank_reference: string;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export function toPayoutResponse(p: PayoutRow) {
  return {
    id: p.id,
    status: p.status,
    amount_paise: p.amount_paise,
    currency: 'INR',
    beneficiary_ref: maskTail(p.beneficiary_ref),
    idempotency_key: p.idempotency_key,
    bank_reference: p.bank_reference,
    failure_reason: p.failure_reason,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}
