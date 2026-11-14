import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';

export type LedgerType = 'CREDIT' | 'PAYOUT_RESERVE' | 'PAYOUT_SETTLE' | 'PAYOUT_REVERSAL';

@Injectable()
export class WalletService {
  constructor(private readonly db: DbService) {}

  async getWallet(merchantId: string) {
    const { rows } = await this.db.query(
      'SELECT available_paise, reserved_paise, updated_at FROM wallets WHERE merchant_id = $1', [merchantId]);
    return rows[0];
  }

  async lock(c: PoolClient, merchantId: string): Promise<void> {
    await c.query('SELECT 1 FROM wallets WHERE merchant_id = $1 FOR UPDATE', [merchantId]);
  }

  async credit(c: PoolClient, merchantId: string, amount: number, description: string) {
    const { rows } = await c.query(
      `UPDATE wallets SET available_paise = available_paise + $2, updated_at = now()
       WHERE merchant_id = $1 RETURNING available_paise, reserved_paise`, [merchantId, amount]);
    await this.post(c, merchantId, null, 'CREDIT', amount, rows[0], description);
  }

  async reserve(c: PoolClient, merchantId: string, payoutId: string, amount: number): Promise<boolean> {
    const { rows } = await c.query(
      `UPDATE wallets
          SET available_paise = available_paise - $2, reserved_paise = reserved_paise + $2, updated_at = now()
        WHERE merchant_id = $1 AND available_paise >= $2
        RETURNING available_paise, reserved_paise`, [merchantId, amount]);
    if (!rows[0]) return false;
    await this.post(c, merchantId, payoutId, 'PAYOUT_RESERVE', amount, rows[0], 'Payout reserved');
    return true;
  }

  async settle(c: PoolClient, merchantId: string, payoutId: string, amount: number) {
    const { rows } = await c.query(
      `UPDATE wallets SET reserved_paise = reserved_paise - $2, updated_at = now()
       WHERE merchant_id = $1 RETURNING available_paise, reserved_paise`, [merchantId, amount]);
    await this.post(c, merchantId, payoutId, 'PAYOUT_SETTLE', amount, rows[0], 'Payout settled');
  }

  async release(c: PoolClient, merchantId: string, payoutId: string, amount: number) {
    const { rows } = await c.query(
      `UPDATE wallets
          SET reserved_paise = reserved_paise - $2, available_paise = available_paise + $2, updated_at = now()
        WHERE merchant_id = $1 RETURNING available_paise, reserved_paise`, [merchantId, amount]);
    await this.post(c, merchantId, payoutId, 'PAYOUT_REVERSAL', amount, rows[0], 'Payout failed - funds released');
  }

  private async post(c: PoolClient, merchantId: string, payoutId: string | null, type: LedgerType, amount: number,
                     after: { available_paise: number; reserved_paise: number }, description: string) {
    await c.query(
      `INSERT INTO ledger_entries (merchant_id, payout_id, type, amount_paise, available_after_paise, reserved_after_paise, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [merchantId, payoutId, type, amount, after.available_paise, after.reserved_paise, description]);
  }
}

export { WalletModule } from './wallet.module';
