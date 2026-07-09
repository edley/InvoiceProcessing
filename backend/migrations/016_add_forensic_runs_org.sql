-- Migration 016: Add org_id to forensic_runs
ALTER TABLE forensic_runs ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_forensic_runs_org ON forensic_runs(org_id);
