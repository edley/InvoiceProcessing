-- 019_list_all_users_rpc.sql
-- RPC to list all auth users (for platform admin management)
CREATE OR REPLACE FUNCTION public.list_all_auth_users()
RETURNS TABLE(user_id UUID, email TEXT, display_name TEXT, created_at TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT u.id, u.email, up.display_name, u.created_at
  FROM auth.users u
  LEFT JOIN public.user_profiles up ON up.id = u.id
  ORDER BY u.created_at DESC;
$$ LANGUAGE sql;
