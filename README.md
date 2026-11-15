# Merchant Payout Service

A miniature merchant payout backend: wallet + append-only ledger, idempotent payout initiation, a mock bank
(SUCCESS / FAILED / PENDING / TIMEOUT), signed webhooks, and reconciliation.
Built for the Experia360 backend assessment. **Everything is synthetic**: mock bank, fake merchants, demo keys. No real bank, provider, customer data or credentials.

**Stack:** Node.js 20+ · NestJS 11 · PostgreSQL 16 (via `pg`, plain SQL) · Jest + Supertest

---

## 1. Quick start

Requirements: Node 20+ and PostgreSQL 14+ (or Docker).

```bash
npm install
cp .env.example .env                 # demo-only values
docker compose up -d db              # PostgreSQL 16 on :5432, creates database "payouts" (or use your own PostgreSQL, see below)
npm run migrate                      # creates tables (migrations/001_init.sql)
npm run seed                         # creates 2 test merchants (prints their API keys)
npm start                            # http://localhost:3001/api (or :3000)
```

Interactive Swagger documentation & testing UI: `http://localhost:3001/api/docs` (or `/api/doc`, `/docs`).

If you use your own PostgreSQL instead of Docker: run `createdb payouts` and adjust `DATABASE_URL` / `TEST_DATABASE_URL` in `.env`.
`npm test` creates the `payouts_test` database itself (the DB user needs CREATEDB permission).

**Seed data**

| Merchant | API key (`X-API-Key`) | Opening balance |
|---|---|---|
| Acme Test Merchant | `test_key_acme_00000000000001` | INR 1,00,000 (10,000,000 paise) |
| Globex Test Merchant | `test_key_globex_0000000000001` | INR 50,000 (second merchant, used for cross-merchant tests) |

`npm run seed -- --reset` wipes the dev database and re-seeds (handy before a demo).

## 2. Running the tests

```bash
npm test
```

Tests run against a **real PostgreSQL** database (`payouts_test`, wiped between tests) because concurrency guarantees
cannot be proven with a mock. 72 tests, ~4 s. Latest output: [`docs/TEST_RESULTS.md`](docs/TEST_RESULTS.md).

| Required test | Where |
|---|---|
| Hardened core requirements (16 scenarios: idempotency, balance safety, bank failures, rollbacks) | `test/hardening.spec.ts` |
| Simultaneous withdrawals (2 × INR 70,000; and 10 × INR 30,000) | `test/payouts.spec.ts` |
| Repeated idempotency keys (sequential, concurrent, different payload, merchant-scoped) | `test/payouts.spec.ts` |
| Cross-merchant access & authentication | `test/payouts.spec.ts` |
| Bank timeout (UNKNOWN, no retry, reconcile to SUCCESS or FAILED) | `test/bank-reconciliation.spec.ts` |
| Duplicate webhooks (sequential and 5× concurrent) | `test/webhooks.spec.ts` |
| Reversal safety (6 distinct failure events, FAILED→SUCCESS flip, webhook vs reconciliation race) | `test/webhooks.spec.ts` |
| Validation, masking in logs/responses, append-only ledger, negative-balance constraint | `payouts.spec.ts`, `redaction.spec.ts` |
| Strongly typed configuration, startup validation, secret redaction | `test/config.spec.ts` |

Every scenario ends by checking an **accounting invariant** (`expectLedgerConsistent`): wallet balances must equal what the ledger sums to.

## 3. Sample requests

* `bash scripts/demo.sh`: runs a 12-step end-to-end demo with cURL (needs the server running and `npm run seed -- --reset`).
* [`docs/sample-requests.md`](docs/sample-requests.md): individual cURL commands, response envelopes, and webhook signing walkthrough.

## 4. API

