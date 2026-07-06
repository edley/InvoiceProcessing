from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from app.supabase_client import supabase

router = APIRouter()


class AccountingEntryCreate(BaseModel):
    receipt_number: Optional[str] = None
    amount: float
    currency: Optional[str] = "USD"
    payer_name: Optional[str] = None
    payment_date: Optional[str] = None
    description: Optional[str] = None
    vendor: Optional[str] = None
    cost_center: Optional[str] = None
    account_code: Optional[str] = None
    status: Optional[str] = "posted"
    notes: Optional[str] = None


class AccountingEntryUpdate(BaseModel):
    receipt_number: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    payer_name: Optional[str] = None
    payment_date: Optional[str] = None
    description: Optional[str] = None
    vendor: Optional[str] = None
    cost_center: Optional[str] = None
    account_code: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


@router.get("/accounting-entries")
def list_entries(
    status: str = None,
    date_from: str = None,
    date_to: str = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    query = supabase.table("accounting_receipts").select("*", count="exact")
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


@router.post("/accounting-entries", status_code=201)
def create_entry(entry: AccountingEntryCreate):
    result = supabase.table("accounting_receipts").insert(entry.model_dump()).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create entry")
    return result.data[0]


@router.get("/accounting-entries/{entry_id}")
def get_entry(entry_id: str):
    result = supabase.table("accounting_receipts").select("*").eq("id", entry_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result.data[0]


@router.patch("/accounting-entries/{entry_id}")
def update_entry(entry_id: str, updates: AccountingEntryUpdate):
    data = {k: v for k, v in updates.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = supabase.table("accounting_receipts").update(data).eq("id", entry_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result.data[0]


@router.delete("/accounting-entries/{entry_id}")
def delete_entry(entry_id: str):
    supabase.table("accounting_receipts").delete().eq("id", entry_id).execute()
    return {"ok": True}
