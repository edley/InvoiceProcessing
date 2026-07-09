import uuid
import json
import math
import re
import threading
import httpx
from datetime import datetime, timezone
from collections import Counter
from difflib import SequenceMatcher
from statistics import median, stdev
from scipy.stats import chisquare
from openai import OpenAI
from app.supabase_client import supabase
from app.config import settings
from app.settings_db import get_all_settings

BENFORD_EXPECTED = {d: round(math.log10(1 + 1 / d), 4) for d in range(1, 10)}

def _make_progress():
    return {
        "status": "idle",
        "progress": 0,
        "total_steps": 4,
        "current_step": "",
        "message": "",
    }

_progress = _make_progress()
_lock = threading.Lock()
_cancelled = False
MAX_RUN_SECONDS = 300


def get_progress():
    with _lock:
        return dict(_progress)


def _set_progress(pct: int, step: str, msg: str = ""):
    with _lock:
        _progress["progress"] = pct
        _progress["current_step"] = step
        _progress["message"] = msg


def _set_status(status: str):
    with _lock:
        _progress["status"] = status


def cancel_analysis():
    global _cancelled
    with _lock:
        _cancelled = True
        _progress["status"] = "cancelled"
        _progress["current_step"] = "Cancelled"
        _progress["message"] = "Analysis cancelled by user"


def _check_cancelled(started_at: datetime | None = None) -> bool:
    with _lock:
        if _cancelled:
            return True
    if started_at:
        elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
        if elapsed > MAX_RUN_SECONDS:
            with _lock:
                _progress["status"] = "failed"
                _progress["current_step"] = "Timed out"
                _progress["message"] = f"Analysis exceeded {MAX_RUN_SECONDS}s timeout"
            return True
    return False


def _log(proof_id: str | None, stage: str, status: str, message: str):
    if not proof_id:
        return
    try:
        supabase.table("processing_log").insert({
            "proof_id": proof_id,
            "stage": stage,
            "status": status,
            "message": message[:2000],
        }).execute()
    except Exception:
        pass


def _clear_flags():
    try:
        supabase.table("forensic_flags").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    except Exception:
        pass


def _insert_flag(receipt_id: str, analysis_type: str, score: float, flag: str,
                 org_id: str | None = None, details: dict | None = None, dup_group: str | None = None):
    try:
        supabase.table("forensic_flags").insert({
            "org_id": org_id,
            "receipt_id": receipt_id,
            "analysis_type": analysis_type,
            "score": round(score, 4),
            "flag": flag,
            "details": details,
            "duplicate_group_id": dup_group,
        }).execute()
    except Exception as e:
        print(f"[Forensic] Insert flag error: {e}")


def _get_all_receipts(org_id: str | None = None) -> list[dict]:
    q = supabase.table("proof_of_payment_receipt").select("*")
    if org_id:
        q = q.eq("org_id", org_id)
    result = q.execute()
    return result.data or []


def _first_digit(n) -> int:
    try:
        return int(str(abs(float(n))).lstrip("0.")[0])
    except (ValueError, IndexError):
        return 0


FORENSIC_LLM_PROMPT = """You are a senior forensic accounting investigator. Given a list of payment receipts that have already been flagged by statistical checks, analyze them for suspicious patterns.

For each receipt, consider:
1. **Payer/payee patterns** — does the same vendor appear under slightly different names?
2. **Amount anomalies** — round numbers just below a threshold, or amounts that don't match the description
3. **Temporal patterns** — multiple payments to the same entity on the same day
4. **Description mismatches** — descriptions that seem inconsistent with the payer/vendor
5. **Contextual fraud indicators** — anything a human investigator would flag

Return a JSON object with:
{
  "receipts": [
    {
      "receipt_id": "<the receipt id from the input>",
      "flag": "short flag name",
      "analysis_type": "narrative" | "pattern" | "contextual",
      "score": 0.0-1.0,
      "explanation": "one sentence explanation"
    }
  ]
}

Be conservative — only flag genuine concerns. Return ONLY valid JSON, no markdown."""


def _get_llm_config():
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


def _get_llm_client(cfg: dict):
    http_client = httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0))
    if cfg["provider"] == "nvidia":
        return OpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"], http_client=http_client)
    return OpenAI(api_key=cfg["api_key"], http_client=http_client)


def _extract_json(text: str) -> dict | None:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                pass
        m = re.search(r'\{[\s\S]*\}', text)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    return None


