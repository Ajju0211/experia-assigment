import { PayoutStatus } from '../../payouts/state-machine';

export interface ReconciliationReport {
  dry_run: boolean;
  checked: number;
  matched: number;
  resolved: { payout_id: string; from: PayoutStatus; to: string; applied: boolean }[];
  manual_review: { payout_id: string; local_status: PayoutStatus; bank_status: string; reason: string }[];
  errors: { payout_id: string; message: string }[];
}
