# Sample Requests (cURL)

The server runs on `http://localhost:${PORT:-3001}` (default `3000`, or `3001` if configured via `.env`). The database must be migrated and seeded (`npm run migrate && npm run seed`). All API keys and secrets are synthetic demo values.

```bash
PORT=${PORT:-3001}
BASE="http://localhost:$PORT/api"
KEY_A="test_key_acme_00000000000001"        # Acme Test Merchant: INR 1,00,000 (10,000,000 paise)
KEY_B="test_key_globex_0000000000001"       # Globex Test Merchant: INR 50,000 (5,000,000 paise)
ADMIN_TOKEN="demo_admin_token_change_me"
WEBHOOK_SECRET="demo_webhook_secret_change_me"
```

---

## 1. Interactive Swagger / OpenAPI Documentation

Explore and test all endpoints interactively in your browser:
* **Swagger UI:** `http://localhost:3001/api/docs` (also available at `/api/doc` and `/docs`)
* **OpenAPI JSON Spec:** `http://localhost:3001/api/docs-json`

---

## 2. Standard Enterprise API Envelope

Every API response follows a consistent structured JSON envelope:

### Success Envelope
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Success",
  "data": {
    "id": "c7193789-6d8a-4385-be23-d23ab361c3fa",
    "status": "SUCCESS",
    "amount_paise": 2500000,
    "currency": "INR",
    "beneficiary_ref": "***********0001",
    "idempotency_key": "order-1001-payout",
    "bank_reference": "BNK-c7193789-6d8a-4385-be23-d23ab361c3fa",
    "failure_reason": null,
    "created_at": "2026-11-15T11:00:00.000Z",
    "updated_at": "2026-11-15T11:00:00.000Z"
  },
  "path": "/api/payouts",
  "timestamp": "2026-11-15T11:00:00.000Z"
}
```

### Error Envelope
```json
{
  "success": false,
  "statusCode": 409,
  "message": "Idempotency-Key was already used with a different request payload",
  "data": null,
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSED",
    "message": "Idempotency-Key was already used with a different request payload",
    "details": null
  },
  "path": "/api/payouts",
  "timestamp": "2026-11-15T11:00:00.000Z"
}
```

---

## 3. Wallet Inquiries

```bash
# Query available and reserved balances
curl -s "$BASE/wallet" -H "X-API-Key: $KEY_A"
```

---

## 4. Create Payout & Idempotency

### 4.1 Standard Payout (INR 25,000 = 2,500,000 paise)
```bash
curl -s -X POST "$BASE/payouts" \
  -H "X-API-Key: $KEY_A" \
  -H "Idempotency-Key: order-1001-payout" \
  -H "Content-Type: application/json" \
  -d '{"beneficiary_ref":"BEN_ACME_001","amount_paise":2500000}'
```
* **First call:** HTTP `201 Created` — wallet reserved, bank called, funds settled.
* **Replay identical request:** HTTP `200 OK` with header `Idempotent-Replayed: true` and the original payout. No secondary debit.
* **Replay with different payload (e.g. `amount_paise: 3000000`):** HTTP `409 Conflict` (`IDEMPOTENCY_KEY_REUSED`).

### 4.2 Bank Simulation Scenarios (Selected via `beneficiary_ref`)

```bash
# Bank rejection (immediate FAILED; reserved funds released back to available balance)
curl -s -X POST "$BASE/payouts" \
  -H "X-API-Key: $KEY_A" \
  -H "Idempotency-Key: scen-fail-0001" \
  -H "Content-Type: application/json" \
  -d '{"beneficiary_ref":"BEN_FAIL_001","amount_paise":100000}'

# Bank pending (status PENDING; funds stay reserved awaiting webhook or reconciliation)
curl -s -X POST "$BASE/payouts" \
  -H "X-API-Key: $KEY_A" \
  -H "Idempotency-Key: scen-pend-0001" \
  -H "Content-Type: application/json" \
  -d '{"beneficiary_ref":"BEN_PEND_001","amount_paise":100000}'