All paths are under `/api`. Interactive documentation is at `/api/docs`.
Responses follow a standard enterprise envelope:
* **Success:** `{ "success": true, "statusCode": 200, "message": "Success", "data": { ... }, "path": "...", "timestamp": "..." }`
* **Error:** `{ "success": false, "statusCode": 400, "message": "...", "data": null, "error": { "code": "...", "message": "...", "details": [...] }, "path": "...", "timestamp": "..." }`

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /payouts` | `X-API-Key` + `Idempotency-Key` header | Create a payout. Body: `{ "beneficiary_ref": "BEN_ACME_001", "amount_paise": 7000000 }`. `201` created, `200` replay of same key |
| `GET /payouts/:id` | `X-API-Key` | Read one of **your** payouts (others → `404`) |
| `GET /transactions` | `X-API-Key` | Your ledger, newest first. Query: `status` (payout status), `type` (ledger type), `page`, `limit` (≤100) |
| `GET /wallet` | `X-API-Key` | Convenience: available / reserved balance |
| `POST /webhooks/bank` | `X-Bank-Signature: sha256=<HMAC>` | Mock bank callback |
| `POST /admin/reconcile?dry_run=true` | `X-Admin-Token` | Run reconciliation (also available as `npm run reconcile [-- --dry-run]`) |

Common error codes: `UNAUTHENTICATED` 401, `VALIDATION_ERROR` 400, `INVALID_IDEMPOTENCY_KEY` 400,
`INSUFFICIENT_FUNDS` 422, `IDEMPOTENCY_KEY_REUSED` 409, `PAYOUT_NOT_FOUND` 404, `INVALID_SIGNATURE` 401.

**Payout statuses:** `PROCESSING` (funds reserved, bank not answered) → `PENDING` (bank accepted, not final) / `UNKNOWN` (timeout, outcome not known) → `SUCCESS` or `FAILED` (final).

## 5. Architecture

```
 Merchant ──POST /payouts──► PayoutsController ─► PayoutsService ─► WalletService ─► PostgreSQL
                                     │                  │
                                     │                  └─► BankAdapter (interface) ─► MockBankAdapter
 Bank ──signed webhook──► WebhooksController ─► WebhooksService ─┐
 Operator ──reconcile──► ReconciliationService ──────────────────┴─► PayoutsService.transition()
