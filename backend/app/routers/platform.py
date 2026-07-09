from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel
from typing import Any, Optional
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
