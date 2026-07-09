from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Optional
import threading
from app.supabase_client import supabase
from app.services.receipt_matcher import run_reconciliation
from app.reconciliation_progress import get as get_progress, fail
from app.services.org_service import require_org, require_role

router = APIRouter()


class ReconciliationOverride(BaseModel):
    classification: Optional[str] = None
    notes: Optional[str] = None
    human_reviewed: Optional[bool] = True


class ManualMatchCreate(BaseModel):
    proof_receipt_id: str
    accounting_entry_id: Optional[str] = None
    notes: Optional[str] = None


@router.post("/reconciliation/run")
def trigger_reconciliation(request: Request, date_from: str = None, date_to: str = None):
    org_id = require_org(request)
    t = threading.Thread(target=run_reconciliation, args=(date_from, date_to, org_id), daemon=True)
    t.start()
    return {"status": "started"}


@router.get("/reconciliation/progress")
def reconciliation_progress(request: Request):
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    return get_progress()


@router.get("/reconciliation/results")
def list_results(
    request: Request,
    classification: str = None,
    match_type: str = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    org_id = require_org(request)
    query = supabase.table("reconciliation_results").select("*", count="exact")
    query = query.eq("org_id", org_id)
    if classification:
        query = query.eq("classification", classification)
    if match_type:
        query = query.eq("match_type", match_type)
    query = query.order("created_at", desc=True).range((page - 1) * page_size, page * page_size - 1)
    result = query.execute()
    return {
        "total": result.count if hasattr(result, "count") else len(result.data),
        "page": page,
        "page_size": page_size,
        "items": result.data,
    }


@router.get("/reconciliation/results/{result_id}")
def get_result(result_id: str, request: Request):
    org_id = require_org(request)
    result = supabase.table("reconciliation_results").select("*").eq("id", result_id).eq("org_id", org_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Result not found")
    return result.data[0]


@router.patch("/reconciliation/results/{result_id}")
def override_result(result_id: str, override: ReconciliationOverride, request: Request):
    org_id = require_org(request)
    user_id = request.headers.get("X-User-Id")
    if user_id:
        require_role(org_id, user_id, "manager")

    data = {}
    if override.classification:
        data["classification"] = override.classification
    if override.notes:
        data["notes"] = override.notes
    if override.human_reviewed:
        data["human_reviewed"] = True
        data["reviewed_at"] = "now()"

    result = supabase.table("reconciliation_results").update(data).eq("id", result_id).eq("org_id", org_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Result not found")
    return result.data[0]


@router.post("/reconciliation/match-manual", status_code=201)
def manual_match(match: ManualMatchCreate, request: Request):
    org_id = require_org(request)
    user_id = request.headers.get("X-User-Id")
    if user_id:
        require_role(org_id, user_id, "manager")

    existing = supabase.table("reconciliation_results").select("id").eq(
        "proof_receipt_id", match.proof_receipt_id
    ).execute()
    data = {
        "org_id": org_id,
        "proof_receipt_id": match.proof_receipt_id,
        "accounting_entry_id": match.accounting_entry_id,
        "match_type": "manual",
        "matching_score": 1.0 if match.accounting_entry_id else 0.0,
        "classification": "correct" if match.accounting_entry_id else "forensic_required",
        "notes": match.notes,
        "human_reviewed": True,
        "reviewed_at": "now()",
    }
    if existing.data:
        result = supabase.table("reconciliation_results").update(data).eq("id", existing.data[0]["id"]).execute()
    else:
        result = supabase.table("reconciliation_results").insert(data).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to save match")
    return result.data[0]


@router.get("/reconciliation/stats")
def reconciliation_stats(request: Request):
    org_id = require_org(request)
    results = supabase.table("reconciliation_results").select("classification, match_type").eq("org_id", org_id).execute()
    items = results.data if results.data else []
    stats = {"total": len(items)}
    for item in items:
        c = item.get("classification", "pending")
        stats[c] = stats.get(c, 0) + 1
        mt = item.get("match_type", "unknown")
        stats[mt] = stats.get(mt, 0) + 1
    return stats
