from fastapi import APIRouter, HTTPException, Request, Query
from app.supabase_client import supabase
from app.services.org_service import require_org, require_role

router = APIRouter()


@router.get("/notifications")
def list_notifications(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    org_id = require_org(request)
    user_id = getattr(request.state, "verified_user_id", None) or request.headers.get("X-User-Id")

    offset = (page - 1) * page_size
    result = supabase.table("notifications").select("*", count="exact").eq(
        "org_id", org_id
    ).eq("user_id", user_id).order("created_at", desc=True).range(
        offset, offset + page_size - 1
    ).execute()

    return {
        "items": result.data or [],
        "total": result.count or 0,
        "page": page,
        "page_size": page_size,
    }


@router.get("/notifications/unread-count")
def unread_count(request: Request):
    org_id = getattr(request.state, "org_id", None)
    if not org_id:
        return {"count": 0}
    user_id = getattr(request.state, "verified_user_id", None) or request.headers.get("X-User-Id")
    if not user_id:
        return {"count": 0}

    result = supabase.table("notifications").select("id", count="exact").eq(
        "org_id", org_id
    ).eq("user_id", user_id).eq("is_read", False).execute()

    return {"count": result.count or 0}


@router.patch("/notifications/{notification_id}/read")
def mark_read(notification_id: str, request: Request):
    org_id = require_org(request)
    user_id = getattr(request.state, "verified_user_id", None) or request.headers.get("X-User-Id")

    supabase.table("notifications").update({"is_read": True}).eq(
        "id", notification_id
    ).eq("org_id", org_id).eq("user_id", user_id).execute()

    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_read(request: Request):
    org_id = getattr(request.state, "org_id", None)
    if not org_id:
        return {"ok": True}
    user_id = getattr(request.state, "verified_user_id", None) or request.headers.get("X-User-Id")
    if not user_id:
        return {"ok": True}

    supabase.table("notifications").update({"is_read": True}).eq(
        "org_id", org_id
    ).eq("user_id", user_id).eq("is_read", False).execute()

    return {"ok": True}
