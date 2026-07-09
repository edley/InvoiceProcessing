from fastapi import APIRouter, Request
from app.supabase_client import supabase
from app.services.org_service import require_org

router = APIRouter()


@router.get("/dashboard/stats")
def dashboard_stats(request: Request):
    try:
        org_id = require_org(request)

        proofs_all = supabase.table("payment_proofs").select("status").eq("org_id", org_id).execute()
        proofs_rows = proofs_all.data if proofs_all.data else []
        proofs_total = len(proofs_rows)
        proofs_by_status: dict[str, int] = {}
        for r in proofs_rows:
            s = r.get("status", "unknown")
            proofs_by_status[s] = proofs_by_status.get(s, 0) + 1
        proofs_completed = proofs_by_status.get("completed", 0) + proofs_by_status.get("ready_to_process", 0)

        receipts_all = supabase.table("proof_of_payment_receipt").select("status").eq("org_id", org_id).execute()
        receipts_rows = receipts_all.data if receipts_all.data else []
        receipts_total = len(receipts_rows)
        receipts_by_status: dict[str, int] = {}
        for r in receipts_rows:
            s = r.get("status", "unknown")
            receipts_by_status[s] = receipts_by_status.get(s, 0) + 1
        receipts_reviewed = receipts_by_status.get("reviewed", 0) + receipts_by_status.get("synced", 0) + receipts_by_status.get("completed", 0)

        rec_all = supabase.table("reconciliation_results").select("classification").eq("org_id", org_id).execute()
        rec_rows = rec_all.data if rec_all.data else []
        rec_total = len(rec_rows)
        rec_by_class: dict[str, int] = {}
        for r in rec_rows:
            c = r.get("classification", "pending")
            rec_by_class[c] = rec_by_class.get(c, 0) + 1
        fraud_count = rec_by_class.get("potential_fraud", 0) + rec_by_class.get("forensic_required", 0) + rec_by_class.get("fraud_detected", 0)

        audit_all = supabase.table("receipt_field_audit").select("receipt_id", count="exact").eq("org_id", org_id).execute()
        audit_receipt_ids = set()
        for r in (audit_all.data or []):
            rid = r.get("receipt_id")
            if rid:
                audit_receipt_ids.add(rid)
        receipts_with_audit = len(audit_receipt_ids)
        receipts_without_audit = max(0, receipts_total - receipts_with_audit)

        return {
            "proofs": {
                "total": proofs_total,
                "by_status": proofs_by_status,
                "completed_pct": round((proofs_completed / proofs_total * 100) if proofs_total else 0, 1),
            },
            "receipts": {
                "total": receipts_total,
                "by_status": receipts_by_status,
                "reviewed_pct": round((receipts_reviewed / receipts_total * 100) if receipts_total else 0, 1),
                "needing_review": receipts_by_status.get("review_needed", 0),
            },
            "reconciliation": {
                "total": rec_total,
                "by_classification": rec_by_class,
                "fraud_pct": round((fraud_count / rec_total * 100) if rec_total else 0, 1),
                "fraud_count": fraud_count,
            },
            "audit": {
                "receipts_with_audit": receipts_with_audit,
                "receipts_without_audit": receipts_without_audit,
                "coverage_pct": round((receipts_with_audit / receipts_total * 100) if receipts_total else 0, 1),
            },
            "human_intervention": {
                "receipts_needing_review": receipts_by_status.get("review_needed", 0),
                "unmatched_proofs": rec_by_class.get("forensic_required", 0),
                "potential_fraud": rec_by_class.get("potential_fraud", 0),
                "forensic_required": rec_by_class.get("forensic_required", 0),
                "total_pending": (
                    receipts_by_status.get("review_needed", 0)
                    + rec_by_class.get("potential_fraud", 0)
                    + rec_by_class.get("forensic_required", 0)
                ),
            },
        }
    except Exception as e:
        print(f"[Dashboard Stats] Error: {e}")
        return {
            "proofs": {"total": 0, "by_status": {}, "completed_pct": 0},
            "receipts": {"total": 0, "by_status": {}, "reviewed_pct": 0, "needing_review": 0},
            "reconciliation": {"total": 0, "by_classification": {}, "fraud_pct": 0, "fraud_count": 0},
            "audit": {"receipts_with_audit": 0, "receipts_without_audit": 0, "coverage_pct": 0},
            "human_intervention": {"receipts_needing_review": 0, "unmatched_proofs": 0, "potential_fraud": 0, "forensic_required": 0, "total_pending": 0},
        }
