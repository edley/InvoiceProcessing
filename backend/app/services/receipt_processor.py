import io
import re
import pdfplumber
from typing import Optional
from app.supabase_client import supabase
from app.config import settings
from datetime import datetime


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    text_parts = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                text_parts.append(text)
    return "\n".join(text_parts)


def extract_currency(text: str) -> Optional[str]:
    match = re.search(r"(?:Amount|Total)\s+([A-Z]{3})", text)
    return match.group(1) if match else "USD"


def extract_amount(text: str) -> Optional[float]:
    patterns = [
        r"(?:total|amount|sum|paid|due)[:\s]*\$?([\d,]+\.\d{2})",
        r"\$([\d,]+\.\d{2})",
        r"(?:total|amount|sum|paid|due)[:\s]*(?:[A-Z]{3}\s+)?([\d,]+\.\d{2})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return float(match.group(1).replace(",", ""))
    return None


def extract_payer_name(text: str) -> Optional[str]:
    patterns = [
        r"(?:payer|customer|name|bill to|paid by|submitted by)[:\s]*(.+?)[\n\r]",
        r"Transfer to\s*(.+?)[\n\r]",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


def extract_bank_issuer(text: str) -> Optional[str]:
    patterns = [
        r"(MCB\s+Ltd)",
        r"(The\s+\w+\s+(?:Commercial|Bank|Limited))",
        r"(Bank\s+of\s+\w+)",
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def extract_description(text: str) -> Optional[str]:
    m = re.search(r"Description\s+(.+?)[\n\r]", text, re.IGNORECASE)
    return m.group(1).strip() if m else None


def extract_notes(text: str) -> Optional[str]:
    lines = []
    m = re.search(r"Transfer from\s*(.+?)[\n\r]", text, re.IGNORECASE)
    if m:
        lines.append(f"From: {m.group(1).strip()}")
    m = re.search(r"Type\s*(.+?)[\n\r]", text, re.IGNORECASE)
    if m:
        lines.append(f"Type: {m.group(1).strip()}")
    return " | ".join(lines) if lines else None


def extract_email(text: str) -> Optional[str]:
    match = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
    return match.group(0) if match else None


def extract_receipt_number(text: str) -> Optional[str]:
    patterns = [
        r"(?:Transaction\s+)?(?:reference|ref)[:\s]*([A-Z0-9]+)",
        r"(?:receipt|invoice|confirmation)\s*(?:no|number|#)?[:\s]*([A-Z0-9-]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def extract_date(text: str) -> Optional[str]:
    patterns = [
        r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
        r"(\d{4}[/-]\d{1,2}[/-]\d{1,2})",
        r"(?:Issued on|Payment Exported on|date|paid|payment)[:\s]*(\d{1,2}\s+\w+\s+\d{4})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def process_proof(proof_id: str) -> dict:
    proof_result = supabase.table("payment_proofs").select("*").eq("id", proof_id).execute()
    if not proof_result.data:
        raise ValueError(f"Proof {proof_id} not found")

    proof = proof_result.data[0]

    supabase.table("payment_proofs").update({"status": "processing"}).eq("id", proof_id).execute()

    try:
        pdf_bytes = supabase.storage.from_(settings.supabase_bucket).download(proof["file_path"])
        text = extract_text_from_pdf(pdf_bytes)

        receipt = {
            "proof_id": proof_id,
            "receipt_number": extract_receipt_number(text),
            "amount": extract_amount(text),
            "currency": extract_currency(text),
            "payer_name": extract_payer_name(text),
            "payer_email": extract_email(text),
            "payment_date": extract_date(text),
            "bank_issuer": extract_bank_issuer(text),
            "description": extract_description(text),
            "notes": extract_notes(text),
            "raw_text": text[:2000],
            "status": "extracted",
            "created_at": datetime.utcnow().isoformat(),
        }

        insert_result = supabase.table("proof_of_payment_receipt").insert(receipt).execute()
        receipt_id = insert_result.data[0]["id"] if insert_result.data else None

        extracted = {
            "amount": receipt["amount"],
            "currency": receipt["currency"],
            "payer_name": receipt["payer_name"],
            "payer_email": receipt["payer_email"],
            "receipt_number": receipt["receipt_number"],
            "payment_date": receipt["payment_date"],
        }
        supabase.table("payment_proofs").update({
            "status": "completed",
            "extracted_data": extracted,
        }).eq("id", proof_id).execute()

        return {"receipt_id": receipt_id, "extracted": extracted, "raw_text_preview": text[:300]}

    except Exception as e:
        supabase.table("payment_proofs").update({
            "status": "failed",
            "error_message": str(e),
        }).eq("id", proof_id).execute()
        raise
