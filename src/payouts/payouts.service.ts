import { ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { BankAdapter, BankTimeoutError } from '../bank/bank.adapter';
import { DbService } from '../db/db.service';
import { sha256 } from '../shared/utils/hash.util';
import { WalletService } from '../wallet/wallet.service';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { PayoutRow } from './dto/payout-response.dto';
import { canTransition, PayoutStatus } from './state-machine';

export type TransitionSource = 'API' | 'BANK_RESPONSE' | 'WEBHOOK' | 'RECONCILIATION';
export interface TransitionResult {
  payout: PayoutRow;
  applied: boolean;
  reason: 'APPLIED' | 'NO_CHANGE' | 'INVALID_TRANSITION';
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly db: DbService,
    private readonly wallet: WalletService,
    private readonly bank: BankAdapter,
  ) {}

  async create(merchantId: string, idempotencyKey: string, dto: CreatePayoutDto): Promise<{ payout: PayoutRow; replayed: boolean }> {
    const normalizedRef = dto.beneficiary_ref.trim();
    const normalizedAmount = Math.trunc(dto.amount_paise);
    const requestHash = sha256(`${normalizedRef}|${normalizedAmount}`);

    const step1 = await this.db.tx(async (c) => {
      await this.wallet.lock(c, merchantId);

      const existing = await c.query<PayoutRow>(
        'SELECT * FROM payouts WHERE merchant_id = $1 AND idempotency_key = $2',
        [merchantId, idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== requestHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Idempotency-Key was already used with a different request payload',
          });
        }
        return { payout: existing.rows[0], replayed: true };
      }

      const id = randomUUID();
      const { rows } = await c.query<PayoutRow>(
        `INSERT INTO payouts (id, merchant_id, idempotency_key, request_hash, beneficiary_ref, amount_paise, status, bank_reference)
         VALUES ($1,$2,$3,$4,$5,$6,'PROCESSING',$7)
         ON CONFLICT (merchant_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [id, merchantId, idempotencyKey, requestHash, normalizedRef, normalizedAmount, `BNK-${id}`],
      );

      // Handle concurrent insert if another transaction raced past the SELECT
      if (!rows[0]) {
        const conflict = await c.query<PayoutRow>(
          'SELECT * FROM payouts WHERE merchant_id = $1 AND idempotency_key = $2',
          [merchantId, idempotencyKey],
        );
        if (conflict.rows[0]) {
          if (conflict.rows[0].request_hash !== requestHash) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'Idempotency-Key was already used with a different request payload',
            });
          }
          return { payout: conflict.rows[0], replayed: true };
        }
      }

      const reserved = await this.wallet.reserve(c, merchantId, id, normalizedAmount);
      if (!reserved) {
        throw new HttpException({ code: 'INSUFFICIENT_FUNDS', message: 'Insufficient available balance' }, 422);
      }
      await this.addHistory(c, id, null, 'PROCESSING', 'API');
      return { payout: rows[0], replayed: false };
    });

    if (step1.replayed) return step1;

    const outcome = await this.callBank(step1.payout);
    const { payout } = await this.db.tx((c) =>
      this.transition(c, step1.payout.id, outcome.status, 'BANK_RESPONSE', outcome.reason));
    return { payout, replayed: false };
  }

  private async callBank(p: PayoutRow): Promise<{ status: PayoutStatus; reason?: string }> {
    try {
      const res = await this.bank.transfer({
        bankReference: p.bank_reference,
        beneficiaryRef: p.beneficiary_ref,
        amountPaise: p.amount_paise,
      });
      if (res.status === 'SUCCESS' || res.status === 'FAILED' || res.status === 'PENDING') {
        return { status: res.status, reason: res.failureReason };
      }
      return { status: 'UNKNOWN', reason: 'Unexpected bank status response' };
    } catch (err) {
      const timeout = err instanceof BankTimeoutError;
      this.logger.warn(`Bank outcome unknown for payout ${p.id} (${timeout ? 'timeout' : 'error'}); will not retry, leaving for reconciliation`);
      return { status: 'UNKNOWN', reason: timeout ? 'Bank timeout - outcome unknown' : 'Bank error - outcome unknown' };
    }
  }

  async transition(c: PoolClient, payoutId: string, target: PayoutStatus, source: TransitionSource, detail?: string): Promise<TransitionResult> {
    const { rows } = await c.query<PayoutRow>('SELECT * FROM payouts WHERE id = $1 FOR UPDATE', [payoutId]);
    const p = rows[0];
    if (!p) throw new NotFoundException({ code: 'PAYOUT_NOT_FOUND', message: 'Payout not found' });

    if (p.status === target) return { payout: p, applied: false, reason: 'NO_CHANGE' };
    if (!canTransition(p.status, target)) {
      this.logger.warn(`Ignored invalid transition ${p.status} -> ${target} for payout ${p.id} (source ${source})`);
      return { payout: p, applied: false, reason: 'INVALID_TRANSITION' };
    }

    if (target === 'SUCCESS') await this.wallet.settle(c, p.merchant_id, p.id, p.amount_paise);
    if (target === 'FAILED') await this.wallet.release(c, p.merchant_id, p.id, p.amount_paise);

    const failureReason = target === 'FAILED'
      ? (source === 'BANK_RESPONSE' ? (detail ?? 'Rejected by bank') : `Bank reported failure (${source.toLowerCase()})`)
      : target === 'UNKNOWN' ? (detail ?? null)
      : null;
    const updated = await c.query<PayoutRow>(
      `UPDATE payouts SET status = $2, failure_reason = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [p.id, target, failureReason]);
    await this.addHistory(c, p.id, p.status, target, source, detail);
    return { payout: updated.rows[0], applied: true, reason: 'APPLIED' };
  }

  async findForMerchant(merchantId: string, id: string): Promise<PayoutRow> {
    const { rows } = await this.db.query<PayoutRow>('SELECT * FROM payouts WHERE id = $1 AND merchant_id = $2', [id, merchantId]);
    if (!rows[0]) throw new NotFoundException({ code: 'PAYOUT_NOT_FOUND', message: 'Payout not found' });
    return rows[0];
  }

  private async addHistory(c: PoolClient, payoutId: string, from: string | null, to: string, source: TransitionSource, detail?: string) {
    await c.query(
      'INSERT INTO payout_status_history (payout_id, from_status, to_status, source, detail) VALUES ($1,$2,$3,$4,$5)',
      [payoutId, from, to, source, detail ?? null]);
  }
}
