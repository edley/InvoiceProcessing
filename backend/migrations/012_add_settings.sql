-- App settings key-value table for runtime LLM configuration
CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write settings
CREATE POLICY "All users can read settings"
    ON app_settings FOR SELECT
    USING (true);

CREATE POLICY "All users can insert settings"
    ON app_settings FOR INSERT
    WITH CHECK (true);

CREATE POLICY "All users can update settings"
    ON app_settings FOR UPDATE
    USING (true);
