import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { signWebhook } from '../src/common/auth';
import { DbService } from '../src/db/db.service';
import { SEED_MERCHANTS, seedMerchant } from '../src/db/seed';

export const ADMIN_TOKEN = 'test_admin_token';
export const A = { key: SEED_MERCHANTS[0].apiKey, opening: SEED_MERCHANTS[0].openingPaise, id: '' };  // INR 1,00,000
export const B = { key: SEED_MERCHANTS[1].apiKey, opening: SEED_MERCHANTS[1].openingPaise, id: '' };  // INR 50,000
export const inr = (rupees: number) => rupees * 100;

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  configureApp(app);
  await app.listen(0);   // real port so truly concurrent HTTP requests work
  return app;
}

/** Empties the TEST database and re-creates the two demo merchants (A: INR 1,00,000, B: INR 50,000). */
export async function resetAndSeed(db: DbService) {
  const name = (await db.query('SELECT current_database() AS n')).rows[0].n;
  if (!name.endsWith('_test')) throw new Error(`Refusing to wipe non-test database "${name}"`);
  await db.query('TRUNCATE webhook_events, mock_bank_transfers, payout_status_history, ledger_entries, payouts, wallets, merchants RESTART IDENTITY CASCADE');
  const client = await db.pool.connect();
  try {
    A.id = (await seedMerchant(client, SEED_MERCHANTS[0])).id;
    B.id = (await seedMerchant(client, SEED_MERCHANTS[1])).id;
  } finally {
    client.release();
  }
}

export const server = (app: INestApplication) => app.getHttpServer();

export const pay = (app: INestApplication, apiKey: string, idemKey: string | null, beneficiary: string, amountPaise: number) => {
  const req = request(server(app)).post('/api/payouts').set('X-API-Key', apiKey);
  if (idemKey) req.set('Idempotency-Key', idemKey);
  return req.send({ beneficiary_ref: beneficiary, amount_paise: amountPaise });
};

/** Sends a correctly signed mock-bank webhook. */
export const webhook = (app: INestApplication, body: object, signatureOverride?: string) => {
  const raw = JSON.stringify(body);
  return request(server(app)).post('/api/webhooks/bank')
    .set('Content-Type', 'application/json')
    .set('X-Bank-Signature', signatureOverride ?? signWebhook(raw))
    .send(raw);
};

export const getWallet = async (db: DbService, merchantId: string) =>
  (await db.query('SELECT available_paise, reserved_paise FROM wallets WHERE merchant_id = $1', [merchantId])).rows[0];

export const countLedger = async (db: DbService, merchantId: string, type: string) =>
  Number((await db.query('SELECT count(*) AS n FROM ledger_entries WHERE merchant_id = $1 AND type = $2', [merchantId, type])).rows[0].n);

/** Accounting invariant: the wallet must always equal what the ledger says. Call after every scenario. */
export async function expectLedgerConsistent(db: DbService, merchantId: string) {
  const { rows } = await db.query('SELECT type, COALESCE(SUM(amount_paise),0) AS s FROM ledger_entries WHERE merchant_id = $1 GROUP BY type', [merchantId]);
  const sum = (t: string) => Number(rows.find((r) => r.type === t)?.s ?? 0);
  const w = await getWallet(db, merchantId);
  expect(w.available_paise).toBe(sum('CREDIT') - sum('PAYOUT_RESERVE') + sum('PAYOUT_REVERSAL'));
  expect(w.reserved_paise).toBe(sum('PAYOUT_RESERVE') - sum('PAYOUT_SETTLE') - sum('PAYOUT_REVERSAL'));
  expect(w.available_paise).toBeGreaterThanOrEqual(0);
  expect(w.reserved_paise).toBeGreaterThanOrEqual(0);
  const last = (await db.query('SELECT available_after_paise, reserved_after_paise FROM ledger_entries WHERE merchant_id = $1 ORDER BY id DESC LIMIT 1', [merchantId])).rows[0];
  expect(last.available_after_paise).toBe(w.available_paise);
  expect(last.reserved_after_paise).toBe(w.reserved_paise);
}