def _run_llm_forensic(receipts: list[dict], org_id: str | None = None) -> dict:
    flagged = 0
    total = len(receipts)
    if total == 0:
        return {"total_flags": 0, "message": "No receipts for analysis"}

    cfg = _get_llm_config()
    if not cfg.get("api_key"):
        _set_progress(0, "LLM Analysis — skipped", "No LLM API key configured")
        return {"total_flags": 0, "message": "LLM not configured"}

    client = _get_llm_client(cfg)

    BATCH_SIZE = 10
    batches = [receipts[i:i + BATCH_SIZE] for i in range(0, total, BATCH_SIZE)]

    for bi, batch in enumerate(batches):
        if _check_cancelled():
            return {"total_flags": flagged, "batches": bi, "cancelled": True}
        batch_input = []
        for r in batch:
            batch_input.append({
                "id": r.get("id"),
                "receipt_number": r.get("receipt_number"),
                "amount": r.get("amount"),
                "currency": r.get("currency"),
                "payer_name": r.get("payer_name"),
                "bank_issuer": r.get("bank_issuer"),
                "description": r.get("description"),
                "payment_date": r.get("payment_date"),
                "payee": r.get("payee"),
            })

        pct = int(5 + 95 * (bi + 1) / len(batches))
        _set_progress(pct, "LLM Analysis", f"Calling LLM — batch {bi + 1}/{len(batches)} ({len(batch)} receipts)")

        try:
            kwargs = {
                "model": cfg["model"],
                "messages": [
                    {"role": "system", "content": FORENSIC_LLM_PROMPT},
                    {"role": "user", "content": f"Analyze these payment receipts for suspicious patterns:\n\n{json.dumps(batch_input, indent=2)}"},
                ],
                "temperature": 0.1,
                "max_tokens": 1000,
            }
            if cfg.get("provider") != "nvidia":
                kwargs["response_format"] = {"type": "json_object"}
            response = client.chat.completions.create(**kwargs)
            raw = response.choices[0].message.content
            if not raw:
                continue

            result = _extract_json(raw)
            if not result:
                continue
            for item in result.get("receipts", []):
                _insert_flag(
                    receipt_id=item.get("receipt_id"),
                    analysis_type=item.get("analysis_type", "narrative"),
                    score=item.get("score", 0.5),
                    flag=item.get("flag", "LLM flagged"),
                    org_id=org_id,
                    details={
                        "explanation": item.get("explanation"),
                        "source": "llm_analysis",
                    },
                )
                flagged += 1
        except Exception:
            pass

    return {"total_flags": flagged, "batches": len(batches)}


