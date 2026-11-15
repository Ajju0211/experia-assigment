-- Hardening constraints and performance indexes for payout service

-- 1. Ensure a payout cannot have both a settlement and a reversal
CREATE UNIQUE INDEX IF NOT EXISTS ledger_terminal_once_per_payout
  ON ledger_entries (payout_id)
  WHERE type IN ('PAYOUT_SETTLE', 'PAYOUT_REVERSAL');

-- 2. Index for filtering and reconciling payouts by status
CREATE INDEX IF NOT EXISTS payouts_status_idx
  ON payouts (status);

-- 3. Foreign key performance index on ledger_entries(payout_id)
CREATE INDEX IF NOT EXISTS ledger_payout_id_idx
  ON ledger_entries (payout_id)
  WHERE payout_id IS NOT NULL;

-- 4. Foreign key performance index on payout_status_history(payout_id)
CREATE INDEX IF NOT EXISTS payout_status_history_payout_idx
  ON payout_status_history (payout_id, id ASC);

-- 5. Performance index on webhook_events(bank_reference)
CREATE INDEX IF NOT EXISTS webhook_events_bank_ref_idx
  ON webhook_events (bank_reference);
