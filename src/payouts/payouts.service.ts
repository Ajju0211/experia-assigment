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

/**
 * Owns the payout lifecycle: creation, bank submission, and status transitions.
 *
 * A payout is created in two phases: first we atomically reserve funds inside a
 * DB transaction, then we call the bank outside of it. Keeping the network call
 * out of the transaction avoids holding wallet locks for the duration of an
 * external request; any ambiguous bank outcome is parked as UNKNOWN and left
 * for reconciliation instead of being retried.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly db: DbService,
    private readonly wallet: WalletService,
    private readonly bank: BankAdapter,
  ) {}

  /**
   * Creates a payout idempotently and performs the initial bank submission.
   *
   * Idempotency is scoped per merchant + Idempotency-Key. A request hash of the
   * normalized payload is stored alongside the key so that reusing a key with a
   * different payload is rejected rather than silently returning the old payout.
   * Replays return the original payout without touching the bank again.
   *
   * @returns the payout plus whether this call was an idempotent replay.
   */
  async create(merchantId: string, idempotencyKey: string, dto: CreatePayoutDto): Promise<{ payout: PayoutRow; replayed: boolean }> {
    // Normalize before hashing so semantically identical requests match even if
    // the client changes whitespace or sends a fractional amount.
    const normalizedRef = dto.beneficiary_ref.trim();
    const normalizedAmount = Math.trunc(dto.amount_paise);
    const requestHash = sha256(`${normalizedRef}|${normalizedAmount}`);

    // Phase 1: reserve funds and persist the payout in a single transaction.
    // The wallet row is locked first so concurrent payouts for the same merchant
    // serialize and cannot overdraw the available balance.
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

    // Phase 2: submit to the bank only after funds are safely reserved. This call
    // is intentionally outside the transaction so a slow bank cannot hold locks.
    const outcome = await this.callBank(step1.payout);
    const { payout } = await this.db.tx((c) =>
      this.transition(c, step1.payout.id, outcome.status, 'BANK_RESPONSE', outcome.reason));
    return { payout, replayed: false };
  }

  /**
   * Submits the transfer and maps the bank result onto a payout status.
   *
   * Transient failures are never retried here: if the bank timed out or errored
   * we cannot know whether the money moved, so the payout is marked UNKNOWN and
   * reconciliation decides the final outcome from the bank's records.
   */
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

  /**
   * Applies a state transition under a row-level lock.
   *
   * The lock guarantees we read the latest status before deciding, which keeps
   * concurrent writers (API, bank response, webhook, reconciliation) from
   * double-applying wallet side effects. Invalid or no-op transitions are
   * reported instead of throwing so callers can treat them as idempotent.
   */
  async transition(c: PoolClient, payoutId: string, target: PayoutStatus, source: TransitionSource, detail?: string): Promise<TransitionResult> {
    const { rows } = await c.query<PayoutRow>('SELECT * FROM payouts WHERE id = $1 FOR UPDATE', [payoutId]);
    const p = rows[0];
    if (!p) throw new NotFoundException({ code: 'PAYOUT_NOT_FOUND', message: 'Payout not found' });

    if (p.status === target) return { payout: p, applied: false, reason: 'NO_CHANGE' };
    if (!canTransition(p.status, target)) {
      this.logger.warn(`Ignored invalid transition ${p.status} -> ${target} for payout ${p.id} (source ${source})`);
      return { payout: p, applied: false, reason: 'INVALID_TRANSITION' };
    }

    // Wallet impact must happen exactly once, alongside the status change, so
    // both live in the same transaction: settle deducts the reserve on success;
    // release returns it to available balance on failure.
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

  // Append-only audit trail; kept in the same transaction as the status update
  // so history can never drift from the payout's actual state.
  private async addHistory(c: PoolClient, payoutId: string, from: string | null, to: string, source: TransitionSource, detail?: string) {
    await c.query(
      'INSERT INTO payout_status_history (payout_id, from_status, to_status, source, detail) VALUES ($1,$2,$3,$4,$5)',
      [payoutId, from, to, source, detail ?? null]);
  }
}
