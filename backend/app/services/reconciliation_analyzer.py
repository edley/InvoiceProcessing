import json
import httpx
from openai import OpenAI
from app.config import settings
from app.settings_db import get_all_settings

ANALYSIS_PROMPT = """You are a forensic accounting analyst. Given a comparison between an extracted receipt (from PDF) and an accounting system entry, analyze the discrepancy.

Respond with JSON:
{
  "ai_classification": "correct" | "minor_mistake" | "potential_fraud" | "forensic_required",
  "summary": "one-sentence explanation of what differs and why",
  "details": ["bullet point 1", "bullet point 2", ...],
  "risk_level": "low" | "medium" | "high"
}

Rules:
- If amounts match within rounding (<0.5%), it's likely correct
- Small date differences or name typos are minor
- Large amount differences or missing entries need forensic review
- Duplicate receipts are potential fraud
- Be conservative — don't call something fraud unless it clearly is
- Return ONLY valid JSON, no markdown"""


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
    http_client = httpx.Client(timeout=httpx.Timeout(25.0, connect=10.0))
    if cfg["provider"] == "nvidia":
        return OpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"], http_client=http_client)
    return OpenAI(api_key=cfg["api_key"], http_client=http_client)


def analyze_discrepancy(proof: dict, entry: dict, current_classification: str) -> dict:
    from app.supabase_client import supabase

    proof_receipt_id = proof.get("id")
    proof_id = proof.get("proof_id")

    def _log_entry(status: str, msg: str):
        try:
            supabase.table("processing_log").insert({
                "proof_id": proof_id,
                "stage": "reconciliation_analysis",
                "status": status,
                "message": msg[:2000],
            }).execute()
        except Exception:
            pass

    try:
        comparison = {
            "receipt_number": {"proof": proof.get("receipt_number"), "accounting": entry.get("receipt_number")},
            "amount": {"proof": proof.get("amount"), "accounting": entry.get("amount")},
            "currency": {"proof": proof.get("currency"), "accounting": entry.get("currency")},
            "payer_name": {"proof": proof.get("payer_name"), "accounting": entry.get("payer_name")},
            "payment_date": {"proof": proof.get("payment_date"), "accounting": entry.get("payment_date")},
            "description": {"proof": proof.get("description"), "accounting": entry.get("description")},
            "current_classification": current_classification,
        }

        cfg = _get_config()
        model = cfg["model"]
        client = _get_client(cfg)
        _log_entry("success", f"Calling LLM ({model}) for reconciliation analysis — receipt {proof_receipt_id}, classification: {current_classification}")
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": ANALYSIS_PROMPT},
                {"role": "user", "content": f"Analyze this discrepancy:\n\n{json.dumps(comparison, indent=2)}"},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=400,
        )
        raw = response.choices[0].message.content
        if not raw:
            _log_entry("failure", f"LLM returned empty response for receipt {proof_receipt_id}")
            return {"ai_classification": current_classification, "summary": "", "details": [], "risk_level": "low"}
        result = json.loads(raw)
        _log_entry("success", f"LLM analysis complete for receipt {proof_receipt_id}: risk={result.get('risk_level')}, ai_class={result.get('ai_classification')}")
        return {
            "ai_classification": result.get("ai_classification", current_classification),
            "summary": result.get("summary", ""),
            "details": result.get("details", []),
            "risk_level": result.get("risk_level", "low"),
        }
    except Exception as e:
        msg = f"LLM analysis error for receipt {proof_receipt_id}: {e}"
        print(f"[Recon Analyzer] {msg}")
        _log_entry("failure", msg)
        return {"ai_classification": current_classification, "summary": "", "details": [], "risk_level": "low"}