# Bank timeout (status UNKNOWN; outcome uncertain, funds stay reserved, NO auto-retry)
curl -s -X POST "$BASE/payouts" \
  -H "X-API-Key: $KEY_A" \
  -H "Idempotency-Key: scen-time-0001" \
  -H "Content-Type: application/json" \
  -d '{"beneficiary_ref":"BEN_TIMEOUT_001","amount_paise":100000}'
```

---

## 5. Concurrency & Overspend Protection

Two simultaneous withdrawals of INR 70,000 each against an opening balance of INR 1,00,000:

```bash
curl -s -X POST "$BASE/payouts" -H "X-API-Key: $KEY_A" -H "Idempotency-Key: race-aaaa-0001" -H "Content-Type: application/json" -d '{"beneficiary_ref":"BEN_PEND_A","amount_paise":7000000}' &
curl -s -X POST "$BASE/payouts" -H "X-API-Key: $KEY_A" -H "Idempotency-Key: race-bbbb-0002" -H "Content-Type: application/json" -d '{"beneficiary_ref":"BEN_PEND_B","amount_paise":7000000}' &
wait; echo

# Verify wallet state: available 3,000,000 paise (INR 30,000) / reserved 7,000,000 paise (INR 70,000)
curl -s "$BASE/wallet" -H "X-API-Key: $KEY_A"
```
* Exactly one request succeeds with HTTP `201`; the other is safely rejected with HTTP `422 Unprocessable Entity` (`INSUFFICIENT_FUNDS`).

---

## 6. Read Payouts & Ledger Transactions

```bash
# Read a single payout (merchant-scoped)
curl -s "$BASE/payouts/<PAYOUT_ID>" -H "X-API-Key: $KEY_A"

# Cross-merchant isolation: reading merchant A's payout with merchant B's key returns 404
curl -s "$BASE/payouts/<PAYOUT_ID>" -H "X-API-Key: $KEY_B"

# List ledger entries with pagination and status filtering
curl -s "$BASE/transactions?status=FAILED&page=1&limit=10" -H "X-API-Key: $KEY_A"

# Filter by ledger operation type (CREDIT, PAYOUT_RESERVE, PAYOUT_SETTLE, PAYOUT_REVERSAL)
curl -s "$BASE/transactions?type=PAYOUT_SETTLE&limit=5" -H "X-API-Key: $KEY_A"
```

---

## 7. Signed Bank Webhook Callbacks

Inbound bank notifications require an HMAC-SHA256 signature in the `X-Bank-Signature` header matching `sha256=<hex_digest>` computed over the raw request body:

```bash
BODY='{"event_id":"evt-0001","bank_reference":"<BANK_REFERENCE>","status":"FAILED"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')

curl -s -X POST "$BASE/webhooks/bank" \
  -H "Content-Type: application/json" \
  -H "X-Bank-Signature: sha256=$SIG" \
  -d "$BODY"
```
* **First delivery:** Returns `200 OK` with `{"data":{"result":"APPLIED"}}`.
* **Duplicate delivery:** Returns `200 OK` with `{"data":{"result":"DUPLICATE"}}`.
* **Invalid signature:** Returns `401 Unauthorized`.

*(Optional helper script)*:
```bash
npm run bank:simulate -- <BANK_REFERENCE> FAILED --event-id evt-0001
```

---

## 8. Reconciliation

Identify and safely resolve payouts stuck in `PROCESSING` or `UNKNOWN` by querying bank records:

```bash
# Dry run report (no database updates applied)
curl -s -X POST "$BASE/admin/reconcile?dry_run=true" -H "X-Admin-Token: $ADMIN_TOKEN"

# Execute reconciliation (resolves definitive bank outcomes, flags mismatches for manual review)
curl -s -X POST "$BASE/admin/reconcile" -H "X-Admin-Token: $ADMIN_TOKEN"

# CLI execution
npm run reconcile -- --dry-run
npm run reconcile
```
