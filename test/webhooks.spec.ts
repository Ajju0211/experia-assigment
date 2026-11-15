import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DbService } from '../src/db/db.service';
import { A, countLedger, createApp, expectLedgerConsistent, getWallet, inr, pay, resetAndSeed, server, webhook } from './helpers';

describe('Bank webhooks: authentication, duplicates, reversal safety', () => {
  let app: INestApplication;
  let db: DbService;
  let payoutId: string;
  let bankRef: string;

  beforeAll(async () => { app = await createApp(); db = app.get(DbService); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await resetAndSeed(db);
    const res = await pay(app, A.key, 'idem-hook-0001', 'BEN_PEND_001', inr(30_000));
    payoutId = res.body.data.id;
    bankRef = res.body.data.bank_reference;
  });

  const status = async () => (await db.query('SELECT status FROM payouts WHERE id = $1', [payoutId])).rows[0].status;
  const event = (id: string, st: string) => ({ event_id: id, bank_reference: bankRef, status: st });

  describe('authentication', () => {
    it('rejects missing, wrong and tampered signatures with 401 and changes nothing', async () => {
      const body = event('evt-auth-0001', 'FAILED');
      const none = await request(server(app)).post('/api/webhooks/bank').set('Content-Type', 'application/json').send(JSON.stringify(body));
      const wrong = await webhook(app, body, 'sha256=' + '0'.repeat(64));
      const forgedSecret = await webhook(app, body, 'sha256=deadbeef');
      expect([none.status, wrong.status, forgedSecret.status]).toEqual([401, 401, 401]);

      const { signWebhook } = await import('../src/common/auth');
      const sigForSuccess = signWebhook(JSON.stringify(event('evt-auth-0001', 'SUCCESS')));
      expect((await webhook(app, body, sigForSuccess)).status).toBe(401);

      expect(await status()).toBe('PENDING');
      expect((await db.query('SELECT count(*) AS n FROM webhook_events')).rows[0].n).toBe(0);
    });

    it('rejects a correctly signed but malformed payload with 400', async () => {
      expect((await webhook(app, { event_id: 'evt-bad-0001', bank_reference: bankRef, status: 'REFUNDED' })).status).toBe(400);
    });
  });

  describe('processing and duplicates', () => {
    it('SUCCESS webhook settles the payout', async () => {
      const res = await webhook(app, event('evt-ok-0001', 'SUCCESS'));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.statusCode).toBe(200);
      expect(res.body.data.result).toBe('APPLIED');
      expect(await status()).toBe('SUCCESS');
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(70_000), reserved_paise: 0 });
    });

    it('the same event delivered twice is processed once', async () => {
      const first = await webhook(app, event('evt-dup-0001', 'FAILED'));
      const second = await webhook(app, event('evt-dup-0001', 'FAILED'));
      expect(first.body.data.result).toBe('APPLIED');
      expect((await db.query('SELECT failure_reason FROM payouts WHERE id = $1', [payoutId])).rows[0].failure_reason).toBe('Bank reported failure (webhook)');
      expect(second.status).toBe(200);
      expect(second.body.data.result).toBe('DUPLICATE');
      expect(await countLedger(db, A.id, 'PAYOUT_REVERSAL')).toBe(1);
      expect(await getWallet(db, A.id)).toEqual({ available_paise: A.opening, reserved_paise: 0 });
    });

    it('the same event delivered 5 times CONCURRENTLY is processed once', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => webhook(app, event('evt-dup-conc1', 'FAILED'))));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.data.result === 'APPLIED')).toHaveLength(1);
      expect(results.filter((r) => r.body.data.result === 'DUPLICATE')).toHaveLength(4);
      expect(await countLedger(db, A.id, 'PAYOUT_REVERSAL')).toBe(1);
      await expectLedgerConsistent(db, A.id);
    });

    it('a webhook for an unknown bank reference is acknowledged and ignored', async () => {
      const res = await webhook(app, { event_id: 'evt-unknown-1', bank_reference: 'BNK-does-not-exist', status: 'FAILED' });
      expect(res.status).toBe(200);
      expect(res.body.data.result).toBe('UNKNOWN_REFERENCE');
    });

    it('a PENDING webhook moves UNKNOWN -> PENDING without leaking event detail into failure_reason', async () => {
      const p = await pay(app, A.key, 'idem-hook-unknown-pending', 'BEN_TIMEOUT_001', inr(10_000));
      expect(p.body.data.status).toBe('UNKNOWN');
      const res = await webhook(app, { event_id: 'evt-pend-unknown-1', bank_reference: p.body.data.bank_reference, status: 'PENDING' });
      expect(res.body.data.result).toBe('APPLIED');
      const row = (await db.query('SELECT status, failure_reason FROM payouts WHERE id = $1', [p.body.data.id])).rows[0];
      expect(row.status).toBe('PENDING');
      expect(row.failure_reason).toBeNull();
    });
  });

  describe('reversal safety (funds released exactly once)', () => {
    it('many DIFFERENT failure events for the same payout still reverse only once', async () => {
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => webhook(app, event(`evt-rev-000${i}`, 'FAILED'))));
      expect(results.filter((r) => r.body.data.result === 'APPLIED')).toHaveLength(1);
      expect(results.filter((r) => r.body.data.result === 'NO_CHANGE')).toHaveLength(5);
      expect(await countLedger(db, A.id, 'PAYOUT_REVERSAL')).toBe(1);
      expect(await getWallet(db, A.id)).toEqual({ available_paise: A.opening, reserved_paise: 0 });
      await expectLedgerConsistent(db, A.id);
    });

    it('a FAILED payout can never become SUCCESS (and vice versa): invalid transitions are ignored', async () => {
      await webhook(app, event('evt-flip-0001', 'FAILED'));
      const late = await webhook(app, event('evt-flip-0002', 'SUCCESS'));
      expect(late.status).toBe(200);
      expect(late.body.data.result).toBe('INVALID_TRANSITION');
      expect(await status()).toBe('FAILED');
      expect(await countLedger(db, A.id, 'PAYOUT_SETTLE')).toBe(0);
      expect(await getWallet(db, A.id)).toEqual({ available_paise: A.opening, reserved_paise: 0 });

      await resetAndSeed(db);
      const p = await pay(app, A.key, 'idem-flip-b-001', 'BEN_PEND_001', inr(30_000));
      bankRef = p.body.data.bank_reference;
      payoutId = p.body.data.id;
      await webhook(app, event('evt-flip-0003', 'SUCCESS'));
      const lateFail = await webhook(app, event('evt-flip-0004', 'FAILED'));
      expect(lateFail.body.data.result).toBe('INVALID_TRANSITION');
      expect(await countLedger(db, A.id, 'PAYOUT_REVERSAL')).toBe(0);
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(70_000), reserved_paise: 0 });
    });

    it('webhook failure racing with reconciliation still reverses once', async () => {
      await db.query("UPDATE mock_bank_transfers SET status = 'FAILED'");
      const recon = (await import('../src/reconciliation/reconciliation.service')).ReconciliationService;
      await Promise.all([
        webhook(app, event('evt-race-0001', 'FAILED')),
        app.get(recon).run(),
        app.get(recon).run(),
      ]);
      expect(await countLedger(db, A.id, 'PAYOUT_REVERSAL')).toBe(1);
      await expectLedgerConsistent(db, A.id);
    });
  });
});
