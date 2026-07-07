import uuid
import math
import threading
from datetime import datetime
from collections import Counter
from difflib import SequenceMatcher
from statistics import median, stdev
from app.supabase_client import supabase

BENFORD_EXPECTED = {d: round(math.log10(1 + 1 / d), 4) for d in range(1, 10)}

_progress = {
    "status": "idle",
    "progress": 0,
    "total_steps": 3,
    "current_step": "",
    "message": "",
}
_lock = threading.Lock()


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
                 details: dict | None = None, dup_group: str | None = None):
    try:
        supabase.table("forensic_flags").insert({
            "receipt_id": receipt_id,
            "analysis_type": analysis_type,
            "score": round(score, 4),
            "flag": flag,
            "details": details,
            "duplicate_group_id": dup_group,
        }).execute()
    except Exception as e:
        print(f"[Forensic] Insert flag error: {e}")


def _get_all_receipts() -> list[dict]:
    result = supabase.table("proof_of_payment_receipt").select("*").execute()
    return result.data or []


def _first_digit(n) -> int:
    try:
        return int(str(abs(float(n))).lstrip("0.")[0])
    except (ValueError, IndexError):
        return 0


def run_forensic_analysis():
    _set_status("running")
    _set_progress(0, "Starting forensic analysis...", "Fetching receipt data")

    receipts = _get_all_receipts()
    if not receipts:
        _set_status("completed")
        _set_progress(100, "Complete", "No receipts to analyze")
        return {"status": "completed", "message": "No receipts found"}

    total_receipts = len(receipts)
    _clear_flags()
    _log(receipts[0].get("proof_id") or receipts[0]["id"], "forensic_analysis", "success",
         f"Forensic analysis started — {total_receipts} receipts")

    _set_progress(5, "Cleared previous flags", f"Analyzing {total_receipts} receipts")

    STEP_WEIGHT = 30

    benford = _run_benford(receipts)
    _set_progress(5 + STEP_WEIGHT, "Benford's Law complete",
                  f"Benford: chi-square={benford.get('chi_square', 0):.2f}, p-value={benford.get('p_value', 0):.4f}")

    duplicates = _run_duplicate_detection(receipts)
    _set_progress(5 + STEP_WEIGHT * 2, "Duplicate detection complete",
                  f"Duplicates: {duplicates.get('total_groups', 0)} groups, {duplicates.get('total_flags', 0)} flags")

    anomalies = _run_anomaly_scoring(receipts)
    _set_progress(5 + STEP_WEIGHT * 3, "Anomaly scoring complete",
                  f"Anomalies: {anomalies.get('total_flags', 0)} flags")

    total_flags = benford.get("total_flags", 0) + duplicates.get("total_flags", 0) + anomalies.get("total_flags", 0)

    _log(receipts[0].get("proof_id") or receipts[0]["id"], "forensic_analysis", "success",
         f"Forensic analysis complete — {total_flags} total flags (Benford: {benford.get('total_flags', 0)}, "
         f"Duplicates: {duplicates.get('total_flags', 0)}, Anomalies: {anomalies.get('total_flags', 0)})")

    result = {
        "status": "completed",
        "total_receipts": total_receipts,
        "total_flags": total_flags,
        "benford": benford,
        "duplicates": duplicates,
        "anomalies": anomalies,
    }

    try:
        run_record = supabase.table("forensic_runs").insert({
            "status": "completed",
            "progress": 100,
            "total_steps": 3,
            "current_step": "Complete",
            "results": result,
            "completed_at": datetime.utcnow().isoformat(),
        }).execute()
        run_id = run_record.data[0]["id"] if run_record.data else None
        result["run_id"] = run_id
    except Exception:
        pass

    _set_status("completed")
    _set_progress(100, "Complete", f"Analysis finished — {total_flags} flags across {total_receipts} receipts")

    return result


def _run_benford(receipts: list[dict]) -> dict:
    from scipy.stats import chisquare

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
