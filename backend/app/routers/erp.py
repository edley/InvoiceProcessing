from fastapi import APIRouter, HTTPException, Request
from app.supabase_client import supabase
from app.services.org_service import require_org

router = APIRouter()


@router.post("/proofs/{proof_id}/sync")
def sync_proof_to_erp(proof_id: str, request: Request):
    org_id = require_org(request)
    result = supabase.table("payment_proofs").select("*").eq("id", proof_id).eq("org_id", org_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Proof not found")
    proof = result.data[0]
    if not proof.get("extracted_data"):
        raise HTTPException(status_code=400, detail="No extracted data to sync")

    supabase.table("payment_proofs").update({
        "erp_status": "synced",
        "erp_receipt_id": f"ERP-{proof_id[:8]}",
    }).eq("id", proof_id).execute()

    return {"id": proof_id, "erp_status": "synced", "erp_receipt_id": f"ERP-{proof_id[:8]}"}
