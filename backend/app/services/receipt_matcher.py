import json
from datetime import datetime
from difflib import SequenceMatcher
from typing import Optional, Tuple

from app.supabase_client import supabase
from app.services.reconciliation_analyzer import analyze_discrepancy


def _parse_date(d: Optional[str]) -> Optional[datetime]:
    if not d:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(d.strip(), fmt)
        except ValueError:
            continue
    return None


def _fuzzy_pct(a: Optional[str], b: Optional[str]) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _amount_diff(a: Optional[float], b: Optional[float]) -> Tuple[float, float]:
    a = a or 0.0
    b = b or 0.0
    diff = a - b
    pct = abs(diff) / b * 100 if b != 0 else 100.0
    return diff, pct


def _classify(amount_diff_pct: float, date_diff_days: Optional[int], match_score: float) -> Tuple[str, dict]:
    rules = {}
    if amount_diff_pct <= 0.5 and match_score >= 0.9:
        rules = {"amount_match": True, "score_match": True}
        return "correct", rules
    if amount_diff_pct < 5:
        rules = {"amount_diff_pct": amount_diff_pct, "threshold": "minor"}
        return "minor_mistake", rules
    if amount_diff_pct <= 20 or (date_diff_days is not None and date_diff_days > 30):
        rules = {"amount_diff_pct": amount_diff_pct, "date_diff_days": date_diff_days}
        return "potential_fraud", rules
    rules = {"amount_diff_pct": amount_diff_pct, "date_diff_days": date_diff_days}
    return "forensic_required", rules


def _match_single(proof: dict, entries: list[dict]) -> Optional[dict]:
    best = None
    best_score = 0.0

    for entry in entries:
        score = 0.0
        factors = {}
        pr_num = (proof.get("receipt_number") or "").strip().lower()
        acc_num = (entry.get("receipt_number") or "").strip().lower()
        if pr_num and acc_num and pr_num == acc_num:
            score = 0.98
            factors["receipt_number_exact"] = True
        else:
            amt_match = 0.0
            pa = proof.get("amount")
            ea = entry.get("amount")
            if pa and ea:
                ratio = min(pa, ea) / max(pa, ea) if max(pa, ea) > 0 else 0.0
                if ratio >= 0.995:
                    amt_match = 1.0
                elif ratio >= 0.95:
                    amt_match = 0.6
                elif ratio >= 0.8:
                    amt_match = 0.3
            else:
                amt_match = 0.6
            factors["amount_similarity"] = amt_match

            date_match = 0.0
            pd = _parse_date(proof.get("payment_date"))
            ed = _parse_date(entry.get("payment_date"))
            if pd and ed:
                days = abs((pd - ed).days)
                if days <= 3:
                    date_match = 1.0
                elif days <= 30:
                    date_match = 0.5
                else:
                    date_match = 0.1
            else:
                date_match = 0.5
            factors["date_similarity"] = date_match

            name_sim = _fuzzy_pct(proof.get("payer_name"), entry.get("payer_name"))
            factors["name_similarity"] = name_sim

            score = amt_match * 0.4 + date_match * 0.3 + name_sim * 0.3

        if score > best_score:
            best_score = score
            best = {"entry": entry, "score": score, "factors": factors}

    if best and best_score >= 0.4:
        return best
    return None


def _recon_log(proof_id: str | None, status: str, message: str):
    if not proof_id:
        return
    try:
        supabase.table("processing_log").insert({
            "proof_id": proof_id,
            "stage": "reconciliation",
            "status": status,
            "message": message[:2000],
        }).execute()
    except Exception:
        pass