```

* **`WalletService`** is the *only* code that changes balances. Each operation updates the wallet **and** appends a ledger row in the same DB transaction.
* **`PayoutsService.transition()`** is the *only* code that changes a payout's status. The bank's immediate response, the webhook and reconciliation all go through it, so the rules live in exactly one place.
* **`BankAdapter`** is an abstract class; `MockBankAdapter` implements it. A real bank client would replace it without touching anything else.

### 5.1 Money model

Amounts are **integer paise** (`BIGINT`), never floats. Each wallet has two buckets:

| Ledger entry | available | reserved | When |
|---|---|---|---|
| `CREDIT` | + | | opening balance / top-up |
| `PAYOUT_RESERVE` | − | + | payout accepted |
| `PAYOUT_SETTLE` | | − | bank confirmed SUCCESS (money left) |
| `PAYOUT_REVERSAL` | + | − | bank confirmed FAILED (money returned) |

Reserving first means funds are held *while the bank is deciding*, so they cannot be spent twice. The ledger is **append-only**
(DB triggers reject `UPDATE`/`DELETE`) and every row stores the balances after it, so it is self-auditing.

### 5.2 Concurrency: how two simultaneous INR 70,000 requests are handled

Three independent layers, so no single bug can overspend:

1. **Row lock.** `POST /payouts` starts a transaction and runs `SELECT … FROM wallets WHERE merchant_id = $1 FOR UPDATE`. A second request for the same merchant waits until the first commits.
2. **Atomic check-and-debit.** `UPDATE wallets SET available = available - X … WHERE available >= X` is a single statement: the "enough money?" check and the debit cannot be separated. Zero rows updated → `INSUFFICIENT_FUNDS`, and the transaction (including the payout row it inserted) rolls back.
3. **DB constraint.** `CHECK (available_paise >= 0)` makes a negative balance impossible even if the application code is wrong.

The bank call happens **outside** the DB transaction: DB locks are never held while waiting on the network.
Flow: `TX1 { lock → idempotency lookup → insert payout → reserve } → bank call → TX2 { transition() }`.

### 5.3 Idempotency

`UNIQUE (merchant_id, idempotency_key)` plus a stored hash of `(beneficiary_ref, amount)`.
Same key + same payload → the existing payout is returned (`200`, header `Idempotent-Replayed: true`), the bank is **not** called again.
Same key + different payload → `409`. Keys are merchant-scoped. Because the idempotency check runs *after* the wallet lock, concurrent duplicates are serialised: exactly one creates the payout.

### 5.4 Mock bank and uncertain outcomes

The beneficiary reference chooses the scenario (case-insensitive substring):

| `beneficiary_ref` contains | Bank answers | Our payout becomes |
|---|---|---|
| *(anything else)* | SUCCESS | `SUCCESS` |
| `FAIL` | FAILED | `FAILED` (funds released) |
| `PEND` | PENDING | `PENDING` (funds stay reserved) |
| `TIMEOUT` | *really succeeded*, but the call times out | `UNKNOWN` |
| `TIMEOUT_FAIL` | *really failed*, but the call times out | `UNKNOWN` |

Each payout has a stable `bank_reference` (`BNK-<payout id>`), generated once. The mock bank deduplicates by it, as a real bank would.
**A timeout is never treated as a failure and never retried:** the money may already have moved. The payout stays `UNKNOWN` with funds reserved until a webhook or reconciliation reveals the truth. Any error talking to the bank is handled the same way; only an *explicit* FAILED releases funds.

### 5.5 Webhooks

`POST /api/webhooks/bank` is authenticated with **HMAC-SHA256 over the raw request body** (`X-Bank-Signature: sha256=<hex>`), compared in constant time, by a guard that runs *before* the body is parsed.
Body: `{ "event_id": "...", "bank_reference": "...", "status": "SUCCESS|FAILED|PENDING" }`.

* **Duplicates:** `event_id` is a primary key in `webhook_events`; a repeat is answered `200 {"result":"DUPLICATE"}` and does nothing. Concurrent duplicates are safe (the second insert waits for the first, then conflicts).
* **Atomic:** recording the event and updating the payout are one transaction. If processing crashes, nothing is recorded and the bank's retry is processed normally.
* **Valid transitions only:** `transition()` locks the payout row and checks the state machine. Different events for the same outcome → `NO_CHANGE`; a contradictory event (e.g. SUCCESS after FAILED) → `INVALID_TRANSITION`, ignored and logged. Funds are therefore released/settled **at most once**, enforced again by `UNIQUE (payout_id, ledger type)` on the ledger.
* Valid signed events always get `200` (even duplicates/ignored) so the bank doesn't retry forever.

```
PROCESSING ─► PENDING ─► SUCCESS | FAILED
     │            ▲
     └─► UNKNOWN ─┘ ─► SUCCESS | FAILED          (SUCCESS and FAILED are final)
     └─► SUCCESS | FAILED | PENDING
