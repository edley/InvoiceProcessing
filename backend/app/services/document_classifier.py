import json
import httpx
from openai import OpenAI
from app.config import settings
from app.settings_db import get_all_settings

CLASSIFIER_PROMPT = """You are a document classifier. Given raw OCR text from a document, classify what type of document it is.

Respond with JSON:
{
  "document_type": "receipt" | "invoice" | "payment_proof" | "id" | "passport" | "driving_license" | "birth_certificate" | "other" | "unclassified",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

Document type definitions:
- receipt: A sales receipt, purchase receipt, or payment confirmation from a store or merchant
- invoice: A bill or invoice requesting payment for goods/services
- payment_proof: A bank transfer confirmation, payment slip, or transaction receipt from a financial institution
- id: A government-issued identification card
- passport: A passport or travel document
- driving_license: A driver's license
- birth_certificate: A birth certificate document
- other: Any other document type not listed above
- unclassified: Cannot determine the document type from the text

Rules:
- If the text is too garbled or short to classify, return "unclassified"
- Be conservative — only classify as receipt/invoice/payment_proof if you are confident
- confidence should be >= 0.8 if the type is clearly identifiable
- Return ONLY valid JSON, no markdown, no explanation"""


def _get_config():
    db = get_all_settings()
    provider = db.get("llm_provider") or settings.llm_provider
    model = db.get("llm_model") or settings.llm_model
    if provider == "nvidia":
        return {
            "provider": "nvidia",
            "api_key": db.get("nvidia_api_key") or settings.nvidia_api_key,
            "base_url": db.get("nvidia_base_url") or settings.nvidia_base_url,
            "model": db.get("nvidia_model") or settings.nvidia_model,
        }
    return {
        "provider": "openai",
        "api_key": db.get("openai_api_key") or settings.openai_api_key,
        "model": model,
    }


def _get_client(cfg: dict):
    http_client = httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0))
    if cfg["provider"] == "nvidia":
        return OpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"], http_client=http_client)
    return OpenAI(api_key=cfg["api_key"], http_client=http_client)


def classify_document(text: str) -> dict:
    try:
        cfg = _get_config()
        client = _get_client(cfg)
        response = client.chat.completions.create(
            model=cfg["model"],
            messages=[
                {"role": "system", "content": CLASSIFIER_PROMPT},
                {"role": "user", "content": f"Classify this document text:\n\n{text[:2000]}"},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=200,
        )
        raw = response.choices[0].message.content
        if not raw:
            return {"document_type": "unclassified", "confidence": 0.0, "reasoning": "empty response"}
        result = json.loads(raw)
        doc_type = result.get("document_type", "unclassified")
        valid_types = {"receipt", "invoice", "payment_proof", "id", "passport", "driving_license", "birth_certificate", "other", "unclassified"}
        if doc_type not in valid_types:
            doc_type = "unclassified"
        return {
            "document_type": doc_type,
            "confidence": float(result.get("confidence", 0.0)),
            "reasoning": result.get("reasoning", ""),
        }
    except Exception as e:
        print(f"[Classifier] Error: {e}")
        return {"document_type": "unclassified", "confidence": 0.0, "reasoning": str(e)}


RECEIPT_TYPES = {"receipt", "invoice", "payment_proof"}


def is_receipt_type(doc_type: str) -> bool:
    return doc_type in RECEIPT_TYPES