def run_reconciliation(date_from: str = None, date_to: str = None, org_id: str = None) -> dict:
    from app.reconciliation_progress import start, tick, complete, fail

    start(0)

    def _apply_date_range(q):
        if date_from:
            q = q.gte("payment_date", date_from)
        if date_to:
            q = q.lte("payment_date", date_to)
        return q

    tick(0, "Counting proofs and accounting entries...")

    count_q = supabase.table("proof_of_payment_receipt").select("id", count="exact").in_("status", ["extracted", "reviewed", "synced", "completed"])
    if org_id:
        count_q = count_q.eq("org_id", org_id)
    count_q = _apply_date_range(count_q)
    proof_count_raw = count_q.execute()
    proof_count = proof_count_raw.count if hasattr(proof_count_raw, "count") else 0

    entry_count_q = supabase.table("accounting_receipts").select("id", count="exact").eq("status", "posted")
    if org_id:
        entry_count_q = entry_count_q.eq("org_id", org_id)
    entry_count_q = _apply_date_range(entry_count_q)
    entry_count_raw = entry_count_q.execute()
    entry_count = entry_count_raw.count if hasattr(entry_count_raw, "count") else 0

    total = proof_count
    start(total)

    proof_q = supabase.table("proof_of_payment_receipt").select("*").in_("status", ["extracted", "reviewed", "synced", "completed"])
    if org_id:
        proof_q = proof_q.eq("org_id", org_id)
    proof_q = _apply_date_range(proof_q)
    proofs = proof_q.execute()

    entry_q = supabase.table("accounting_receipts").select("*").eq("status", "posted")
    if org_id:
        entry_q = entry_q.eq("org_id", org_id)
    entry_q = _apply_date_range(entry_q)
    entries = entry_q.execute()

    proof_list = proofs.data if proofs.data else []
    entry_list = entries.data if entries.data else []

    _recon_log(proof_list[0].get("proof_id") if proof_list else (entry_list[0].get("id") if entry_list else None), "success",
               f"Reconciliation started — {len(proof_list)} proofs, {len(entry_list)} entries, range: {date_from or 'any'} → {date_to or 'any'}")

    matched_count = 0
    unmatched_proofs = 0
    unmatched_entries = 0
    processed = 0

    used_entry_ids = set()
    results = []

    for proof in proof_list:
        processed += 1
        label = proof.get("receipt_number") or proof.get("payer_name") or proof["id"][:8]
        tick(processed, f"Matching receipt {label}")

        match = _match_single(proof, [e for e in entry_list if e["id"] not in used_entry_ids])
        if match:
            entry = match["entry"]
            used_entry_ids.add(entry["id"])
            amount_diff, amount_diff_pct = _amount_diff(proof.get("amount"), entry.get("amount"))
            pd = _parse_date(proof.get("payment_date"))
            ed = _parse_date(entry.get("payment_date"))
            date_diff_days = abs((pd - ed).days) if pd and ed else None
            classification, rules = _classify(amount_diff_pct, date_diff_days, match["score"])

            matched_fields = {
                "amount": abs(amount_diff_pct) <= 0.5,
                "date": date_diff_days is not None and date_diff_days <= 3,
                "payer_name": _fuzzy_pct(proof.get("payer_name"), entry.get("payer_name")) >= 0.8,
            }

            analysis = None
            if classification != "correct":
                try:
                    analysis = analyze_discrepancy(proof, entry, classification)
                except Exception:
                    pass

            result = {
                "org_id": org_id,
                "proof_receipt_id": proof["id"],
                "accounting_entry_id": entry["id"],
                "match_type": "auto",
                "matching_score": round(match["score"], 4),
                "amount_diff": round(amount_diff, 4),
                "amount_diff_pct": round(amount_diff_pct, 4),
                "date_diff_days": date_diff_days,
                "matched_fields": json.dumps(matched_fields),
                "classification": classification,
                "classification_rules": json.dumps(rules),
                "ai_analysis": json.dumps(analysis) if analysis else None,
            }
            results.append(result)
            matched_count += 1
            _recon_log(proof.get("proof_id"), "success",
                       f"Matched receipt {proof['id'][:8]} → entry {entry['id'][:8]}: {classification}, diff={amount_diff:.2f}")
        else:
            unmatched_proofs += 1
            _recon_log(proof.get("proof_id"), "success",
                       f"No match found for receipt {proof['id'][:8]} ({proof.get('receipt_number') or proof.get('payer_name', '')})")
            result = {
                "org_id": org_id,
                "proof_receipt_id": proof["id"],
                "accounting_entry_id": None,
                "match_type": "unmatched_proof",
                "matching_score": 0.0,
                "amount_diff": None,
                "amount_diff_pct": None,
                "date_diff_days": None,
                "matched_fields": None,
                "classification": "forensic_required",
                "classification_rules": json.dumps({"reason": "no matching accounting entry found"}),
            }
            results.append(result)

    for entry in entry_list:
        if entry["id"] not in used_entry_ids:
            unmatched_entries += 1
            result = {
                "org_id": org_id,
                "proof_receipt_id": None,
                "accounting_entry_id": entry["id"],
                "match_type": "unmatched_entry",
                "matching_score": 0.0,
                "amount_diff": None,
                "amount_diff_pct": None,
                "date_diff_days": None,
                "matched_fields": None,
                "classification": "forensic_required",
                "classification_rules": json.dumps({"reason": "no supporting proof document found"}),
            }
            results.append(result)

    for i, r in enumerate(results):
        try:
            query = supabase.table("reconciliation_results").select("id")
            pid = r.get("proof_receipt_id")
            if pid:
                query = query.eq("proof_receipt_id", pid)
            else:
                query = query.is_("proof_receipt_id", "null")
            eid = r.get("accounting_entry_id")
            if eid:
                query = query.eq("accounting_entry_id", eid)
            else:
                query = query.is_("accounting_entry_id", "null")
            existing = query.execute()
            if existing.data:
                supabase.table("reconciliation_results").update(r).eq("id", existing.data[0]["id"]).execute()
            else:
                supabase.table("reconciliation_results").insert(r).execute()
        except Exception as e:
            print(f"[Matcher] Save error: {e}")

    complete()

    log_proof_id = proof_list[0].get("proof_id") if proof_list else None
    if not log_proof_id and entry_list:
        log_proof_id = entry_list[0].get("id")
    _recon_log(log_proof_id, "success",
               f"Reconciliation complete — {matched_count} matched, {unmatched_proofs} unmatched proofs, {unmatched_entries} unmatched entries")

    return {
        "total_proofs": len(proof_list),
        "total_entries": len(entry_list),
        "matched": matched_count,
        "unmatched_proofs": unmatched_proofs,
        "unmatched_entries": unmatched_entries,
    }
