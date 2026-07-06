CREATE TABLE IF NOT EXISTS accounting_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number  TEXT,
  amount          DOUBLE PRECISION NOT NULL,
  currency        TEXT DEFAULT 'USD',
  payer_name      TEXT,
  payment_date    TEXT,
  description     TEXT,
  vendor          TEXT,
  cost_center     TEXT,
  account_code    TEXT,
  status          TEXT DEFAULT 'posted',
  notes           TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reconciliation_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_receipt_id    UUID REFERENCES proof_of_payment_receipt(id) ON DELETE SET NULL,
  accounting_entry_id UUID REFERENCES accounting_receipts(id) ON DELETE SET NULL,
  match_type          TEXT NOT NULL DEFAULT 'auto',
  matching_score      DOUBLE PRECISION,
  amount_diff         DOUBLE PRECISION,
  amount_diff_pct     DOUBLE PRECISION,
  date_diff_days      INTEGER,
  matched_fields      JSONB,
  classification      TEXT NOT NULL DEFAULT 'pending',
  classification_rules JSONB,
  human_reviewed      BOOLEAN DEFAULT FALSE,
  reviewed_by         UUID,
  reviewed_at         TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(proof_receipt_id, accounting_entry_id)
);
