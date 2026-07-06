-- Receipt field-level audit trail
-- Tracks every amendment to receipt fields with old/new values

CREATE TABLE receipt_field_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id UUID NOT NULL REFERENCES proof_of_payment_receipt(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_receipt_audit_receipt_id ON receipt_field_audit(receipt_id);
CREATE INDEX idx_receipt_audit_changed_at ON receipt_field_audit(changed_at);

-- Add field_confidence JSONB column to store per-field confidence from LLM
ALTER TABLE proof_of_payment_receipt ADD COLUMN IF NOT EXISTS field_confidence JSONB;

-- Enable RLS on the audit table
ALTER TABLE receipt_field_audit ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write audit records
CREATE POLICY "authenticated_all" ON receipt_field_audit
  FOR ALL USING (auth.role() = 'authenticated');
