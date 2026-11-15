# Test Results

Run on 2026-11-15 against PostgreSQL 16 (real database, not mocked). Command: `npm test` (`jest --runInBand --verbose`).

```
PASS test/hardening.spec.ts
  Hardened Payout System: 16 Core Requirements
    ✓ Scenario 1: Successful payout reserves, settles, and records ledger entries atomically (90 ms)
    ✓ Scenario 2: Insufficient wallet balance rejects payout without altering wallet balances (33 ms)
    ✓ Scenario 3: Same idempotency key with identical payload replays original payout (HTTP 200) (38 ms)
    ✓ Scenario 4: Same idempotency key with different payload returns HTTP 409 Conflict (42 ms)
    ✓ Scenario 5: Concurrent payout requests with the same idempotency key create exactly 1 payout (51 ms)
    ✓ Scenario 6: Concurrent payouts attempting to overspend the wallet serialize and protect balance (38 ms)
    ✓ Scenario 7: Bank success response transitions to SUCCESS and settles wallet (32 ms)
    ✓ Scenario 8: Bank rejection response transitions to FAILED and releases funds immediately (31 ms)
    ✓ Scenario 9: Bank timeout results in UNKNOWN without auto-retry, leaving funds reserved (33 ms)
    ✓ Scenario 10: Duplicate webhook delivery is handled idempotently (46 ms)
    ✓ Scenario 11: Webhook arriving before synchronous bank response is handled safely (35 ms)
    ✓ Scenario 12: Successful wallet settlement executes exactly once (33 ms)
    ✓ Scenario 13: Failed payout releases funds exactly once across multiple failure notices (40 ms)
    ✓ Scenario 14: Invalid state transitions (SUCCESS -> FAILED, FAILED -> SUCCESS) are rejected (39 ms)
    ✓ Scenario 15: Database transaction rollback leaves no orphaned records or partial state (30 ms)
    ✓ Scenario 16: Database unique constraints prevent duplicate ledger operations (48 ms)

PASS test/payouts.spec.ts
  Payouts: concurrency, idempotency, access control
    simultaneous withdrawals (mandatory case)
      ✓ two INR 70,000 requests at the same instant against INR 1,00,000: at most one reserves funds (49 ms)
      ✓ 10 concurrent INR 30,000 requests: exactly 3 succeed, 7 are rejected, balance never goes negative (68 ms)
    idempotency
      ✓ same key + same payload twice: one payout, one debit, same response, bank called once (38 ms)
      ✓ same key sent 5 times concurrently: exactly one payout is created (36 ms)
      ✓ same key with a DIFFERENT payload is rejected (409) and changes nothing (42 ms)
      ✓ idempotency keys are merchant-scoped: two merchants may use the same key (57 ms)
    input validation
      ✓ rejects negative amount with 400 and structured validation details (27 ms)
      ✓ rejects zero amount with 400 and structured validation details (25 ms)
      ✓ rejects fractional paise with 400 and structured validation details (27 ms)
      ✓ rejects amount below INR 1 with 400 and structured validation details (24 ms)
      ✓ rejects bad beneficiary chars with 400 and structured validation details (25 ms)
      ✓ rejects a missing Idempotency-Key and unknown body fields (26 ms)
    merchant authentication and cross-merchant access
      ✓ requires a valid API key (27 ms)
      ✓ merchant B cannot read merchant A's payout (404, same as non-existent) (40 ms)
      ✓ merchant B's transaction list never contains merchant A's entries (36 ms)
      ✓ rejects a malformed payout id with 400 (25 ms)
    GET /api/transactions: filtering and pagination
      ✓ filters by payout status (60 ms)
      ✓ filters by ledger type and rejects invalid filter values (71 ms)
      ✓ paginates newest-first without overlap (62 ms)
    responses expose masked data only
      ✓ masks the beneficiary reference and hides internal fields (32 ms)
    ledger is append-only
      ✓ the database rejects UPDATE and DELETE on ledger entries (32 ms)
      ✓ the database refuses a negative wallet balance even if the app were buggy (25 ms)

PASS test/bank-reconciliation.spec.ts
  Mock bank outcomes and reconciliation
    the four bank responses
      ✓ SUCCESS: funds are settled (50 ms)
      ✓ FAILED: funds are released immediately, exactly once (36 ms)
      ✓ PENDING: funds stay reserved until the bank confirms (30 ms)
    bank TIMEOUT (uncertain outcome)
      ✓ is stored as UNKNOWN, funds stay reserved, and the transfer is NEVER retried (35 ms)
      ✓ reconciliation resolves UNKNOWN -> SUCCESS when the bank actually paid (and is idempotent) (42 ms)
      ✓ reconciliation resolves UNKNOWN -> FAILED when the bank actually rejected: funds released once (36 ms)
    reconciliation safety
      ✓ resolves PENDING when the bank has a final answer (33 ms)
      ✓ never auto-changes a FINAL payout that the bank disagrees with: flags it for manual review (33 ms)
      ✓ does not guess when the bank has no record: flags it for manual review (32 ms)
      ✓ POST /api/admin/reconcile requires the admin token (38 ms)

PASS test/webhooks.spec.ts
  Bank webhooks: authentication, duplicates, reversal safety
    authentication
      ✓ rejects missing, wrong and tampered signatures with 401 and changes nothing (47 ms)
      ✓ rejects a correctly signed but malformed payload with 400 (33 ms)
    processing and duplicates
      ✓ SUCCESS webhook settles the payout (44 ms)
      ✓ the same event delivered twice is processed once (38 ms)
      ✓ the same event delivered 5 times CONCURRENTLY is processed once (41 ms)
      ✓ a webhook for an unknown bank reference is acknowledged and ignored (32 ms)
    reversal safety (funds released exactly once)
      ✓ many DIFFERENT failure events for the same payout still reverse only once (43 ms)
      ✓ a FAILED payout can never become SUCCESS (and vice versa): invalid transitions are ignored (74 ms)
      ✓ webhook failure racing with reconciliation still reverses once (40 ms)

PASS test/redaction.spec.ts
  Sensitive data masking
    ✓ maskTail keeps only the last 4 characters (1 ms)
    ✓ redact hides secrets and masks beneficiary references, including nested values
    application logs
      ✓ never contain the API key or the raw beneficiary reference (23 ms)

PASS test/config.spec.ts
  Configuration System
    validateEnvironment
      ✓ should validate and parse valid environment configuration with defaults (1 ms)
      ✓ should coerce string PORT into an integer
      ✓ should accept custom NODE_ENV and TEST_DATABASE_URL
      ✓ should throw when mandatory DATABASE_URL is missing (4 ms)
      ✓ should throw when mandatory BANK_WEBHOOK_SECRET is missing
      ✓ should throw when mandatory ADMIN_TOKEN is missing
      ✓ should throw when PORT is out of range or not an integer (1 ms)
    AppConfigService
      ✓ should return strongly-typed config values and environment helpers
      ✓ should fall back to default port 3000 if PORT is not set in config or env
      ✓ should throw via getOrThrow when mandatory values are missing (2 ms)
      ✓ should redact secrets in toJSON and util.inspect
    AppConfigModule NestJS Integration
      ✓ should compile AppConfigModule and inject AppConfigService (2 ms)

Test Suites: 6 passed, 6 total
Tests:       72 passed, 72 total
Snapshots:   0 total
Time:        3.666 s, estimated 5 s
Ran all test suites.
```
