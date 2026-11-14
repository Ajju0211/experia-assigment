# Sample requests (cURL)

Server running on `http://localhost:3000`, database seeded (`npm run seed`). All keys are synthetic demo values.

```bash
BASE=http://localhost:3000/api
KEY_A=test_key_acme_00000000000001        # Acme: INR 1,00,000
KEY_B=test_key_globex_0000000000001       # Globex: INR 50,000
```

## Wallet
```bash
curl -s $BASE/wallet -H "X-API-Key: $KEY_A"
```

## Create a payout (INR 25,000 = 2,500,000 paise) – bank answers SUCCESS
```bash
curl -s -X POST $BASE/payouts \
  -H "X-API-Key: $KEY_A" -H "Idempotency-Key: order-1001-payout" -H "Content-Type: application/json" \
  -d '{"beneficiary_ref":"BEN_ACME_001","amount_paise":2500000}'
```
Run the *same* command again → `200` with `Idempotent-Replayed: true`, same payout id, no second debit.
Same key with a different `amount_paise` → `409 IDEMPOTENCY_KEY_REUSED`.

## Bank scenarios (chosen by the beneficiary_ref)
```bash
# FAILED immediately (funds released)
curl -s -X POST $BASE/payouts -H "X-API-Key: $KEY_A" -H "Idempotency-Key: scen-fail-0001" -H "Content-Type: application/json" -d '{"beneficiary_ref":"BEN_FAIL_001","amount_paise":100000}'
# PENDING (funds stay reserved)
curl -s -X POST $BASE/payouts -H "X-API-Key: $KEY_A" -H "Idempotency-Key: scen-pend-0001" -H "Content-Type: application/json" -d '{"beneficiary_ref":"BEN_PEND_001","amount_paise":100000}'
# TIMEOUT -> status UNKNOWN (bank actually succeeded; we never heard back). Use BEN_TIMEOUT_FAIL_001 for "bank actually failed"
curl -s -X POST $BASE/payouts -H "X-API-Key: $KEY_A" -H "Idempotency-Key: scen-time-0001" -H "Content-Type: application/json" -d '{"beneficiary_ref":"BEN_TIMEOUT_001","amount_paise":100000}'
```

## The mandatory concurrency case: 2 × INR 70,000 at the same instant
```bash
curl -s -X POST $BASE/payouts -H "X-API-Key: $KEY_A" -H "Idempotency-Key: race-aaaa-0001" -H "Content-Type: application/json" -d '{"beneficiary_ref":"BEN_PEND_A","amount_paise":7000000}' &
curl -s -X POST $BASE/payouts -H "X-API-Key: $KEY_A" -H "Idempotency-Key: race-bbbb-0002" -H "Content-Type: application/json" -d '{"beneficiary_ref":"BEN_PEND_B","amount_paise":7000000}' &
wait; echo
curl -s $BASE/wallet -H "X-API-Key: $KEY_A"     # available 3,000,000 / reserved 7,000,000 : only one reserved
```
(Needs a fresh INR 1,00,000 balance: `npm run seed -- --reset`.)

## Read payout / transactions
```bash
curl -s $BASE/payouts/<PAYOUT_ID> -H "X-API-Key: $KEY_A"
curl -s $BASE/payouts/<PAYOUT_ID> -H "X-API-Key: $KEY_B"            # other merchant -> 404
curl -s "$BASE/transactions?status=FAILED&page=1&limit=10" -H "X-API-Key: $KEY_A"
curl -s "$BASE/transactions?type=PAYOUT_RESERVE&limit=5"  -H "X-API-Key: $KEY_A"
```

## Signed mock-bank webhook
```bash
SECRET=demo_webhook_secret_change_me
BODY='{"event_id":"evt-0001","bank_reference":"<BANK_REFERENCE from the payout>","status":"FAILED"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
curl -s -X POST $BASE/webhooks/bank -H "Content-Type: application/json" -H "X-Bank-Signature: sha256=$SIG" -d "$BODY"
# run it again -> {"result":"DUPLICATE"};  with a wrong signature -> 401
```
Shortcut that also updates the mock bank's own record: `npm run bank:simulate -- <bank_reference> FAILED --event-id evt-0001`

## Reconciliation
```bash
curl -s -X POST "$BASE/admin/reconcile?dry_run=true" -H "X-Admin-Token: demo_admin_token_change_me"   # report only
curl -s -X POST  $BASE/admin/reconcile               -H "X-Admin-Token: demo_admin_token_change_me"   # resolve
npm run reconcile -- --dry-run                                                                          # same, as a CLI command
```
