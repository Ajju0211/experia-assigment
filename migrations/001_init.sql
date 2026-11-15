-- All money is stored as BIGINT paise (1 INR = 100 paise). No floats anywhere.

CREATE TABLE merchants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  api_key_hash  TEXT NOT NULL UNIQUE,            -- SHA-256 of the API key; the raw key is never stored
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One wallet per merchant.
--   available_paise : can be spent on new payouts
--   reserved_paise  : held for payouts that are in flight (bank has not confirmed yet)
-- The CHECK constraints are the last line of defence: even a buggy query cannot make a balance negative.
CREATE TABLE wallets (
  merchant_id      UUID PRIMARY KEY REFERENCES merchants(id),
  available_paise  BIGINT NOT NULL DEFAULT 0 CHECK (available_paise >= 0),
  reserved_paise   BIGINT NOT NULL DEFAULT 0 CHECK (reserved_paise  >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id               UUID PRIMARY KEY,
  merchant_id      UUID NOT NULL REFERENCES merchants(id),
  idempotency_key  TEXT NOT NULL,
  request_hash     TEXT NOT NULL,                 -- hash of normalized (beneficiary_ref, amount) to detect key reuse with a different payload
  beneficiary_ref  TEXT NOT NULL,
  amount_paise     BIGINT NOT NULL CHECK (amount_paise > 0),
  status           TEXT NOT NULL CHECK (status IN ('PROCESSING','PENDING','UNKNOWN','SUCCESS','FAILED')),
  bank_reference   TEXT NOT NULL UNIQUE,          -- stable reference sent to the bank; never regenerated
  failure_reason   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, idempotency_key)           -- DB-level guarantee: one payout per (merchant, key)
);
CREATE INDEX payouts_merchant_created_idx ON payouts (merchant_id, created_at DESC);
CREATE INDEX payouts_status_idx ON payouts (status);

-- Immutable audit trail of every status change and who caused it.
CREATE TABLE payout_status_history (
  id          BIGSERIAL PRIMARY KEY,
  payout_id   UUID NOT NULL REFERENCES payouts(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('API','BANK_RESPONSE','WEBHOOK','RECONCILIATION')),
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payout_status_history_payout_idx ON payout_status_history (payout_id, id ASC);

-- Append-only ledger. Every money movement is a row; nothing is ever updated or deleted.
--   CREDIT          available += amount
--   PAYOUT_RESERVE  available -= amount, reserved += amount   (payout accepted)
--   PAYOUT_SETTLE   reserved  -= amount                        (bank confirmed SUCCESS -> money left)
--   PAYOUT_REVERSAL reserved  -= amount, available += amount   (bank confirmed FAILED  -> money returned)
CREATE TABLE ledger_entries (
  id                     BIGSERIAL PRIMARY KEY,
  merchant_id            UUID NOT NULL REFERENCES merchants(id),
  payout_id              UUID REFERENCES payouts(id),
  type                   TEXT NOT NULL CHECK (type IN ('CREDIT','PAYOUT_RESERVE','PAYOUT_SETTLE','PAYOUT_REVERSAL')),
  amount_paise           BIGINT NOT NULL CHECK (amount_paise > 0),
  available_after_paise  BIGINT NOT NULL,         -- balance snapshots make the ledger self-auditing
  reserved_after_paise   BIGINT NOT NULL,
  description            TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((type = 'CREDIT') = (payout_id IS NULL))
);
-- "Exactly once" guarantee at the database level: a payout can have at most ONE reserve, ONE settle, ONE reversal.
CREATE UNIQUE INDEX ledger_once_per_type_per_payout ON ledger_entries (payout_id, type) WHERE payout_id IS NOT NULL;
-- Mutual exclusion: a payout can never have both a settlement and a reversal.
CREATE UNIQUE INDEX ledger_terminal_once_per_payout ON ledger_entries (payout_id) WHERE type IN ('PAYOUT_SETTLE', 'PAYOUT_REVERSAL');
CREATE INDEX ledger_merchant_idx ON ledger_entries (merchant_id, id DESC);
CREATE INDEX ledger_payout_id_idx ON ledger_entries (payout_id) WHERE payout_id IS NOT NULL;

CREATE FUNCTION forbid_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER history_append_only BEFORE UPDATE OR DELETE ON payout_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Every webhook delivery is recorded by the bank's event_id. A repeated event_id is a duplicate.
CREATE TABLE webhook_events (
  event_id        TEXT PRIMARY KEY,
  bank_reference  TEXT NOT NULL,
  status          TEXT NOT NULL,
  result          TEXT NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX webhook_events_bank_ref_idx ON webhook_events (bank_reference);

-- MOCK BANK's own records (stands in for the bank's side of the world; the real bank would be an HTTP API).
CREATE TABLE mock_bank_transfers (
  bank_reference    TEXT PRIMARY KEY,
  beneficiary_ref   TEXT NOT NULL,
  amount_paise      BIGINT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('SUCCESS','FAILED','PENDING')),
  transfer_attempts INT NOT NULL DEFAULT 1,       -- how many times transfer() was called for this reference
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
