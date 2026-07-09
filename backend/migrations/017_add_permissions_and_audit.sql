-- 017_add_permissions_and_audit.sql
-- Adds: is_platform_admin to user_profiles, permissions to organization_members, audit_log table

-- 1. Add is_platform_admin to user_profiles
ALTER TABLE IF EXISTS user_profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT false;

-- 2. Add permissions JSONB to organization_members
ALTER TABLE IF EXISTS organization_members
  ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb;

-- 3. Create audit_log table
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org_id ON audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_admin_view_audit_log" ON audit_log;
CREATE POLICY "platform_admin_view_audit_log" ON audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_platform_admin = true
    )
  );

DROP POLICY IF EXISTS "org_admin_view_audit_log" ON audit_log;
CREATE POLICY "org_admin_view_audit_log" ON audit_log FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- 4. Grant service role full access
GRANT ALL ON audit_log TO service_role;
