import uuid
import re
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel
from typing import Optional
from app.supabase_client import supabase
from app.services.org_service import (
    list_user_orgs, get_org_members, add_member, remove_member,
    update_member_role, require_role, log_audit, is_platform_admin,
)

router = APIRouter()


class OrgCreate(BaseModel):
    name: str
    slug: Optional[str] = None


class OrgUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    legal_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    fax: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None
    vat_number: Optional[str] = None
    tax_id: Optional[str] = None
    sic_code: Optional[str] = None
    company_type: Optional[str] = None
    employee_count: Optional[int] = None
    annual_revenue: Optional[float] = None
    industry: Optional[str] = None
    description: Optional[str] = None
    parent_company: Optional[str] = None


class MemberInvite(BaseModel):
    email: str
    role: str = "viewer"


class MemberUpdate(BaseModel):
    role: str


@router.get("/orgs")
def list_orgs(request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")

    try:
        orgs = list_user_orgs(user_id)
    except Exception:
        orgs = []

    if not orgs:
        try:
            existing = supabase.table("organizations").select("id").eq("name", "My Company").eq("created_by", user_id).execute()
            if not existing.data:
                org_data = {"name": "My Company", "slug": _slugify("My Company"), "created_by": user_id}
                org_result = supabase.table("organizations").insert(org_data).execute()
                if org_result.data:
                    org = org_result.data[0]
                    add_member(org["id"], user_id, "admin")
                orgs = list_user_orgs(user_id)
            else:
                add_member(existing.data[0]["id"], user_id, "admin")
                orgs = list_user_orgs(user_id)
        except Exception:
            pass

    return {"items": orgs, "is_platform_admin": is_platform_admin(user_id)}


@router.post("/orgs", status_code=201)
def create_org(body: OrgCreate, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")

    slug = body.slug or _slugify(body.name)
    org_data = {"name": body.name, "slug": slug, "created_by": user_id}
    org_result = supabase.table("organizations").insert(org_data).execute()
    if not org_result.data:
        raise HTTPException(status_code=500, detail="Failed to create org")
    org = org_result.data[0]

    add_member(org["id"], user_id, "admin")
    log_audit(org["id"], user_id, "create_org", entity_type="org", entity_id=org["id"], details={"name": body.name})
    return org


@router.get("/orgs/{org_id}")
def get_org(org_id: str, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_role(org_id, user_id, "viewer")

    result = supabase.table("organizations").select("*").eq("id", org_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Organization not found")
    return result.data[0]


@router.patch("/orgs/{org_id}")
def update_org(org_id: str, body: OrgUpdate, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_role(org_id, user_id, "admin")

    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = supabase.table("organizations").update(data).eq("id", org_id).execute()
    log_audit(org_id, user_id, "update_org", entity_type="org", entity_id=org_id, details=data)
    return result.data[0] if result.data else {"status": "updated"}


@router.get("/orgs/{org_id}/members")
def list_members(org_id: str, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_role(org_id, user_id, "viewer")
    return {"items": get_org_members(org_id)}


@router.post("/orgs/{org_id}/members", status_code=201)
def invite_member(org_id: str, body: MemberInvite, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_role(org_id, user_id, "admin")

    try:
        target_user = supabase.rpc("get_user_id_by_email", {"p_email": body.email}).execute()
    except Exception:
        target_user = None

    if target_user and target_user.data:
        target_id = target_user.data
        if isinstance(target_id, list):
            target_id = target_id[0] if target_id else None
        if target_id:
            existing = supabase.table("organization_members").select("id").eq(
                "org_id", org_id
            ).eq("user_id", target_id).execute()
            if existing.data:
                raise HTTPException(status_code=400, detail="User is already a member")

            member = add_member(org_id, str(target_id), body.role, invited_by=user_id)
            log_audit(org_id, user_id, "add_member", entity_type="member", entity_id=str(target_id), details={"role": body.role})
            return member

    invite_data = {
        "org_id": org_id,
        "email": body.email,
        "role": body.role,
        "invited_by": user_id,
    }
    invite_result = supabase.table("pending_invites").insert(invite_data).execute()
    if not invite_result.data:
        raise HTTPException(status_code=500, detail="Failed to create invite")
    return invite_result.data[0]


@router.post("/orgs/invites/accept")
def accept_invite(token: str, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")

    invite = supabase.table("pending_invites").select("*").eq("token", token).eq("accepted", False).execute()
    if not invite.data:
        raise HTTPException(status_code=404, detail="Invite not found or already accepted")

    inv = invite.data[0]
    member = add_member(inv["org_id"], user_id, inv["role"])
    supabase.table("pending_invites").update({"accepted": True}).eq("id", inv["id"]).execute()
    return member


@router.get("/orgs/invites/pending")
def pending_invites(request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")

    user_email = request.headers.get("X-User-Email")
    if not user_email:
        return {"items": []}

    result = supabase.table("pending_invites").select(
        "*, organizations!inner(id, name, slug)"
    ).eq("email", user_email).eq("accepted", False).execute()

    items = []
    for inv in result.data or []:
        org = inv.get("organizations", {})
        items.append({
            "id": inv["id"],
            "org_id": inv["org_id"],
            "org_name": org.get("name"),
            "role": inv["role"],
            "token": inv["token"],
            "created_at": inv.get("created_at"),
        })
    return {"items": items}


@router.patch("/orgs/{org_id}/members/{member_user_id}")
def update_member(org_id: str, member_user_id: str, body: MemberUpdate, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_role(org_id, user_id, "admin")

    if member_user_id == user_id and body.role != "admin":
        admins = supabase.table("organization_members").select("id", count="exact").eq(
            "org_id", org_id
        ).eq("role", "admin").execute()
        if admins.count == 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last admin")

    result = update_member_role(org_id, member_user_id, body.role)
    log_audit(org_id, user_id, "update_member_role", entity_type="member", entity_id=member_user_id, details={"role": body.role})
    return result


@router.delete("/orgs/{org_id}/members/{member_user_id}", status_code=204)
def delete_member(org_id: str, member_user_id: str, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    require_role(org_id, user_id, "admin")
    if member_user_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")
    remove_member(org_id, member_user_id)
    log_audit(org_id, user_id, "remove_member", entity_type="member", entity_id=member_user_id)


@router.delete("/orgs/{org_id}", status_code=204)
def delete_org(org_id: str, request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")

    is_admin = is_platform_admin(user_id)
    if not is_admin:
        try:
            require_role(org_id, user_id, "admin")
        except HTTPException:
            raise HTTPException(status_code=403, detail="Only org admin or platform admin can delete")

    supabase.table("organization_members").delete().eq("org_id", org_id).execute()
    supabase.table("pending_invites").delete().eq("org_id", org_id).execute()
    supabase.table("organizations").delete().eq("id", org_id).execute()
    log_audit(org_id, user_id, "delete_org", entity_type="org", entity_id=org_id)


def _slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'[\s-]+', '-', s)
    s = s[:48].strip('-')
    return s + '-' + str(uuid.uuid4())[:6]
