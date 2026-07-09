-- Organizations & multi-tenant workspace

-- 1. Organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  logo_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orgs_slug ON organizations(slug);

-- 2. Organization members (users + roles)
CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'manager', 'viewer')),
  invited_by UUID REFERENCES auth.users(id),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);

-- 3. User profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Rename tenant_id to org_id in payment_proofs (if column exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_proofs' AND column_name='tenant_id') THEN
    ALTER TABLE payment_proofs RENAME COLUMN tenant_id TO org_id;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_payment_proofs_org ON payment_proofs(org_id);
DROP INDEX IF EXISTS idx_payment_proofs_tenant;

-- 5. Add org_id to all other data tables
ALTER TABLE proof_of_payment_receipt ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE accounting_receipts ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE forensic_flags ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE processing_log ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE receipt_field_audit ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_receipt_org ON proof_of_payment_receipt(org_id);
CREATE INDEX IF NOT EXISTS idx_acct_entries_org ON accounting_receipts(org_id);
CREATE INDEX IF NOT EXISTS idx_recon_results_org ON reconciliation_results(org_id);
CREATE INDEX IF NOT EXISTS idx_forensic_flags_org ON forensic_flags(org_id);
CREATE INDEX IF NOT EXISTS idx_processing_log_org ON processing_log(org_id);

-- 6. Updated-at trigger for organizations (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_organizations_updated_at' AND tgrelid = 'organizations'::regclass) THEN
    DROP TRIGGER set_organizations_updated_at ON organizations;
  END IF;
  EXECUTE 'CREATE TRIGGER set_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
END $$;

-- 7. Auto-create org + member on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id UUID;
BEGIN
  INSERT INTO public.organizations (name, slug, created_by)
  VALUES (
    COALESCE(new.raw_user_meta_data ->> 'org_name', 'My Firm'),
    'firm-' || substr(replace(new.id::text, '-', ''), 1, 12),
    new.id
  )
  RETURNING id INTO new_org_id;

  INSERT INTO public.organization_members (org_id, user_id, role)
  VALUES (new_org_id, new.id, 'admin');

  INSERT INTO public.user_profiles (id, display_name)
  VALUES (new.id, COALESCE(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));

  RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 8. RLS policies
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Organizations: members can view, admins can update
DROP POLICY IF EXISTS "members_view_orgs" ON organizations;
CREATE POLICY "members_view_orgs" ON organizations FOR SELECT
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = id AND user_id = auth.uid()));
DROP POLICY IF EXISTS "admins_update_orgs" ON organizations;
CREATE POLICY "admins_update_orgs" ON organizations FOR UPDATE
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = id AND user_id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "service_role_all_orgs" ON organizations;
CREATE POLICY "service_role_all_orgs" ON organizations FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Organization members: admins CRUD, members view
DROP POLICY IF EXISTS "members_view_members" ON organization_members;
CREATE POLICY "members_view_members" ON organization_members FOR SELECT
  USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "admins_manage_members" ON organization_members;
CREATE POLICY "admins_manage_members" ON organization_members FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM organization_members WHERE org_id = org_id AND user_id = auth.uid() AND role = 'admin')
    OR auth.jwt() ->> 'role' = 'service_role'
  );
DROP POLICY IF EXISTS "admins_update_members" ON organization_members;
CREATE POLICY "admins_update_members" ON organization_members FOR UPDATE
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = org_id AND user_id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "admins_delete_members" ON organization_members;
CREATE POLICY "admins_delete_members" ON organization_members FOR DELETE
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = org_id AND user_id = auth.uid() AND role = 'admin'));

-- User profiles: users view own, others view by org membership
DROP POLICY IF EXISTS "users_view_own_profile" ON user_profiles;
CREATE POLICY "users_view_own_profile" ON user_profiles FOR SELECT
  USING (id = auth.uid());
DROP POLICY IF EXISTS "org_members_view_profiles" ON user_profiles;
CREATE POLICY "org_members_view_profiles" ON user_profiles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM organization_members WHERE user_id = user_profiles.id
    AND org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid())
  ));

-- Update RLS on payment_proofs for org-based access
DROP POLICY IF EXISTS "Users can view own tenant proofs" ON payment_proofs;
DROP POLICY IF EXISTS "Users can insert own tenant proofs" ON payment_proofs;
DROP POLICY IF EXISTS "Admins can view all proofs" ON payment_proofs;
DROP POLICY IF EXISTS "Admins can insert any" ON payment_proofs;

