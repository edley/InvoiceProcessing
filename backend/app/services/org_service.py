from fastapi import Request, HTTPException
from app.supabase_client import supabase

# === Permission names ===
PERM_AUDIT = "audit"
PERM_UPLOAD = "upload"
PERM_EDIT = "edit"
PERM_DELETE = "delete"
PERM_RECONCILE = "reconcile"
PERM_MANAGE_MEMBERS = "manage_members"
ALL_PERMISSIONS = [PERM_AUDIT, PERM_UPLOAD, PERM_EDIT, PERM_DELETE, PERM_RECONCILE, PERM_MANAGE_MEMBERS]

ROLE_PERMISSIONS = {
    "viewer": [],
    "manager": [PERM_UPLOAD, PERM_EDIT, PERM_DELETE, PERM_RECONCILE],
    "admin": ALL_PERMISSIONS,
}


def is_platform_admin(user_id: str) -> bool:
    try:
        result = supabase.table("user_profiles").select("*").eq("id", user_id).execute()
    except Exception:
        return False
    if result.data:
        return result.data[0].get("is_platform_admin", False)
    return False


def require_platform_admin(user_id: str):
    if not is_platform_admin(user_id):
        raise HTTPException(status_code=403, detail="Platform admin access required")


def get_org_id(request: Request) -> str | None:
    return request.headers.get("X-Org-Id")


def require_org(request: Request) -> str:
    org_id = get_org_id(request)
    if not org_id:
        raise HTTPException(status_code=400, detail="X-Org-Id header is required")
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_role(org_id, user_id, "viewer")
    return org_id


def get_user_permissions(org_id: str, user_id: str) -> list[str]:
    result = supabase.table("organization_members").select("role, permissions").eq(
        "org_id", org_id
    ).eq("user_id", user_id).execute()

    if not result.data:
        return []

    row = result.data[0]
    role = row.get("role", "viewer")
    base_perms = list(ROLE_PERMISSIONS.get(role, []))
    extra_perms = row.get("permissions") or []
    if isinstance(extra_perms, list):
        base_perms.extend(p for p in extra_perms if p not in base_perms)
    return base_perms


def require_permission(org_id: str, user_id: str, permission: str):
    perms = get_user_permissions(org_id, user_id)
    if permission not in perms:
        raise HTTPException(status_code=403, detail=f"Missing permission: {permission}")


def require_role(org_id: str, user_id: str, min_role: str = "viewer"):
    if is_platform_admin(user_id):
        return "admin"
    allowed = {"viewer": 0, "manager": 1, "admin": 2}
    level = allowed.get(min_role, 0)

    result = supabase.table("organization_members").select("role").eq(
        "org_id", org_id
    ).eq("user_id", user_id).execute()

    if not result.data:
        raise HTTPException(status_code=403, detail="Not a member of this organization")

    member_role = result.data[0]["role"]
    member_level = allowed.get(member_role, -1)

    if member_level < level:
        raise HTTPException(
            status_code=403,
            detail=f"Role '{member_role}' does not have required permission: '{min_role}'",
        )
    return member_role


def get_user_role(org_id: str, user_id: str) -> str | None:
    if is_platform_admin(user_id):
        return "admin"
    result = supabase.table("organization_members").select("role").eq(
        "org_id", org_id
    ).eq("user_id", user_id).execute()
    if result.data:
        return result.data[0]["role"]
    return None


def list_user_orgs(user_id: str) -> list[dict]:
    if is_platform_admin(user_id):
        result = supabase.table("organizations").select("*").order("name").execute()
        items = []
        for row in result.data or []:
            items.append({
                "id": row["id"],
                "name": row["name"],
                "slug": row.get("slug"),
                "logo_url": row.get("logo_url"),
                "status": row.get("status"),
                "role": "admin",
            })
        return items

    members = supabase.table("organization_members").select(
        "org_id, role, permissions"
    ).eq("user_id", user_id).execute()

    items = []
    for m in (members.data or []):
        org_id = m.get("org_id")
        if not org_id:
            continue
        org_resp = supabase.table("organizations").select("*").eq("id", org_id).execute()
        if not org_resp.data:
            continue
        org = org_resp.data[0]
        items.append({
            "id": org["id"],
            "name": org.get("name", ""),
            "slug": org.get("slug"),
            "logo_url": org.get("logo_url"),
            "status": org.get("status"),
            "role": m.get("role", "viewer"),
            "permissions": m.get("permissions"),
        })

    items.sort(key=lambda x: x["name"].lower() or "")
    return items


def list_all_users() -> list[dict]:
    items: list[dict] = []
    try:
        result = supabase.rpc("list_all_auth_users").execute()
        raw = result.data or []
    except Exception:
        raw = []

    if not raw:
        try:
            au = supabase.auth.admin.list_users()
            raw = [
                {"user_id": str(u.id), "email": u.email or "", "display_name": u.user_metadata.get("display_name") or ""}
                for u in (au.user_list or [])
            ]
        except Exception:
            raw = []

    if not raw:
        profiles = supabase.table("user_profiles").select("id, display_name, is_platform_admin").execute()
        for p in (profiles.data or []):
            raw.append({
                "user_id": p["id"],
                "display_name": p.get("display_name") or "",
                "email": "",
            })

    profile_map = {}
    try:
        profile_resp = supabase.table("user_profiles").select("id, display_name, is_platform_admin, notifications_enabled").execute()
        for p in (profile_resp.data or []):
            profile_map[p["id"]] = p
    except Exception:
        pass

    seen = set()
    for row in raw:
        uid = row["user_id"]
        if uid in seen:
            continue
        seen.add(uid)

        pdata = profile_map.get(uid, {})
        display_name = row.get("display_name") or pdata.get("display_name") or ""
        email = row.get("email") or ""
        items.append({
            "user_id": uid,
            "display_name": display_name,
            "email": email,
            "is_platform_admin": pdata.get("is_platform_admin", False),
            "notifications_enabled": pdata.get("notifications_enabled", True),
        })

    return items


