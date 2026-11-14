import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DbService } from '../src/db/db.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { A, ADMIN_TOKEN, countLedger, createApp, expectLedgerConsistent, getWallet, inr, pay, resetAndSeed, server } from './helpers';

describe('Mock bank outcomes and reconciliation', () => {
  let app: INestApplication;
  let db: DbService;
  let recon: ReconciliationService;

  beforeAll(async () => { app = await createApp(); db = app.get(DbService); recon = app.get(ReconciliationService); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetAndSeed(db); });

  const attempts = async () => (await db.query('SELECT transfer_attempts FROM mock_bank_transfers')).rows.map((r) => r.transfer_attempts);

  describe('the four bank responses', () => {
    it('SUCCESS: funds are settled', async () => {
      const res = await pay(app, A.key, 'idem-bank-ok-01', 'BEN_OK_001', inr(10_000));
      expect(res.body.success).toBe(true);
      expect(res.body.statusCode).toBe(201);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(90_000), reserved_paise: 0 });
      expect(await countLedger(db, A.id, 'PAYOUT_SETTLE')).toBe(1);
    });

    it('FAILED: funds are released immediately, exactly once', async () => {
      const res = await pay(app, A.key, 'idem-bank-fail1', 'BEN_FAIL_001', inr(10_000));
      expect(res.body.data.status).toBe('FAILED');
      expect(res.body.data.failure_reason).toBeTruthy();
      expect(await getWallet(db, A.id)).toEqual({ available_paise: A.opening, reserved_paise: 0 });
      expect(await countLedger(db, A.id, 'PAYOUT_REVERSAL')).toBe(1);
      await expectLedgerConsistent(db, A.id);
    });

    it('PENDING: funds stay reserved until the bank confirms', async () => {
      const res = await pay(app, A.key, 'idem-bank-pend1', 'BEN_PEND_001', inr(10_000));
      expect(res.body.data.status).toBe('PENDING');
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(90_000), reserved_paise: inr(10_000) });
    });
  });

  describe('bank TIMEOUT (uncertain outcome)', () => {
    it('is stored as UNKNOWN, funds stay reserved, and the transfer is NEVER retried', async () => {
      const first = await pay(app, A.key, 'idem-timeout-01', 'BEN_TIMEOUT_001', inr(10_000));
      expect(first.status).toBe(201);
      expect(first.body.data.status).toBe('UNKNOWN');
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(90_000), reserved_paise: inr(10_000) });
      expect(await attempts()).toEqual([1]);

      const retry = await pay(app, A.key, 'idem-timeout-01', 'BEN_TIMEOUT_001', inr(10_000));
      expect(retry.status).toBe(200);
      expect(retry.body.data.status).toBe('UNKNOWN');
      expect(await attempts()).toEqual([1]);
      expect(await countLedger(db, A.id, 'PAYOUT_RESERVE')).toBe(1);
    });

    it('reconciliation resolves UNKNOWN -> SUCCESS when the bank actually paid (and is idempotent)', async () => {
      await pay(app, A.key, 'idem-timeout-02', 'BEN_TIMEOUT_002', inr(10_000));

      const dry = await recon.run({ dryRun: true });
      expect(dry.resolved).toEqual([expect.objectContaining({ from: 'UNKNOWN', to: 'SUCCESS', applied: false })]);
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(90_000), reserved_paise: inr(10_000) });

      const real = await recon.run();
      expect(real.resolved).toEqual([expect.objectContaining({ from: 'UNKNOWN', to: 'SUCCESS', applied: true })]);
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(90_000), reserved_paise: 0 });

      const again = await recon.run();
      expect(again.resolved).toHaveLength(0);
      expect(again.matched).toBe(1);
      expect(await countLedger(db, A.id, 'PAYOUT_SETTLE')).toBe(1);
      await expectLedgerConsistent(db, A.id);
    });

    it('reconciliation resolves UNKNOWN -> FAILED when the bank actually rejected: funds released once', async () => {
      await pay(app, A.key, 'idem-timeout-03', 'BEN_TIMEOUT_FAIL_003', inr(10_000));
      await recon.run();
      await recon.run();
      expect(await getWallet(db, A.id)).toEqual({ available_paise: A.opening, reserved_paise: 0 });
      expect(await countLedger(db, A.id, 'PAYOUT_REVERSAL')).toBe(1);
      const history = await db.query('SELECT to_status, source FROM payout_status_history ORDER BY id');
      expect(history.rows).toEqual([
        { to_status: 'PROCESSING', source: 'API' },
        { to_status: 'UNKNOWN', source: 'BANK_RESPONSE' },
        { to_status: 'FAILED', source: 'RECONCILIATION' },
      ]);
      await expectLedgerConsistent(db, A.id);
    });
  });

  describe('reconciliation safety', () => {
    it('resolves PENDING when the bank has a final answer', async () => {
      await pay(app, A.key, 'idem-recon-pend', 'BEN_PEND_001', inr(10_000));
      await db.query("UPDATE mock_bank_transfers SET status = 'FAILED'");
      const report = await recon.run();
      expect(report.resolved).toEqual([expect.objectContaining({ from: 'PENDING', to: 'FAILED', applied: true })]);
      expect(await getWallet(db, A.id)).toEqual({ available_paise: A.opening, reserved_paise: 0 });
    });

    it('never auto-changes a FINAL payout that the bank disagrees with: flags it for manual review', async () => {
      await pay(app, A.key, 'idem-recon-final', 'BEN_OK_001', inr(10_000));
      await db.query("UPDATE mock_bank_transfers SET status = 'FAILED'");
      const report = await recon.run();
      expect(report.resolved).toHaveLength(0);
      expect(report.manual_review).toEqual([expect.objectContaining({ local_status: 'SUCCESS', bank_status: 'FAILED' })]);
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(90_000), reserved_paise: 0 });
    });

    it('does not guess when the bank has no record: flags it for manual review', async () => {
      await pay(app, A.key, 'idem-recon-miss', 'BEN_TIMEOUT_001', inr(10_000));
      await db.query('DELETE FROM mock_bank_transfers');
      const report = await recon.run();
      expect(report.manual_review).toEqual([expect.objectContaining({ local_status: 'UNKNOWN', bank_status: 'NOT_FOUND' })]);
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(90_000), reserved_paise: inr(10_000) });
    });

    it('POST /api/admin/reconcile requires the admin token', async () => {
      await pay(app, A.key, 'idem-recon-http', 'BEN_TIMEOUT_001', inr(10_000));
      expect((await request(server(app)).post('/api/admin/reconcile')).status).toBe(401);
      expect((await request(server(app)).post('/api/admin/reconcile').set('X-API-Key', A.key)).status).toBe(401);
      const ok = await request(server(app)).post('/api/admin/reconcile').set('X-Admin-Token', ADMIN_TOKEN);
      expect(ok.status).toBe(200);
      expect(ok.body.data.resolved).toHaveLength(1);
    });
  });
});
