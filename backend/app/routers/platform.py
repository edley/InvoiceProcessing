from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel
from typing import Any, Optional
from datetime import datetime
from app.supabase_client import supabase
from app.services.org_service import (
    require_platform_admin, is_platform_admin,
    list_user_orgs, list_all_users, get_org_members,
    add_member, remove_member, update_member_role, update_member_permissions,
    promote_to_platform_admin, demote_from_platform_admin,
    query_audit_log, log_audit,
    require_org, require_role,
)

router = APIRouter()


def _get_user_id(request: Request) -> str:
    uid = getattr(request.state, "verified_user_id", None) or request.headers.get("X-User-Id")
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")
    return uid


@router.get("/platform/summary")
def platform_summary(request: Request):
    user_id = _get_user_id(request)
    require_platform_admin(user_id)

    orgs = supabase.table("organizations").select("id, name, slug, status, created_at").order("created_at", desc=True).execute()
    orgs_data = orgs.data or []

    users = list_all_users()

    admins = [u for u in users if u.get("is_platform_admin")]

    recent_logs = query_audit_log(limit=20, offset=0)

    org_member_counts = {}
    for org in orgs_data:
        members = supabase.table("organization_members").select("user_id").eq("org_id", org["id"]).execute()
        org_member_counts[org["id"]] = len(members.data or [])

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    today_activity = supabase.table("audit_log").select("id").gte("created_at", today_start).execute()
    today_count = len(today_activity.data or [])

    return {
        "total_companies": len(orgs_data),
        "total_users": len(users),
        "platform_admins": len(admins),
        "activity_today": today_count,
        "companies": [
            {
                "id": o["id"],
                "name": o.get("name", ""),
                "slug": o.get("slug"),
                "status": o.get("status", "active"),
                "member_count": org_member_counts.get(o["id"], 0),
                "created_at": o.get("created_at"),
            }
            for o in orgs_data
        ],
        "users": [
            {
                "user_id": u["user_id"],
                "display_name": u.get("display_name", ""),
                "email": u.get("email", ""),
                "is_platform_admin": u.get("is_platform_admin", False),
                "orgs": u.get("orgs", []),
            }
            for u in users
        ],
        "recent_activity": [
            {
                "action": e.get("action"),
                "user_id": e.get("user_id"),
                "org_id": e.get("org_id"),
                "details": e.get("details"),
                "created_at": e.get("created_at"),
            }
            for e in recent_logs
        ],
    }


@router.get("/platform/status")
def platform_status(request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")

    # Auto-create user_profiles row if missing (ensures is_platform_admin column is checked on fresh accounts)
    try:
        existing = supabase.table("user_profiles").select("id").eq("id", user_id).execute()
        if not existing.data:
            supabase.table("user_profiles").insert({
                "id": user_id, "display_name": user_id[:8]
            }).execute()
    except Exception:
        pass

    return {"is_platform_admin": is_platform_admin(user_id)}


@router.get("/platform/orgs")
def platform_list_orgs(request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_platform_admin(user_id)

    result = supabase.table("organizations").select("*").order("name").execute()
    return {"items": result.data or []}


@router.get("/platform/users")
def platform_list_users(request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_platform_admin(user_id)

    users = list_all_users()
    for u in users:
        orgs = list_user_orgs(u["user_id"])
        u["orgs"] = [{"id": o["id"], "name": o["name"], "role": o["role"]} for o in orgs]
    return {"items": users}


@router.get("/platform/orgs/{org_id}/members")
def platform_list_members(org_id: str, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_platform_admin(user_id)
    return {"items": get_org_members(org_id)}


class ToggleNotificationsBody(BaseModel):
    enabled: bool


@router.put("/platform/users/{target_user_id}/notifications")
def toggle_user_notifications(target_user_id: str, body: ToggleNotificationsBody, request: Request):
    user_id = _get_user_id(request)
    require_platform_admin(user_id)

    supabase.table("user_profiles").update({
        "notifications_enabled": body.enabled
    }).eq("id", target_user_id).execute()
    log_audit(None, user_id, "toggle_notifications",
              entity_type="user", entity_id=target_user_id,
              details={"notifications_enabled": body.enabled})
    return {"ok": True}


@router.post("/platform/users/{target_user_id}/promote")
def platform_promote_user(target_user_id: str, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_platform_admin(user_id)

    promote_to_platform_admin(target_user_id)
    log_audit(None, user_id, "promote_to_platform_admin",
              entity_type="user", entity_id=target_user_id)
    return {"ok": True}


@router.post("/platform/users/{target_user_id}/demote")
def platform_demote_user(target_user_id: str, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_platform_admin(user_id)

    demote_from_platform_admin(target_user_id)
    log_audit(None, user_id, "demote_from_platform_admin",
              entity_type="user", entity_id=target_user_id)
    return {"ok": True}


@router.get("/platform/audit")
def platform_audit_log(
    request: Request,
    org_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    limit: int = Query(50),
    offset: int = Query(0),
):
    requester = request.headers.get("X-User-Id")
    if not requester:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_platform_admin(requester)

    items = query_audit_log(org_id=org_id, user_id=user_id, action=action, limit=limit, offset=offset)
    return {"items": items}


class SetPermissionsBody(BaseModel):
    permissions: Any


class AddOrgMemberBody(BaseModel):
    user_id: str
    role: str = "viewer"


@router.post("/platform/orgs/{org_id}/members")
def platform_add_org_member(org_id: str, body: AddOrgMemberBody, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_platform_admin(user_id)

    member = add_member(org_id, body.user_id, body.role)
    if not member:
        raise HTTPException(status_code=400, detail="Failed to add member (may already exist)")
    log_audit(org_id, user_id, "add_member",
              entity_type="member", entity_id=body.user_id,
              details={"role": body.role})
    return member


@router.put("/orgs/{org_id}/members/{member_user_id}/permissions")
def set_member_permissions(org_id: str, member_user_id: str, body: SetPermissionsBody, request: Request):
    requester = request.headers.get("X-User-Id")
    if not requester:
        raise HTTPException(status_code=401, detail="X-User-Id header required")

    if not is_platform_admin(requester):
        require_role(org_id, requester, "admin")

    update_member_permissions(org_id, member_user_id, body.permissions)
    log_audit(org_id, requester, "update_permissions",
              entity_type="member", entity_id=member_user_id,
              details={"permissions": body.permissions})
    return {"ok": True}


@router.get("/orgs/{org_id}/audit")
def org_audit_log(
    org_id: str,
    request: Request,
    limit: int = Query(50),
    offset: int = Query(0),
):
    requester = request.headers.get("X-User-Id")
    if not requester:
        raise HTTPException(status_code=401, detail="X-User-Id header required")

    if not is_platform_admin(requester):
        require_role(org_id, requester, "admin")

    items = query_audit_log(org_id=org_id, limit=limit, offset=offset)
    return {"items": items}