def run_forensic_analysis(org_id: str | None = None):
    global _cancelled
    with _lock:
        _cancelled = False
    _set_status("running")
    _set_progress(0, "Fetching receipts", "Loading receipt data from database")
    started_at = datetime.now(timezone.utc)

    receipts = _get_all_receipts(org_id)
    if not receipts:
        _set_status("completed")
        _set_progress(100, "Complete", "No receipts to analyze")
        return {"status": "completed", "message": "No receipts found"}

    total_receipts = len(receipts)
    _clear_flags()
    _log(receipts[0].get("proof_id") or receipts[0]["id"], "forensic_analysis", "success",
         f"Forensic analysis started — {total_receipts} receipts")

    _set_progress(5, "Fetching receipts", f"Found {total_receipts} receipts to analyze")

    STEP_WEIGHT = 22
    benford = {}
    duplicates = {}
    anomalies = {}
    llm = {"total_flags": 0, "batches": 0}

    try:
        if _check_cancelled(started_at):
            return {"status": "cancelled", "total_receipts": total_receipts, "total_flags": 0}

        _set_progress(5, "Running Benford's Law...", "Computing first-digit frequency distribution")
        benford = _run_benford(receipts)
        _set_progress(5 + STEP_WEIGHT, "Benford's Law complete",
                      f"Benford: chi-square={benford.get('chi_square', 0):.2f}, p-value={benford.get('p_value', 0):.4f}")

        if _check_cancelled(started_at):
            return {"status": "cancelled", "total_receipts": total_receipts, "total_flags": 0}

        _set_progress(5 + STEP_WEIGHT, "Running duplicate detection...", "Comparing receipts for near-duplicate payments")
        duplicates = _run_duplicate_detection(receipts)
        _set_progress(5 + STEP_WEIGHT * 2, "Duplicate detection complete",
                      f"Duplicates: {duplicates.get('total_groups', 0)} groups, {duplicates.get('total_flags', 0)} flags")

        if _check_cancelled(started_at):
            return {"status": "cancelled", "total_receipts": total_receipts, "total_flags": 0}

        _set_progress(5 + STEP_WEIGHT * 2, "Running anomaly scoring...", "Scoring receipts for statistical outliers")
        anomalies = _run_anomaly_scoring(receipts)
        _set_progress(5 + STEP_WEIGHT * 3, "Anomaly scoring complete",
                      f"Anomalies: {anomalies.get('total_flags', 0)} flags")

        if _check_cancelled(started_at):
            return {"status": "cancelled", "total_receipts": total_receipts, "total_flags": 0}

        _set_progress(5 + STEP_WEIGHT * 3, "LLM Analysis - Connecting", "Establishing connection to AI provider...")
        llm = _run_llm_forensic(receipts, org_id)
        _set_progress(5 + STEP_WEIGHT * 4, "LLM analysis complete",
                      f"LLM: {llm.get('total_flags', 0)} flags across {llm.get('batches', 0)} batches")

        total_flags = benford.get("total_flags", 0) + duplicates.get("total_flags", 0) + anomalies.get("total_flags", 0) + llm.get("total_flags", 0)

        _log(receipts[0].get("proof_id") or receipts[0]["id"], "forensic_analysis", "success",
             f"Forensic analysis complete — {total_flags} total flags (Benford: {benford.get('total_flags', 0)}, "
             f"Duplicates: {duplicates.get('total_flags', 0)}, Anomalies: {anomalies.get('total_flags', 0)}, LLM: {llm.get('total_flags', 0)})")

        result = {
            "status": "completed",
            "total_receipts": total_receipts,
            "total_flags": total_flags,
            "benford": benford,
            "duplicates": duplicates,
            "anomalies": anomalies,
            "llm_analysis": llm,
        }

        try:
            run_record = supabase.table("forensic_runs").insert({
                "status": "completed",
                "progress": 100,
                "total_steps": 4,
                "current_step": "Complete",
                "results": result,
                "org_id": org_id,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).execute()
            run_id = run_record.data[0]["id"] if run_record.data else None
            result["run_id"] = run_id
        except Exception:
            pass

        _set_status("completed")
        _set_progress(100, "Complete", f"Analysis finished — {total_flags} flags across {total_receipts} receipts")

        return result
    except Exception as e:
        _set_status("failed")
        _set_progress(0, "Failed", f"Error: {str(e)[:200]}")
        return {"status": "failed", "error": str(e)}


def _run_benford(receipts: list[dict]) -> dict:
    amounts = []
    valid_receipts = 0
    for r in receipts:
        amt = r.get("amount")
        if amt is not None and float(amt) > 0:
            amounts.append(float(amt))
            valid_receipts += 1

    if not amounts:
        return {"total_flags": 0, "message": "No valid amounts", "observed": {}, "expected": BENFORD_EXPECTED}

    observed_counts = Counter()
    for amt in amounts:
        d = _first_digit(amt)
        if d:
            observed_counts[d] += 1

    n = sum(observed_counts.values())
    if n == 0:
        return {"total_flags": 0, "message": "No valid first digits"}

    observed_freq = {d: observed_counts.get(d, 0) / n for d in range(1, 10)}
    expected_freq = BENFORD_EXPECTED

    observed_vals = [observed_counts.get(d, 0) for d in range(1, 10)]
    expected_vals = [expected_freq[d] * n for d in range(1, 10)]

    chi2_stat, p_value = chisquare(observed_vals, expected_vals)

    flags = []
    for d in range(1, 10):
        obs = observed_counts.get(d, 0)
        exp = expected_freq[d] * n
        deviation = (obs - exp) / exp * 100 if exp > 0 else 0
        if abs(deviation) > 20:
            for r in receipts:
                amt = r.get("amount")
                if amt and _first_digit(float(amt)) == d:
                    _insert_flag(
                        receipt_id=r["id"],
                        analysis_type="benford",
                        score=abs(deviation) / 100,
                        flag=f"Digit {d} frequency deviation {deviation:+.1f}%",
                        org_id=r.get("org_id"),
                        details={
                            "digit": d,
                            "expected_pct": round(expected_freq[d] * 100, 2),
                            "observed_pct": round(obs / n * 100, 2),
                            "deviation_pct": round(deviation, 2),
                            "count": obs,
                        },
                    )
                    flags.append(r["id"])

    return {
        "total_flags": len(set(flags)),
        "chi_square": round(chi2_stat, 4),
        "p_value": round(p_value, 4),
        "conformity": "conforms" if p_value > 0.05 else "non_conformant",
        "total_amounts": len(amounts),
        "observed": {str(k): round(v, 4) for k, v in observed_freq.items()},
        "expected": {str(k): v for k, v in expected_freq.items()},
        "flagged_digits": sorted(set(
            int(r.get("details", {}).get("digit", 0))
            for r in (supabase.table("forensic_flags").select("details").eq("analysis_type", "benford").execute().data or [])
            if r.get("details")
        )),
    }


def _run_duplicate_detection(receipts: list[dict]) -> dict:
    flagged_ids = set()
    groups = []

    for i, a in enumerate(receipts):
        if a.get("id") in flagged_ids:
            continue
        amt_a = a.get("amount")
        if amt_a is None:
            continue
        amt_a = float(amt_a)

        group = [a]
        for j, b in enumerate(receipts):
            if i >= j or b.get("id") in flagged_ids:
                continue
            amt_b = b.get("amount")
            if amt_b is None:
                continue
            amt_b = float(amt_b)

            if amt_a == 0:
                continue
            amt_ratio = min(amt_a, amt_b) / max(amt_a, amt_b)
            if amt_ratio < 0.95:
                continue

            name_a = (a.get("payer_name") or "").strip().lower()
            name_b = (b.get("payer_name") or "").strip().lower()
            if not name_a or not name_b:
                name_sim = 1.0 if (not name_a and not name_b) else 0.5
            else:
                name_sim = SequenceMatcher(None, name_a, name_b).ratio()

            if name_sim < 0.8:
                continue

            date_a = a.get("payment_date")
            date_b = b.get("payment_date")
            date_diff = None
            try:
                if date_a and date_b:
                    da = datetime.strptime(str(date_a)[:10], "%Y-%m-%d")
                    db = datetime.strptime(str(date_b)[:10], "%Y-%m-%d")
                    date_diff = abs((da - db).days)
            except (ValueError, TypeError):
                pass

            if date_diff is not None and date_diff > 90:
                continue

            group.append(b)
            flagged_ids.add(b.get("id"))

        if len(group) > 1:
            group_id = str(uuid.uuid4())
            flagged_ids.add(a.get("id"))
            members = []
            for m in group:
                score = 1.0
                details_data = {"group_size": len(group), "group_id": group_id}
                _insert_flag(
                    receipt_id=m["id"],
                    analysis_type="duplicate",
                    score=score,
                    flag=f"Potential duplicate (group of {len(group)})",
                    org_id=m.get("org_id"),
                    details=details_data,
                    dup_group=group_id,
                )
                members.append(m["id"])
            groups.append({"group_id": group_id, "size": len(group), "members": members})

    return {
        "total_flags": len(flagged_ids),
        "total_groups": len(groups),
        "groups": groups,
    }


def _run_anomaly_scoring(receipts: list[dict]) -> dict:
    amounts = []
    amount_map = []
    for r in receipts:
        amt = r.get("amount")
        if amt is not None and float(amt) > 0:
            amounts.append(float(amt))
            amount_map.append(r)

    if not amounts:
        return {"total_flags": 0}

    med = median(amounts)
    try:
        sd = stdev(amounts)
    except Exception:
        sd = 0

    q1 = sorted(amounts)[len(amounts) // 4]
    q3 = sorted(amounts)[len(amounts) * 3 // 4]
    iqr = q3 - q1
    lower_fence = q1 - 1.5 * iqr
    upper_fence = q3 + 1.5 * iqr

    flagged = 0
    for r in receipts:
        amt = r.get("amount")
        if amt is None:
            continue
        amt = float(amt)
        if amt <= 0:
            continue

        reasons = []
        score = 0.0

        z = (amt - med) / sd if sd > 0 else 0
        if abs(z) > 2.5:
            reasons.append(f"Amount z-score={z:.2f} (|z|>2.5)")
            score = min(1.0, abs(z) / 5)

        if amt > upper_fence or amt < lower_fence:
            reasons.append(f"IQR outlier (outside [{lower_fence:.2f}, {upper_fence:.2f}])")
            score = max(score, 0.7)

        date_str = r.get("payment_date")
        if date_str:
            try:
                dt = datetime.strptime(str(date_str)[:10], "%Y-%m-%d")
                if dt.weekday() >= 5:
                    reasons.append(f"Weekend payment ({dt.strftime('%A')})")
                    score = max(score, 0.4)
            except (ValueError, TypeError):
                pass

        multiplier = amt / med if med > 0 else 1
        if multiplier > 10:
            reasons.append(f"Amount {multiplier:.0f}x median ({med:.2f})")
            score = max(score, min(1.0, multiplier / 20))

        if reasons and score >= 0.3:
            _insert_flag(
                receipt_id=r["id"],
                analysis_type="anomaly",
                score=score,
                flag=reasons[0][:100],
                org_id=r.get("org_id"),
                details={
                    "reasons": reasons,
                    "z_score": round(z, 4),
                    "amount": amt,
                    "median": round(med, 2),
                    "iqr_lower": round(lower_fence, 2),
                    "iqr_upper": round(upper_fence, 2),
                    "multiplier_vs_median": round(multiplier, 2),
                },
            )
            flagged += 1

    return {
        "total_flags": flagged,
        "total_receipts": len(amounts),
        "median": round(med, 2),
        "iqr_range": [round(lower_fence, 2), round(upper_fence, 2)],
        "z_score_threshold": 2.5,
    }
