from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from app.supabase_client import supabase
from app.services.receipt_matcher import run_reconciliation

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
def trigger_reconciliation():
    try:
        result = run_reconciliation()
        return {"status": "ok", **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reconciliation/results")
def list_results(
    classification: str = None,
    match_type: str = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    query = supabase.table("reconciliation_results").select("*", count="exact")
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
def get_result(result_id: str):
    result = supabase.table("reconciliation_results").select("*").eq("id", result_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Result not found")
    return result.data[0]


@router.patch("/reconciliation/results/{result_id}")
def override_result(result_id: str, override: ReconciliationOverride):
    data = {}
    if override.classification:
        data["classification"] = override.classification
    if override.notes:
        data["notes"] = override.notes
    if override.human_reviewed:
        data["human_reviewed"] = True
        data["reviewed_at"] = "now()"

    result = supabase.table("reconciliation_results").update(data).eq("id", result_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Result not found")
    return result.data[0]


@router.post("/reconciliation/match-manual", status_code=201)
def manual_match(match: ManualMatchCreate):
    existing = supabase.table("reconciliation_results").select("id").eq(
        "proof_receipt_id", match.proof_receipt_id
    ).execute()
    data = {
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
def reconciliation_stats():
    results = supabase.table("reconciliation_results").select("classification").execute()
    items = results.data if results.data else []
    stats = {"total": len(items)}
    for item in items:
        c = item.get("classification", "pending")
        stats[c] = stats.get(c, 0) + 1
    return stats
