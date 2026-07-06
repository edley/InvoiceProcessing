from fastapi import APIRouter, Query
from app.supabase_client import supabase

router = APIRouter()


@router.get("/proofs")
def list_proofs(
    tenant_id: str = Query(None),
    status: str = None,
    document_type: str = None,
    date_from: str = None,
    date_to: str = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    query = supabase.table("payment_proofs").select("*", count="exact")
    if tenant_id:
        query = query.eq("tenant_id", tenant_id)
    if status:
        query = query.eq("status", status)
    if document_type:
        query = query.eq("document_type", document_type)
    if date_from:
        query = query.gte("created_at", date_from)
    if date_to:
        query = query.lt("created_at", f"{date_to}T23:59:59.999Z")
    query = query.order("created_at", desc=True).range((page - 1) * page_size, page * page_size - 1)
    result = query.execute()

    return {
        "total": result.count if hasattr(result, "count") else len(result.data),
        "page": page,
        "page_size": page_size,
        "items": result.data,
    }


@router.get("/proofs/{proof_id}")
def get_proof(proof_id: str):
    result = supabase.table("payment_proofs").select("*").eq("id", proof_id).execute()
    if not result.data:
        return {"error": "not found"}
    return result.data[0]


@router.get("/logs")
def list_logs(
    proof_id: str = Query(None),
    date_from: str = Query(None),
    date_to: str = Query(None),
    search: str = Query(None),
    stage: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    try:
        query = supabase.table("processing_log").select("*", count="exact").order("created_at", desc=True)
        if proof_id:
            query = query.eq("proof_id", proof_id)
        if date_from:
            query = query.gte("created_at", date_from)
        if date_to:
            query = query.lt("created_at", f"{date_to}T23:59:59.999Z")
        if search:
            query = query.ilike("message", f"%{search}%")
        if stage:
            query = query.eq("stage", stage)
        query = query.range((page - 1) * page_size, page * page_size - 1)
        result = query.execute()
        return {
            "total": result.count if hasattr(result, "count") else len(result.data),
            "page": page,
            "page_size": page_size,
            "items": result.data,
        }
    except Exception as e:
        print(f"[Logs] Error: {e}")
        return {"total": 0, "page": page, "page_size": page_size, "items": []}
