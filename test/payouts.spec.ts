import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DbService } from '../src/db/db.service';
import { A, B, countLedger, createApp, expectLedgerConsistent, getWallet, inr, pay, resetAndSeed, server } from './helpers';

describe('Payouts: concurrency, idempotency, access control', () => {
  let app: INestApplication;
  let db: DbService;

  beforeAll(async () => { app = await createApp(); db = app.get(DbService); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetAndSeed(db); });

  describe('simultaneous withdrawals (mandatory case)', () => {
    it('two INR 70,000 requests at the same instant against INR 1,00,000: at most one reserves funds', async () => {
      const [r1, r2] = await Promise.all([
        pay(app, A.key, 'idem-conc-0001', 'BEN_PEND_001', inr(70_000)),
        pay(app, A.key, 'idem-conc-0002', 'BEN_PEND_002', inr(70_000)),
      ]);

      expect([r1.status, r2.status].sort()).toEqual([201, 422]);
      const rejected = r1.status === 422 ? r1 : r2;
      expect(rejected.body.success).toBe(false);
      expect(rejected.body.statusCode).toBe(422);
      expect(rejected.body.error.code).toBe('INSUFFICIENT_FUNDS');

      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(30_000), reserved_paise: inr(70_000) });
      expect((await db.query('SELECT count(*) AS n FROM payouts')).rows[0].n).toBe(1);
      expect(await countLedger(db, A.id, 'PAYOUT_RESERVE')).toBe(1);
      await expectLedgerConsistent(db, A.id);
    });

    it('10 concurrent INR 30,000 requests: exactly 3 succeed, 7 are rejected, balance never goes negative', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => pay(app, A.key, `idem-burst-${String(i).padStart(3, '0')}`, `BEN_BURST_${i}`, inr(30_000))),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status === 422)).toHaveLength(7);
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(10_000), reserved_paise: 0 });
      await expectLedgerConsistent(db, A.id);
    });
  });

  describe('idempotency', () => {
    it('same key + same payload twice: one payout, one debit, same response, bank called once', async () => {
      const first = await pay(app, A.key, 'idem-repeat-01', 'BEN_ACME_001', inr(10_000));
      const second = await pay(app, A.key, 'idem-repeat-01', 'BEN_ACME_001', inr(10_000));

      expect(first.status).toBe(201);
      expect(first.body.success).toBe(true);
      expect(first.body.statusCode).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.success).toBe(true);
      expect(second.body.statusCode).toBe(200);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body.data.id).toBe(first.body.data.id);
      expect((await db.query('SELECT count(*) AS n FROM payouts')).rows[0].n).toBe(1);
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(90_000), reserved_paise: 0 });
      expect((await db.query('SELECT transfer_attempts FROM mock_bank_transfers')).rows[0].transfer_attempts).toBe(1);
      await expectLedgerConsistent(db, A.id);
    });

    it('same key sent 5 times concurrently: exactly one payout is created', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => pay(app, A.key, 'idem-same-key-1', 'BEN_ACME_001', inr(10_000))));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 200)).toHaveLength(4);
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(90_000), reserved_paise: 0 });
    });

    it('same key with a DIFFERENT payload is rejected (409) and changes nothing', async () => {
      await pay(app, A.key, 'idem-conflict-1', 'BEN_ACME_001', inr(10_000));
      const res = await pay(app, A.key, 'idem-conflict-1', 'BEN_ACME_001', inr(20_000));
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(409);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await getWallet(db, A.id)).toEqual({ available_paise: inr(90_000), reserved_paise: 0 });
    });

    it('idempotency keys are merchant-scoped: two merchants may use the same key', async () => {
      const a = await pay(app, A.key, 'idem-shared-key', 'BEN_ACME_001', inr(1_000));
      const b = await pay(app, B.key, 'idem-shared-key', 'BEN_GLOBEX_01', inr(1_000));
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.data.id).not.toBe(b.body.data.id);
    });
  });

  describe('input validation', () => {
    it.each([
      ['negative amount', 'idem-valid-001', 'BEN_ACME_001', -500],
      ['zero amount', 'idem-valid-002', 'BEN_ACME_001', 0],
      ['fractional paise', 'idem-valid-003', 'BEN_ACME_001', 100.5],
      ['amount below INR 1', 'idem-valid-004', 'BEN_ACME_001', 50],
      ['bad beneficiary chars', 'idem-valid-005', 'BEN ACME;DROP', 10_000],
    ])('rejects %s with 400 and structured validation details', async (_name, key, ben, amount) => {
      const res = await pay(app, A.key, key, ben, amount as number);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toBeDefined();
      expect(await getWallet(db, A.id)).toEqual({ available_paise: A.opening, reserved_paise: 0 });
    });

    it('rejects a missing Idempotency-Key and unknown body fields', async () => {
      const noKey = await pay(app, A.key, null, 'BEN_ACME_001', 10_000);
      expect(noKey.status).toBe(400);
      expect(noKey.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');

      const extra = await request(server(app)).post('/api/payouts').set('X-API-Key', A.key).set('Idempotency-Key', 'idem-extra-0001')
        .send({ beneficiary_ref: 'BEN_ACME_001', amount_paise: 10_000, merchant_id: B.id });
      expect(extra.status).toBe(400);
      expect(extra.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('merchant authentication and cross-merchant access', () => {
    it('requires a valid API key', async () => {
      expect((await request(server(app)).get('/api/transactions')).status).toBe(401);
      expect((await request(server(app)).get('/api/transactions').set('X-API-Key', 'wrong')).status).toBe(401);
      expect((await pay(app, 'wrong-key', 'idem-noauth-01', 'BEN_ACME_001', 10_000)).status).toBe(401);
    });

    it("merchant B cannot read merchant A's payout (404, same as non-existent)", async () => {
      const created = await pay(app, A.key, 'idem-private-01', 'BEN_ACME_001', inr(5_000));
      const own = await request(server(app)).get(`/api/payouts/${created.body.data.id}`).set('X-API-Key', A.key);
      const other = await request(server(app)).get(`/api/payouts/${created.body.data.id}`).set('X-API-Key', B.key);
      const missing = await request(server(app)).get('/api/payouts/00000000-0000-4000-8000-000000000000').set('X-API-Key', B.key);

      expect(own.status).toBe(200);
      expect(own.body.data.id).toBe(created.body.data.id);
      expect(other.status).toBe(404);
      expect(other.body.error).toEqual(missing.body.error);
    });

    it("merchant B's transaction list never contains merchant A's entries", async () => {
      await pay(app, A.key, 'idem-private-02', 'BEN_ACME_001', inr(5_000));
      const res = await request(server(app)).get('/api/transactions').set('X-API-Key', B.key);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.data[0].type).toBe('CREDIT');
    });

    it('rejects a malformed payout id with 400', async () => {
      const res = await request(server(app)).get('/api/payouts/not-a-uuid').set('X-API-Key', A.key);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/transactions: filtering and pagination', () => {
    beforeEach(async () => {
      await pay(app, A.key, 'idem-list-0001', 'BEN_OK_001', inr(1_000));
      await pay(app, A.key, 'idem-list-0002', 'BEN_OK_002', inr(2_000));
      await pay(app, A.key, 'idem-list-0003', 'BEN_FAIL_003', inr(3_000));
      await pay(app, A.key, 'idem-list-0004', 'BEN_PEND_004', inr(4_000));
    });

    it('filters by payout status', async () => {
      const failed = await request(server(app)).get('/api/transactions?status=FAILED').set('X-API-Key', A.key);
      expect(failed.body.data.total).toBe(2);
      expect(failed.body.data.data.map((r: any) => r.type).sort()).toEqual(['PAYOUT_RESERVE', 'PAYOUT_REVERSAL']);
      expect(failed.body.data.data.every((r: any) => r.payout_status === 'FAILED')).toBe(true);

      const pending = await request(server(app)).get('/api/transactions?status=PENDING').set('X-API-Key', A.key);
      expect(pending.body.data.total).toBe(1);
    });

    it('filters by ledger type and rejects invalid filter values', async () => {
      const credits = await request(server(app)).get('/api/transactions?type=CREDIT').set('X-API-Key', A.key);
      expect(credits.body.data.total).toBe(1);
      expect((await request(server(app)).get('/api/transactions?status=BOGUS').set('X-API-Key', A.key)).status).toBe(400);
      expect((await request(server(app)).get('/api/transactions?limit=1000').set('X-API-Key', A.key)).status).toBe(400);
    });

    it('paginates newest-first without overlap', async () => {
      const all = await request(server(app)).get('/api/transactions?limit=100').set('X-API-Key', A.key);
      const p1 = await request(server(app)).get('/api/transactions?limit=3&page=1').set('X-API-Key', A.key);
      const p2 = await request(server(app)).get('/api/transactions?limit=3&page=2').set('X-API-Key', A.key);
      const p3 = await request(server(app)).get('/api/transactions?limit=3&page=3').set('X-API-Key', A.key);

      expect(all.body.data.total).toBe(8);
      expect(p1.body.data.data).toHaveLength(3);
      expect(p2.body.data.data).toHaveLength(3);
      expect(p3.body.data.data).toHaveLength(2);
      expect([...p1.body.data.data, ...p2.body.data.data, ...p3.body.data.data].map((r: any) => r.id)).toEqual(all.body.data.data.map((r: any) => r.id));
    });
  });

  describe('responses expose masked data only', () => {
    it('masks the beneficiary reference and hides internal fields', async () => {
      const res = await pay(app, A.key, 'idem-mask-0001', 'ACCT_1234567890', inr(1_000));
      expect(res.body.data.beneficiary_ref).toBe('***********7890');
      expect(JSON.stringify(res.body)).not.toContain('ACCT_1234567890');
      expect(res.body.data).not.toHaveProperty('request_hash');
      expect(res.body.data).not.toHaveProperty('merchant_id');
    });
  });

  describe('ledger is append-only', () => {
    it('the database rejects UPDATE and DELETE on ledger entries', async () => {
      await expect(db.query('UPDATE ledger_entries SET amount_paise = 1')).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM ledger_entries')).rejects.toThrow(/append-only/);
    });

    it('the database refuses a negative wallet balance even if the app were buggy', async () => {
      await expect(db.query('UPDATE wallets SET available_paise = -1 WHERE merchant_id = $1', [A.id])).rejects.toThrow(/check constraint/);
    });
  });
});
