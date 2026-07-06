import json
from openai import OpenAI
from app.config import settings

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


def _get_client():
    if settings.llm_provider == "nvidia":
        return OpenAI(
            api_key=settings.nvidia_api_key,
            base_url=settings.nvidia_base_url,
        )
    return OpenAI(api_key=settings.openai_api_key)


def _get_model():
    if settings.llm_provider == "nvidia":
        return settings.nvidia_model
    return settings.llm_model


def analyze_discrepancy(proof: dict, entry: dict, current_classification: str) -> dict:
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

        client = _get_client()
        model = _get_model()
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
            return {"ai_classification": current_classification, "summary": "", "details": [], "risk_level": "low"}
        result = json.loads(raw)
        return {
            "ai_classification": result.get("ai_classification", current_classification),
            "summary": result.get("summary", ""),
            "details": result.get("details", []),
            "risk_level": result.get("risk_level", "low"),
        }
    except Exception as e:
        print(f"[Recon Analyzer] Error: {e}")
        return {"ai_classification": current_classification, "summary": "", "details": [], "risk_level": "low"}