def get_org_members(org_id: str) -> list[dict]:
    result = supabase.table("organization_members").select(
        "id, user_id, role, permissions, joined_at, invited_by"
    ).eq("org_id", org_id).order("joined_at").execute()

    items = []
    for row in result.data or []:
        _ensure_user_profile(row["user_id"])
        profile = supabase.table("user_profiles").select("*").eq("id", row["user_id"]).execute()
        profile_data = profile.data[0] if profile.data else {}
        items.append({
            "id": row["id"],
            "user_id": row["user_id"],
            "role": row["role"],
            "permissions": row.get("permissions", []),
            "joined_at": row.get("joined_at"),
            "display_name": profile_data.get("display_name"),
            "email": profile_data.get("email"),
            "avatar_url": profile_data.get("avatar_url"),
            "is_platform_admin": profile_data.get("is_platform_admin", False),
        })
    return items


def _ensure_user_profile(user_id: str):
    email = None
    try:
        au = supabase.auth.admin.get_user_by_id(user_id)
        if au and au.user:
            email = au.user.email
    except Exception:
        pass
    if not email:
        email = user_id[:8] + "@placeholder.com"
    display_name = email.split("@")[0]
    company = supabase.table("companies").select("id").limit(1).execute()
    company_id = company.data[0]["id"] if company.data else "00000000-0000-4000-8000-000000000001"
    existing = supabase.table("user_profiles").select("id").eq("id", user_id).execute()
    if existing.data:
        supabase.table("user_profiles").update({
            "email": email,
            "display_name": display_name,
        }).eq("id", user_id).execute()
    else:
        supabase.table("user_profiles").insert({
            "id": user_id,
            "email": email,
            "company_id": company_id,
            "display_name": display_name,
            "is_platform_admin": False,
        }).execute()

def add_member(org_id: str, user_id: str, role: str = "viewer", invited_by: str | None = None):
    _ensure_user_profile(user_id)
    data = {"org_id": org_id, "user_id": user_id, "role": role}
    if invited_by:
        data["invited_by"] = invited_by
    try:
        result = supabase.table("organization_members").insert(data).execute()
        return result.data[0] if result.data else None
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to add member: {e}")


def remove_member(org_id: str, user_id: str):
    supabase.table("organization_members").delete().eq("org_id", org_id).eq("user_id", user_id).execute()


def update_member_role(org_id: str, user_id: str, role: str):
    result = supabase.table("organization_members").update({"role": role}).eq(
        "org_id", org_id
    ).eq("user_id", user_id).execute()
    return result.data[0] if result.data else None


def update_member_permissions(org_id: str, user_id: str, permissions: list[str]):
    result = supabase.table("organization_members").update({"permissions": permissions}).eq(
        "org_id", org_id
    ).eq("user_id", user_id).execute()
    return result.data[0] if result.data else None


def promote_to_platform_admin(target_user_id: str):
    supabase.table("user_profiles").update({"is_platform_admin": True}).eq("id", target_user_id).execute()


def demote_from_platform_admin(target_user_id: str):
    supabase.table("user_profiles").update({"is_platform_admin": False}).eq("id", target_user_id).execute()


def log_audit(org_id: str | None, user_id: str, action: str,
              entity_type: str | None = None, entity_id: str | None = None,
              details: dict | None = None, ip_address: str | None = None):
    try:
        supabase.table("audit_log").insert({
            "org_id": org_id,
            "user_id": user_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "details": details or {},
            "ip_address": ip_address,
        }).execute()
    except Exception:
        pass


def query_audit_log(org_id: str | None = None, user_id: str | None = None,
                    action: str | None = None, limit: int = 50, offset: int = 0) -> list[dict]:
    q = supabase.table("audit_log").select("*")
    if org_id:
        q = q.eq("org_id", org_id)
    if user_id:
        q = q.eq("user_id", user_id)
    if action:
        q = q.eq("action", action)
    result = q.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    return result.data or []


def create_notification(org_id: str, user_id: str, title: str, body: str | None = None,
                        type: str = "info", entity_type: str | None = None,
                        entity_id: str | None = None):
    try:
        supabase.table("notifications").insert({
            "org_id": org_id,
            "user_id": user_id,
            "title": title,
            "body": body,
            "type": type,
            "entity_type": entity_type,
            "entity_id": entity_id,
        }).execute()
    except Exception:
        pass


def notify_org_admins(org_id: str, title: str, body: str | None = None,
                      type: str = "info", entity_type: str | None = None,
                      entity_id: str | None = None):
    try:
        members = supabase.table("organization_members").select("user_id").eq(
            "org_id", org_id
        ).eq("role", "admin").execute()
        for m in (members.data or []):
            uid = m["user_id"]
            pref = supabase.table("user_profiles").select("notifications_enabled").eq("id", uid).limit(1).execute()
            if pref.data and pref.data[0].get("notifications_enabled") is False:
                continue
            create_notification(org_id, uid, title, body, type, entity_type, entity_id)
    except Exception:
        pass