DROP POLICY IF EXISTS "org_members_view_proofs" ON payment_proofs;
CREATE POLICY "org_members_view_proofs" ON payment_proofs FOR SELECT
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = payment_proofs.org_id AND user_id = auth.uid()));
DROP POLICY IF EXISTS "org_admins_insert_proofs" ON payment_proofs;
CREATE POLICY "org_admins_insert_proofs" ON payment_proofs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM organization_members WHERE org_id = payment_proofs.org_id AND user_id = auth.uid() AND role IN ('admin', 'manager')));
DROP POLICY IF EXISTS "org_members_update_proofs" ON payment_proofs;
CREATE POLICY "org_members_update_proofs" ON payment_proofs FOR UPDATE
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = payment_proofs.org_id AND user_id = auth.uid() AND role IN ('admin', 'manager')));
DROP POLICY IF EXISTS "org_admins_delete_proofs" ON payment_proofs;
CREATE POLICY "org_admins_delete_proofs" ON payment_proofs FOR DELETE
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = payment_proofs.org_id AND user_id = auth.uid() AND role = 'admin'));

-- Update processing_log RLS
DROP POLICY IF EXISTS "Users can view own tenant logs" ON processing_log;
DROP POLICY IF EXISTS "org_members_view_logs" ON processing_log;
CREATE POLICY "org_members_view_logs" ON processing_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = processing_log.org_id AND user_id = auth.uid()));

-- RLS for receipt, accounting, reconciliation, forensic
DROP POLICY IF EXISTS "org_members_view_receipts" ON proof_of_payment_receipt;
CREATE POLICY "org_members_view_receipts" ON proof_of_payment_receipt FOR SELECT
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = proof_of_payment_receipt.org_id AND user_id = auth.uid()));
DROP POLICY IF EXISTS "org_members_view_accounting" ON accounting_receipts;
CREATE POLICY "org_members_view_accounting" ON accounting_receipts FOR SELECT
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = accounting_receipts.org_id AND user_id = auth.uid()));
DROP POLICY IF EXISTS "org_members_view_reconciliation" ON reconciliation_results;
CREATE POLICY "org_members_view_reconciliation" ON reconciliation_results FOR SELECT
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = reconciliation_results.org_id AND user_id = auth.uid()));
DROP POLICY IF EXISTS "org_members_view_forensic" ON forensic_flags;
CREATE POLICY "org_members_view_forensic" ON forensic_flags FOR SELECT
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = forensic_flags.org_id AND user_id = auth.uid()));

-- 9. Helper RPC to look up user_id by email (used by invite flow)
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(p_email TEXT)
RETURNS UUID
SECURITY DEFINER
SET search_path = auth
AS $$
  SELECT id FROM auth.users WHERE email = p_email LIMIT 1;
$$ LANGUAGE sql;

-- 10. Pending invites table
CREATE TABLE IF NOT EXISTS pending_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'manager', 'viewer')),
  invited_by UUID REFERENCES auth.users(id),
  token TEXT NOT NULL DEFAULT uuid_generate_v4()::text,
  accepted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_invites_email ON pending_invites(email);
ALTER TABLE pending_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_admins_view_invites" ON pending_invites;
CREATE POLICY "org_admins_view_invites" ON pending_invites FOR SELECT
  USING (EXISTS (SELECT 1 FROM organization_members WHERE org_id = pending_invites.org_id AND user_id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "users_view_own_invites" ON pending_invites;
CREATE POLICY "users_view_own_invites" ON pending_invites FOR SELECT
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "org_admins_insert_invites" ON pending_invites;
CREATE POLICY "org_admins_insert_invites" ON pending_invites FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM organization_members WHERE org_id = pending_invites.org_id AND user_id = auth.uid() AND role = 'admin'));

-- 11. Backfill: create default org for existing data
DO $$
DECLARE
  existing_tenant UUID;
BEGIN
  SELECT DISTINCT org_id INTO existing_tenant FROM payment_proofs LIMIT 1;
  IF existing_tenant IS NOT NULL THEN
    INSERT INTO organizations (id, name, slug, created_by)
    VALUES (existing_tenant, 'Default Organization', 'default-org', NULL)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
