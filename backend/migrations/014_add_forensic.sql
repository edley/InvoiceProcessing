-- Forensic analysis tables for Benford's Law, duplicate detection, anomaly scoring

CREATE TABLE IF NOT EXISTS forensic_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id UUID REFERENCES proof_of_payment_receipt(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL CHECK (analysis_type IN ('benford', 'duplicate', 'anomaly')),
  score DOUBLE PRECISION,
  flag TEXT NOT NULL,
  details JSONB,
  duplicate_group_id TEXT,
  dismissed BOOLEAN DEFAULT FALSE,
  dismissed_by UUID,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_forensic_flags_receipt ON forensic_flags(receipt_id);
CREATE INDEX idx_forensic_flags_type ON forensic_flags(analysis_type);
CREATE INDEX idx_forensic_flags_flag ON forensic_flags(flag);
CREATE INDEX idx_forensic_flags_dup_group ON forensic_flags(duplicate_group_id);

ALTER TABLE forensic_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON forensic_flags
  FOR ALL USING (auth.role() = 'authenticated');

-- Add forensic run tracking
CREATE TABLE IF NOT EXISTS forensic_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  progress INT DEFAULT 0,
  total_steps INT DEFAULT 3,
  current_step TEXT,
  results JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE forensic_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON forensic_runs
  FOR ALL USING (auth.role() = 'authenticated');
