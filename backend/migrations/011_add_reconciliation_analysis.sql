ALTER TABLE reconciliation_results
  ADD COLUMN IF NOT EXISTS ai_analysis JSONB;
