import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { BankAdapter, BankStatus, BankTimeoutError, BankTransferRequest, BankTransferResult } from './bank.adapter';

function scenarioFor(beneficiaryRef: string): { bankStatus: 'SUCCESS' | 'FAILED' | 'PENDING'; timeout: boolean } {
  const ref = beneficiaryRef.toUpperCase();
  if (ref.includes('TIMEOUT_FAIL')) return { bankStatus: 'FAILED', timeout: true };
  if (ref.includes('TIMEOUT')) return { bankStatus: 'SUCCESS', timeout: true };
  if (ref.includes('FAIL')) return { bankStatus: 'FAILED', timeout: false };
  if (ref.includes('PEND')) return { bankStatus: 'PENDING', timeout: false };
  return { bankStatus: 'SUCCESS', timeout: false };
}

@Injectable()
export class MockBankAdapter extends BankAdapter {
  constructor(private readonly db: DbService) { super(); }

  async transfer(req: BankTransferRequest): Promise<BankTransferResult> {
    const scenario = scenarioFor(req.beneficiaryRef);
    const { rows } = await this.db.query<{ status: 'SUCCESS' | 'FAILED' | 'PENDING' }>(
      `INSERT INTO mock_bank_transfers (bank_reference, beneficiary_ref, amount_paise, status)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (bank_reference) DO UPDATE SET transfer_attempts = mock_bank_transfers.transfer_attempts + 1
       RETURNING status`,
      [req.bankReference, req.beneficiaryRef, req.amountPaise, scenario.bankStatus]);
    if (scenario.timeout) throw new BankTimeoutError();
    const status = rows[0].status;
    return { status, failureReason: status === 'FAILED' ? 'Rejected by bank (mock)' : undefined };
  }

  async getStatus(bankReference: string): Promise<{ status: BankStatus }> {
    const { rows } = await this.db.query('SELECT status FROM mock_bank_transfers WHERE bank_reference = $1', [bankReference]);
    return { status: rows[0]?.status ?? 'NOT_FOUND' };
  }
}

export { BankModule } from './bank.module';
