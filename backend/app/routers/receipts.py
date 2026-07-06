from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from app.supabase_client import supabase
from datetime import datetime, timezone

router = APIRouter()


class ReceiptUpdate(BaseModel):
    amount: Optional[float] = None
    currency: Optional[str] = None
    payer_name: Optional[str] = None
    bank_issuer: Optional[str] = None
    receipt_number: Optional[str] = None
    payment_date: Optional[str] = None
    description: Optional[str] = None
    purchase_currency: Optional[str] = None
    transaction_currency: Optional[str] = None
    transaction_amount: Optional[float] = None
    card_number: Optional[str] = None
    card_type: Optional[str] = None
    payee: Optional[str] = None
    address: Optional[str] = None
    status: Optional[str] = None
    changed_by: Optional[str] = None


@router.get("/receipts")
def list_receipts(
    status: str = None,
    date_from: str = None,
    date_to: str = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    query = supabase.table("proof_of_payment_receipt").select("*, payment_proofs(file_name, status, file_path)", count="exact")
    if status:
        query = query.eq("status", status)
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


@router.get("/receipts/{receipt_id}")
def get_receipt(receipt_id: str):
    result = supabase.table("proof_of_payment_receipt").select("*, payment_proofs(file_name, status, file_path)").eq("id", receipt_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return result.data[0]


@router.patch("/receipts/{receipt_id}")
def update_receipt(receipt_id: str, body: ReceiptUpdate):
    existing = supabase.table("proof_of_payment_receipt").select("*").eq("id", receipt_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Receipt not found")

    old = existing.data[0]
    update_data = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None and k != "changed_by"}
    if update_data:
        supabase.table("proof_of_payment_receipt").update(update_data).eq("id", receipt_id).execute()

        # Log field-level audit trail
        changed_by = body.changed_by
        audit_records = []
        for field, new_val in update_data.items():
            old_val = old.get(field)
            if str(old_val) != str(new_val):
                audit_records.append({
                    "receipt_id": receipt_id,
                    "field_name": field,
                    "old_value": str(old_val) if old_val is not None else None,
                    "new_value": str(new_val) if new_val is not None else None,
                    "changed_by": changed_by,
                    "changed_at": datetime.now(timezone.utc).isoformat(),
                })
        if audit_records:
            supabase.table("receipt_field_audit").insert(audit_records).execute()

        # When receipt is reviewed, also update proof status to ready_to_process
        new_status = update_data.get("status")
        if new_status == "reviewed":
            supabase.table("payment_proofs").update({
                "status": "ready_to_process",
            }).eq("id", old["proof_id"]).execute()

    result = supabase.table("proof_of_payment_receipt").select("*, payment_proofs(file_name, status, file_path)").eq("id", receipt_id).execute()
    return result.data[0]


@router.get("/receipts/{receipt_id}/audit")
def get_receipt_audit(receipt_id: str):
    result = supabase.table("receipt_field_audit") \
        .select("*") \
        .eq("receipt_id", receipt_id) \
        .order("changed_at", desc=True) \
        .execute()
    return {"items": result.data}
