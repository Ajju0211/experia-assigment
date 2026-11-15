import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DbService } from '../src/db/db.service';
import { BankAdapter, BankTimeoutError } from '../src/bank/bank.adapter';
import { PayoutsService } from '../src/payouts/payouts.service';
import { canTransition } from '../src/payouts/state-machine';
import {
  A,
  B,
  countLedger,
  createApp,
  expectLedgerConsistent,
  getWallet,
  inr,
  pay,
  resetAndSeed,
  server,
  webhook,
} from './helpers';

describe('Hardened Payout System: 16 Core Requirements', () => {
  let app: INestApplication;
  let db: DbService;

  beforeAll(async () => {
    app = await createApp();
    db = app.get(DbService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetAndSeed(db);
  });

  // 1. Successful payout
  it('Scenario 1: Successful payout reserves, settles, and records ledger entries atomically', async () => {
    const res = await pay(app, A.key, 'idem-scen-01', 'BEN_OK_001', inr(15_000));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('SUCCESS');
    expect(res.body.data.amount_paise).toBe(inr(15_000));

    // Wallet: available decreased, reserved 0
    expect(await getWallet(db, A.id)).toEqual({
      available_paise: inr(85_000),
      reserved_paise: 0,
    });

    // Ledger has exactly 1 reserve and 1 settle
    expect(await countLedger(db, A.id, 'PAYOUT_RESERVE')).toBe(1);
    expect(await countLedger(db, A.id, 'PAYOUT_SETTLE')).toBe(1);
    await expectLedgerConsistent(db, A.id);
  });

  // 2. Insufficient wallet balance
  it('Scenario 2: Insufficient wallet balance rejects payout without altering wallet balances', async () => {
    const res = await pay(app, A.key, 'idem-scen-02', 'BEN_OK_001', inr(150_000));
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');

    // Balance remains untouched
    expect(await getWallet(db, A.id)).toEqual({
      available_paise: A.opening,
      reserved_paise: 0,
    });

    // No payouts or ledger entries created
    const payouts = await db.query('SELECT count(*) as n FROM payouts WHERE merchant_id = $1', [A.id]);
    expect(payouts.rows[0].n).toBe(0);
    expect(await countLedger(db, A.id, 'PAYOUT_RESERVE')).toBe(0);
  });

  // 3. Same idempotency key with identical payload
  it('Scenario 3: Same idempotency key with identical payload replays original payout (HTTP 200)', async () => {
    const first = await pay(app, A.key, 'idem-scen-03', 'BEN_OK_001', inr(10_000));
    expect(first.status).toBe(201);

    const second = await pay(app, A.key, 'idem-scen-03', 'BEN_OK_001', inr(10_000));
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);

    // Only one debit and one payout row
    expect(await getWallet(db, A.id)).toEqual({
      available_paise: inr(90_000),
      reserved_paise: 0,
    });
    const payouts = await db.query('SELECT count(*) as n FROM payouts WHERE merchant_id = $1', [A.id]);
    expect(payouts.rows[0].n).toBe(1);
  });

  // 4. Same idempotency key with different payload
  it('Scenario 4: Same idempotency key with different payload returns HTTP 409 Conflict', async () => {
    const first = await pay(app, A.key, 'idem-scen-04', 'BEN_OK_001', inr(10_000));
    expect(first.status).toBe(201);

    // Try same key with different amount
    const conflictAmount = await pay(app, A.key, 'idem-scen-04', 'BEN_OK_001', inr(20_000));
    expect(conflictAmount.status).toBe(409);
    expect(conflictAmount.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Try same key with different beneficiary
    const conflictBeneficiary = await pay(app, A.key, 'idem-scen-04', 'BEN_OTHER_002', inr(10_000));
    expect(conflictBeneficiary.status).toBe(409);
    expect(conflictBeneficiary.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Balances unchanged from first payout
    expect(await getWallet(db, A.id)).toEqual({
      available_paise: inr(90_000),
      reserved_paise: 0,
    });
  });

  // 5. Concurrent payout requests with the same idempotency key
  it('Scenario 5: Concurrent payout requests with the same idempotency key create exactly 1 payout', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => pay(app, A.key, 'idem-scen-05', 'BEN_OK_001', inr(10_000))),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(4);

    const ids = new Set(results.map((r) => r.body.data.id));
    expect(ids.size).toBe(1);

    expect(await getWallet(db, A.id)).toEqual({
      available_paise: inr(90_000),
      reserved_paise: 0,
    });
    expect(await countLedger(db, A.id, 'PAYOUT_RESERVE')).toBe(1);
  });

  // 6. Concurrent payouts attempting to overspend the wallet
  it('Scenario 6: Concurrent payouts attempting to overspend the wallet serialize and protect balance', async () => {
    // Balance is 1,00,000. Send two simultaneous requests of 70,000 each.
    const [r1, r2] = await Promise.all([
      pay(app, A.key, 'idem-overspend-1', 'BEN_PEND_01', inr(70_000)),
      pay(app, A.key, 'idem-overspend-2', 'BEN_PEND_02', inr(70_000)),
    ]);

    expect([r1.status, r2.status].sort()).toEqual([201, 422]);
    const wallet = await getWallet(db, A.id);
    expect(wallet.available_paise).toBe(inr(30_000));
    expect(wallet.reserved_paise).toBe(inr(70_000));
    expect(wallet.available_paise).toBeGreaterThanOrEqual(0);
    expect(wallet.reserved_paise).toBeGreaterThanOrEqual(0);
  });

  // 7. Bank success response
  it('Scenario 7: Bank success response transitions to SUCCESS and settles wallet', async () => {
    const res = await pay(app, A.key, 'idem-bank-scen-07', 'BEN_OK_001', inr(5_000));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('SUCCESS');
    expect(res.body.data.failure_reason).toBeNull();

    expect(await countLedger(db, A.id, 'PAYOUT_SETTLE')).toBe(1);
    expect(await countLedger(db, A.id, 'PAYOUT_REVERSAL')).toBe(0);
    expect(await getWallet(db, A.id)).toEqual({
      available_paise: inr(95_000),
      reserved_paise: 0,
    });
  });

  // 8. Bank rejection response
  it('Scenario 8: Bank rejection response transitions to FAILED and releases funds immediately', async () => {
    const res = await pay(app, A.key, 'idem-bank-scen-08', 'BEN_FAIL_001', inr(5_000));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('FAILED');
    expect(res.body.data.failure_reason).toBe('Rejected by bank (mock)');

    // Available balance restored
    expect(await getWallet(db, A.id)).toEqual({
      available_paise: A.opening,
      reserved_paise: 0,
    });
    expect(await countLedger(db, A.id, 'PAYOUT_RESERVE')).toBe(1);
    expect(await countLedger(db, A.id, 'PAYOUT_REVERSAL')).toBe(1);
    expect(await countLedger(db, A.id, 'PAYOUT_SETTLE')).toBe(0);
  });

  // 9. Bank timeout resulting in UNKNOWN
  it('Scenario 9: Bank timeout results in UNKNOWN without auto-retry, leaving funds reserved', async () => {
    const res = await pay(app, A.key, 'idem-bank-scen-09', 'BEN_TIMEOUT_001', inr(10_000));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('UNKNOWN');
    expect(res.body.data.failure_reason).toContain('Bank timeout - outcome unknown');

    // Funds stay reserved (not lost, not released)
    expect(await getWallet(db, A.id)).toEqual({
      available_paise: inr(90_000),
      reserved_paise: inr(10_000),
    });

    // Bank transfer called exactly once (no auto-retry)
    const attempts = await db.query(
      'SELECT transfer_attempts FROM mock_bank_transfers WHERE bank_reference = $1',
      [res.body.data.bank_reference],
    );
    expect(attempts.rows[0].transfer_attempts).toBe(1);
  });

  // 10. Duplicate webhook delivery
  it('Scenario 10: Duplicate webhook delivery is handled idempotently', async () => {
    const p = await pay(app, A.key, 'idem-scen-10', 'BEN_PEND_001', inr(10_000));
    const bankRef = p.body.data.bank_reference;

    const first = await webhook(app, {
      event_id: 'evt-scen-10',
      bank_reference: bankRef,
      status: 'FAILED',
    });
    expect(first.status).toBe(200);
    expect(first.body.data.result).toBe('APPLIED');

    const second = await webhook(app, {
      event_id: 'evt-scen-10',
      bank_reference: bankRef,
      status: 'FAILED',
    });
    expect(second.status).toBe(200);
    expect(second.body.data.result).toBe('DUPLICATE');

    expect(await countLedger(db, A.id, 'PAYOUT_REVERSAL')).toBe(1);
    expect(await getWallet(db, A.id)).toEqual({
      available_paise: A.opening,
      reserved_paise: 0,
    });
  });

  // 11. Webhook arriving before synchronous bank response
  it('Scenario 11: Webhook arriving before synchronous bank response is handled safely', async () => {
    // We create a payout in PENDING
    const p = await pay(app, A.key, 'idem-scen-11', 'BEN_PEND_001', inr(12_000));
    const payoutId = p.body.data.id;
    const bankRef = p.body.data.bank_reference;

    // Webhook arrives first and settles
    const hookRes = await webhook(app, {
      event_id: 'evt-scen-11',
      bank_reference: bankRef,
      status: 'SUCCESS',
    });
    expect(hookRes.body.data.result).toBe('APPLIED');

    // Now late synchronous response or reconciliation attempts to transition to SUCCESS
    const payoutsService = app.get(PayoutsService);
    const syncTransition = await db.tx((c) =>
      payoutsService.transition(c, payoutId, 'SUCCESS', 'BANK_RESPONSE'),
    );
    expect(syncTransition.applied).toBe(false);
    expect(syncTransition.reason).toBe('NO_CHANGE');

    // Settle happened exactly once
    expect(await countLedger(db, A.id, 'PAYOUT_SETTLE')).toBe(1);
    expect(await getWallet(db, A.id)).toEqual({
      available_paise: inr(88_000),
      reserved_paise: 0,
    });
  });

  // 12. Successful wallet settlement exactly once
  it('Scenario 12: Successful wallet settlement executes exactly once', async () => {
    const p = await pay(app, A.key, 'idem-scen-12', 'BEN_OK_001', inr(20_000));
    const bankRef = p.body.data.bank_reference;

    // Redundant webhook delivery
    const hookRes = await webhook(app, {
      event_id: 'evt-scen-12-redundant',
      bank_reference: bankRef,
      status: 'SUCCESS',
    });
    expect(hookRes.body.data.result).toBe('NO_CHANGE');

    expect(await countLedger(db, A.id, 'PAYOUT_SETTLE')).toBe(1);
    expect(await getWallet(db, A.id)).toEqual({
      available_paise: inr(80_000),
      reserved_paise: 0,
    });
  });

  // 13. Failed payout releasing funds exactly once
  it('Scenario 13: Failed payout releases funds exactly once across multiple failure notices', async () => {
    const p = await pay(app, A.key, 'idem-scen-13', 'BEN_PEND_001', inr(25_000));
    const bankRef = p.body.data.bank_reference;

    // Send 3 distinct failure webhooks
    const w1 = await webhook(app, { event_id: 'evt-13-a', bank_reference: bankRef, status: 'FAILED' });
    const w2 = await webhook(app, { event_id: 'evt-13-b', bank_reference: bankRef, status: 'FAILED' });
    const w3 = await webhook(app, { event_id: 'evt-13-c', bank_reference: bankRef, status: 'FAILED' });

    expect(w1.body.data.result).toBe('APPLIED');
    expect(w2.body.data.result).toBe('NO_CHANGE');
    expect(w3.body.data.result).toBe('NO_CHANGE');

    expect(await countLedger(db, A.id, 'PAYOUT_REVERSAL')).toBe(1);
    expect(await getWallet(db, A.id)).toEqual({
      available_paise: A.opening,
      reserved_paise: 0,
    });
  });

  // 14. Invalid state transitions
  it('Scenario 14: Invalid state transitions (SUCCESS -> FAILED, FAILED -> SUCCESS) are rejected', async () => {
    // 14a. Terminal rules in state machine
    expect(canTransition('SUCCESS', 'FAILED')).toBe(false);
    expect(canTransition('FAILED', 'SUCCESS')).toBe(false);
    expect(canTransition('SUCCESS', 'PROCESSING')).toBe(false);
    expect(canTransition('FAILED', 'UNKNOWN')).toBe(false);

    // 14b. Runtime rejection when attempting to flip a SUCCESS payout to FAILED
    const p = await pay(app, A.key, 'idem-scen-14', 'BEN_OK_001', inr(5_000));
    const bankRef = p.body.data.bank_reference;

    const lateFail = await webhook(app, {
      event_id: 'evt-scen-14-flip',
      bank_reference: bankRef,
      status: 'FAILED',
    });
    expect(lateFail.body.data.result).toBe('INVALID_TRANSITION');
    expect(await countLedger(db, A.id, 'PAYOUT_REVERSAL')).toBe(0);
    expect(await countLedger(db, A.id, 'PAYOUT_SETTLE')).toBe(1);
  });

  // 15. Database rollback during payout processing
  it('Scenario 15: Database transaction rollback leaves no orphaned records or partial state', async () => {
    // Attempt payout exceeding funds to trigger transaction rollback
    await pay(app, A.key, 'idem-scen-15', 'BEN_OK_001', inr(200_000));

    // Verify no payouts inserted
    const payouts = await db.query('SELECT * FROM payouts WHERE idempotency_key = $1', ['idem-scen-15']);
    expect(payouts.rows).toHaveLength(0);

    // Verify no ledger entries written
    const ledger = await db.query(
      "SELECT * FROM ledger_entries WHERE description LIKE '%idem-scen-15%' OR amount_paise = $1",
      [inr(200_000)],
    );
    expect(ledger.rows).toHaveLength(0);

    // Wallet balances unaltered
    expect(await getWallet(db, A.id)).toEqual({
      available_paise: A.opening,
      reserved_paise: 0,
    });
  });

  // 16. Duplicate ledger operation prevention
  it('Scenario 16: Database unique constraints prevent duplicate ledger operations', async () => {
    const p = await pay(app, A.key, 'idem-scen-16', 'BEN_OK_001', inr(10_000));
    const payoutId = p.body.data.id;

    // Attempting to manually insert a duplicate PAYOUT_SETTLE violates unique index
    await expect(
      db.query(
        `INSERT INTO ledger_entries (merchant_id, payout_id, type, amount_paise, available_after_paise, reserved_after_paise, description)
         VALUES ($1, $2, 'PAYOUT_SETTLE', 1000000, 9000000, 0, 'Duplicate settle attempt')`,
        [A.id, payoutId],
      ),
    ).rejects.toThrow(/ledger_once_per_type_per_payout|duplicate key value violates unique constraint/);

    // Attempting to insert a PAYOUT_REVERSAL for an already settled payout violates ledger_terminal_once_per_payout
    await expect(
      db.query(
        `INSERT INTO ledger_entries (merchant_id, payout_id, type, amount_paise, available_after_paise, reserved_after_paise, description)
         VALUES ($1, $2, 'PAYOUT_REVERSAL', 1000000, 10000000, 0, 'Illegal reversal attempt')`,
        [A.id, payoutId],
      ),
    ).rejects.toThrow(/ledger_terminal_once_per_payout|duplicate key value violates unique constraint/);
  });
});
