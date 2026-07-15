import io
import json
import re
from typing import Optional
import pdfplumber
from app.supabase_client import supabase
from app.config import settings
from app.services.llm_extractor import extract_with_llm, llm_fallback_extract
from app.services.document_classifier import classify_document, is_receipt_type
from app.services.org_service import notify_org_admins
from app.settings_db import get_all_settings
from datetime import datetime


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    text_parts = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                text_parts.append(text)
    return "\n".join(text_parts)


# ---- Regex fallback extractors ---- #

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


def extract_currency(text: str) -> Optional[str]:
    match = re.search(r"(?:Amount|Total)\s+([A-Z]{3})", text)
    return match.group(1) if match else "USD"


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


def regex_extract(text: str) -> dict:
    return {
        "amount": extract_amount(text),
        "currency": extract_currency(text),
        "payer_name": extract_payer_name(text),
        "bank_issuer": extract_bank_issuer(text),
        "receipt_number": extract_receipt_number(text),
        "payment_date": extract_date(text),
        "description": extract_description(text),
        "confidence": 0.3,
    }


# ---- Main processor ---- #

def _log(proof_id: str, stage: str, status: str, message: str, org_id: str | None = None):
    try:
        supabase.table("processing_log").insert({
            "org_id": org_id,
            "proof_id": proof_id,
            "stage": stage,
            "status": status,
            "message": message[:2000],
        }).execute()
    except Exception:
        pass


