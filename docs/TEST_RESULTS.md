# Test results

Run on 2026-11-14 against PostgreSQL 16 (real database, not mocked). Command: `npm test` (jest --runInBand).

```
PASS test/payouts.spec.ts
  Payouts: concurrency, idempotency, access control
    simultaneous withdrawals (mandatory case)
      ✓ two INR 70,000 requests at the same instant against INR 1,00,000: at most one reserves funds (121 ms)
      ✓ 10 concurrent INR 30,000 requests: exactly 3 succeed, 7 are rejected, balance never goes negative (172 ms)
    idempotency
      ✓ same key + same payload twice: one payout, one debit, same response, bank called once (50 ms)
      ✓ same key sent 5 times concurrently: exactly one payout is created (55 ms)
      ✓ same key with a DIFFERENT payload is rejected (409) and changes nothing (42 ms)
      ✓ idempotency keys are merchant-scoped: two merchants may use the same key (47 ms)
    input validation
      ✓ rejects negative amount with 400 (29 ms)
      ✓ rejects zero amount with 400 (27 ms)
      ✓ rejects fractional paise with 400 (34 ms)
      ✓ rejects amount below INR 1 with 400 (33 ms)
      ✓ rejects bad beneficiary chars with 400 (32 ms)
      ✓ rejects a missing Idempotency-Key and unknown body fields (35 ms)
    merchant authentication and cross-merchant access
      ✓ requires a valid API key (34 ms)
      ✓ merchant B cannot read merchant A's payout (404, same as non-existent) (57 ms)
      ✓ merchant B's transaction list never contains merchant A's entries (42 ms)
      ✓ rejects a malformed payout id with 400 (28 ms)
    GET /api/transactions: filtering and pagination
      ✓ filters by payout status (75 ms)
      ✓ filters by ledger type and rejects invalid filter values (87 ms)
      ✓ paginates newest-first without overlap (98 ms)
    responses expose masked data only
      ✓ masks the beneficiary reference and hides internal fields (33 ms)
    ledger is append-only
      ✓ the database rejects UPDATE and DELETE on ledger entries (58 ms)
      ✓ the database refuses a negative wallet balance even if the app were buggy (26 ms)
PASS test/bank-reconciliation.spec.ts
  Mock bank outcomes and reconciliation
    the four bank responses
      ✓ SUCCESS: funds are settled (49 ms)
      ✓ FAILED: funds are released immediately, exactly once (39 ms)
      ✓ PENDING: funds stay reserved until the bank confirms (31 ms)
    bank TIMEOUT (uncertain outcome)
      ✓ is stored as UNKNOWN, funds stay reserved, and the transfer is NEVER retried (36 ms)
      ✓ reconciliation resolves UNKNOWN -> SUCCESS when the bank actually paid (and is idempotent) (53 ms)
      ✓ reconciliation resolves UNKNOWN -> FAILED when the bank actually rejected: funds released once (40 ms)
    reconciliation safety
      ✓ resolves PENDING when the bank has a final answer (37 ms)
      ✓ never auto-changes a FINAL payout that the bank disagrees with: flags it for manual review (36 ms)
      ✓ does not guess when the bank has no record: flags it for manual review (32 ms)
      ✓ POST /api/admin/reconcile requires the admin token (41 ms)
PASS test/webhooks.spec.ts
  Bank webhooks: authentication, duplicates, reversal safety
    authentication
      ✓ rejects missing, wrong and tampered signatures with 401 and changes nothing (53 ms)
      ✓ rejects a correctly signed but malformed payload with 400 (44 ms)
    processing and duplicates
      ✓ SUCCESS webhook settles the payout (36 ms)
      ✓ the same event delivered twice is processed once (37 ms)
      ✓ the same event delivered 5 times CONCURRENTLY is processed once (71 ms)
      ✓ a webhook for an unknown bank reference is acknowledged and ignored (35 ms)
    reversal safety (funds released exactly once)
      ✓ many DIFFERENT failure events for the same payout still reverse only once (78 ms)
      ✓ a FAILED payout can never become SUCCESS (and vice versa): invalid transitions are ignored (88 ms)
      ✓ webhook failure racing with reconciliation still reverses once (73 ms)
PASS test/redaction.spec.ts
  Sensitive data masking
    ✓ maskTail keeps only the last 4 characters (1 ms)
    ✓ redact hides secrets and masks beneficiary references, including nested values
    application logs
      ✓ never contain the API key or the raw beneficiary reference (24 ms)
Test Suites: 4 passed, 4 total
Tests:       44 passed, 44 total
Snapshots:   0 total
Time:        4.176 s, estimated 6 s
Ran all test suites.
```