```

### 5.6 Reconciliation

`npm run reconcile` (or `POST /api/admin/reconcile`, optionally `dry_run=true`) compares every local payout with the bank's record:

| Situation | Action |
|---|---|
| Same status | matched |
| Local not final, bank has an answer | **resolved** through `transition()` (money effects included) |
| Local **final**, bank disagrees | **never auto-changed**, reported for manual review |
| Bank has no record (`NOT_FOUND`) | reported for manual review (we can't prove the transfer didn't happen) |

It is safe to run repeatedly and concurrently with webhooks (both go through the row-locked `transition()`).
Every status change is stored in `payout_status_history` with its source (`API`, `BANK_RESPONSE`, `WEBHOOK`, `RECONCILIATION`).

### 5.7 Security and masking

* Merchant auth by API key; only its **SHA-256 hash** is stored. The merchant is taken from the key, never from the request body (unknown body fields are rejected).
* Every read is scoped by `merchant_id` in SQL. Other merchants' payouts return `404` identical to "does not exist".
* `beneficiary_ref` is masked in API responses (`***********7890`). Logs go through `redact()`: API keys, signatures and tokens become `[REDACTED]`, beneficiary references are masked. A test captures real log output and asserts no secret appears.
* Webhook and admin secrets are compared in constant time. Internal errors return a generic `500`.

## 6. Why PostgreSQL

Row-level locks (`FOR UPDATE`), atomic conditional `UPDATE`s, `CHECK` constraints, partial unique indexes and triggers let the database itself enforce the money rules. A document store would push those guarantees into application code.
I used plain SQL through `pg` instead of an ORM so every locking statement is visible and explainable.

## 7. Assumptions

* Currency is INR only. Payout amount: INR 1 – INR 1 crore, integer paise.
* `beneficiary_ref` is an opaque, pre-registered reference (a real system would validate it against a beneficiary table).
* A payout rejected for `INSUFFICIENT_FUNDS` is **not persisted**; retrying the same key later is evaluated fresh. (Alternative: persist rejections and replay them.)
* `GET /transactions` returns ledger entries joined with their payout's status; `status` filters on the payout status, so credits have no status and are excluded when filtering.
* One bank, one webhook secret. Credits happen only via seed (no top-up endpoint was requested).
* The mock bank's records live in the same database (table `mock_bank_transfers`) purely for convenience; they stand for the bank's side.

## 8. Trade-offs

* **Per-merchant wallet lock** serialises one merchant's payout creation (simple and provably correct) at the cost of per-merchant throughput. Different merchants run fully in parallel. The lock is held only for a few milliseconds because the bank call is outside it.
* **Reserve-then-settle** costs an extra bucket and ledger rows, but makes in-flight money explicit and reversals trivial.
* **Offset pagination** is simple; keyset pagination would scale better for very large ledgers.
* **`BIGINT` as JS `number`** is exact below 2⁵³ paise (≈ INR 9 × 10¹³); the payout cap keeps us far below it.
* **Unknown ≠ failed** keeps money safe but means funds can stay reserved until reconciliation runs.

## 9. Known limitations

* If the process crashes between TX1 and the bank call, the payout stays `PROCESSING`; reconciliation will flag it (`NOT_FOUND`) for manual review rather than auto-failing it. A production system would add a recovery job / outbox.
* Webhooks have no timestamp/replay window (replays are harmless as duplicates, but a stale-signature window would be better) and a single non-rotating secret.
* No rate limiting, API-key rotation/scopes, or TLS termination (those belong in front of the service).
* Reconciliation scans all payouts; production would batch by time window and run on a schedule. It does not detect bank transfers that have no local payout.
* `beneficiary_ref` is stored in plain text; production should encrypt/tokenise it.
* Mock-bank timeouts are simulated instantly (no real delay), and idempotency records never expire.

## 10. Project layout

```
migrations/001_init.sql          schema (merchants, wallets, payouts, ledger, history, webhook_events, mock bank)
src/wallet/                      WalletService: all balance changes + ledger posting
src/payouts/                     create flow, transition(), state machine, controller, DTOs
src/bank/                        BankAdapter interface + MockBankAdapter
src/webhooks/                    signed webhook endpoint + idempotent processing
src/reconciliation/              ReconciliationService, admin endpoint, CLI
src/transactions/                GET /transactions
src/shared/                      ConfigService, auth guards, redaction, logging/response interceptors, exceptions filter
src/common/                      backward-compatible re-exports
src/db/                          pg pool + transaction helper, migration runner, seed
test/                            72 integration & unit tests (real PostgreSQL)
scripts/                         demo.sh (cURL walkthrough), bank-simulate.ts
docs/                            sample requests, test results
```

Useful scripts: `npm run migrate` · `npm run seed [-- --reset]` · `npm start` · `npm run build && npm run start:prod` · `npm test` · `npm run reconcile` · `npm run bank:simulate -- <bank_reference> <SUCCESS|FAILED> [--event-id <id>]`
