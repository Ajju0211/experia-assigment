export interface BankTransferRequest {
  bankReference: string;   // stable per payout; the bank uses it to deduplicate
  beneficiaryRef: string;
  amountPaise: number;
}
export interface BankTransferResult {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  failureReason?: string;
}
export type BankStatus = 'SUCCESS' | 'FAILED' | 'PENDING' | 'NOT_FOUND';

/** Thrown when we sent a transfer but never got an answer. The transfer may or may not have happened. */
export class BankTimeoutError extends Error {
  constructor() { super('Bank request timed out'); }
}

/** Abstract class doubles as the Nest injection token, so a real bank client can replace the mock without touching callers. */
export abstract class BankAdapter {
  abstract transfer(req: BankTransferRequest): Promise<BankTransferResult>;
  abstract getStatus(bankReference: string): Promise<{ status: BankStatus }>;
}