def process_proof(proof_id: str) -> dict:
    proof_result = supabase.table("payment_proofs").select("*").eq("id", proof_id).execute()
    if not proof_result.data:
        raise ValueError(f"Proof {proof_id} not found")

    proof = proof_result.data[0]
    p_org_id = proof.get("org_id")
    supabase.table("payment_proofs").update({"status": "processing"}).eq("id", proof_id).execute()

    try:
        pdf_bytes = supabase.storage.from_(settings.supabase_bucket).download(proof["file_path"])
        text = extract_text_from_pdf(pdf_bytes)
        _log(proof_id, "ocr", "success", f"Extracted {len(text)} chars; preview: {text[:300]}", org_id=p_org_id)

        classification = classify_document(text)
        doc_type = classification["document_type"]
        doc_conf = classification["confidence"]
        supabase.table("payment_proofs").update({
            "document_type": doc_type,
            "document_type_confidence": doc_conf,
        }).eq("id", proof_id).execute()
        _log(proof_id, "classify", "success",
             json.dumps({"document_type": doc_type, "confidence": doc_conf, "reasoning": classification.get("reasoning", "")}),
             org_id=p_org_id)

        if not is_receipt_type(doc_type):
            supabase.table("payment_proofs").update({
                "status": "completed",
                "extracted_data": {"document_type": doc_type, "note": "Not a receipt-type document, skipped extraction"},
            }).eq("id", proof_id).execute()
            return {"document_type": doc_type, "status": "completed", "note": "Skipped — not a receipt-type document"}

        llm_result = None
        llm_raw_response = None
        db_settings = get_all_settings()
        db_provider = db_settings.get("llm_provider") or settings.llm_provider
        db_openai = db_settings.get("openai_api_key") or settings.openai_api_key
        db_nvidia = db_settings.get("nvidia_api_key") or settings.nvidia_api_key
        has_llm = bool(db_openai) if db_provider == "openai" else bool(db_nvidia)
        if has_llm:
            llm_result, llm_raw_response = extract_with_llm(text)
            _log(proof_id, "llm_primary", "success" if llm_result else "failure",
                 json.dumps({"raw_response": llm_raw_response, "parsed": llm_result}, default=str),
                 org_id=p_org_id)

        if llm_result and llm_result.get("confidence", 0) >= settings.llm_confidence_threshold_auto:
            extracted = llm_result
            source = "llm_auto"
            proof_status = "completed"
            receipt_status = "extracted"
        elif llm_result and llm_result.get("confidence", 0) >= settings.llm_confidence_threshold_review:
            extracted = llm_result
            source = "llm_review"
            proof_status = "review_needed"
            receipt_status = "review_needed"
        elif has_llm:
            fallback, fallback_raw = llm_fallback_extract(text)
            _log(proof_id, "llm_fallback", "success" if fallback else "failure",
                 json.dumps({"raw_response": fallback_raw, "parsed": fallback}, default=str),
                 org_id=p_org_id)
            if fallback:
                extracted = {**fallback, "confidence": fallback.get("confidence", 0.3)}
            else:
                extracted = regex_extract(text)
                _log(proof_id, "regex", "success", json.dumps(extracted, default=str), org_id=p_org_id)
            source = "llm_fallback"
            proof_status = "review_needed"
            receipt_status = "review_needed"
        else:
            extracted = regex_extract(text)
            _log(proof_id, "regex", "success", json.dumps(extracted, default=str), org_id=p_org_id)
            source = "regex"
            proof_status = "review_needed"
            receipt_status = "review_needed"

        _log(proof_id, "routing", "success",
             f"source={source} proof_status={proof_status} receipt_status={receipt_status} confidence={extracted.get('confidence')}",
             org_id=p_org_id)

        if proof_status == "review_needed":
            notify_org_admins(p_org_id,
                title="Receipt needs review",
                body=f"Proof #{proof_id[:8]} has low-confidence extraction and needs manual review",
                type="review_needed",
                entity_type="proof", entity_id=proof_id)

        receipt = {
            "org_id": proof.get("org_id"),
            "proof_id": proof_id,
            "receipt_number": extracted.get("receipt_number"),
            "amount": extracted.get("amount"),
            "currency": extracted.get("currency", "USD"),
            "payer_name": extracted.get("payer_name"),
            "bank_issuer": extracted.get("bank_issuer"),
            "description": extracted.get("description"),
            "payment_date": extracted.get("payment_date"),
            "purchase_currency": extracted.get("purchase_currency"),
            "transaction_currency": extracted.get("transaction_currency"),
            "transaction_amount": extracted.get("transaction_amount"),
            "card_number": extracted.get("card_number"),
            "card_type": extracted.get("card_type"),
            "payee": extracted.get("payee"),
            "address": extracted.get("address"),
            "notes": extract_notes(text),
            "status": receipt_status,
            "confidence_score": extracted.get("confidence"),
            "raw_text": text[:2000],
            "created_at": datetime.utcnow().isoformat(),
        }

        insert_result = supabase.table("proof_of_payment_receipt").insert(receipt).execute()
        receipt_id = insert_result.data[0]["id"] if insert_result.data else None

        extracted_clean = {
            "amount": receipt["amount"],
            "currency": receipt["currency"],
            "payer_name": receipt["payer_name"],
            "payer_email": None,
            "receipt_number": receipt["receipt_number"],
            "payment_date": receipt["payment_date"],
            "bank_issuer": receipt["bank_issuer"],
            "description": receipt["description"],
            "purchase_currency": extracted.get("purchase_currency"),
            "transaction_currency": extracted.get("transaction_currency"),
            "transaction_amount": extracted.get("transaction_amount"),
            "card_number": extracted.get("card_number"),
            "card_type": extracted.get("card_type"),
            "payee": extracted.get("payee"),
            "address": extracted.get("address"),
            "confidence": extracted.get("confidence"),
            "source": source,
        }
        supabase.table("payment_proofs").update({
            "status": proof_status,
            "extracted_data": extracted_clean,
            "processing_method": source,
            "erp_status": "synced",
            "erp_receipt_id": f"ERP-{proof_id[:8]}",
        }).eq("id", proof_id).execute()

        return {
            "receipt_id": receipt_id,
            "extracted": extracted_clean,
            "status": proof_status,
            "confidence": extracted.get("confidence"),
            "source": source,
            "raw_text_preview": text[:300],
        }

    except Exception as e:
        supabase.table("payment_proofs").update({
            "status": "failed",
            "error_message": str(e),
        }).eq("id", proof_id).execute()
        if p_org_id:
            notify_org_admins(p_org_id,
                title="Proof processing failed",
                body=f"Proof #{proof_id[:8]} failed: {str(e)[:200]}",
                type="upload_failed",
                entity_type="proof", entity_id=proof_id)
        raise
