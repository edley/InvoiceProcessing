import threading
from fastapi import APIRouter, Query
from app.supabase_client import supabase
from app.services.forensic_analyzer import run_forensic_analysis, get_progress

router = APIRouter()


@router.post("/forensic/run")
def trigger_forensic():
    t = threading.Thread(target=run_forensic_analysis, daemon=True)
    t.start()
    return {"status": "started"}


@router.get("/forensic/progress")
def forensic_progress():
    return get_progress()


@router.get("/forensic/benford")
def benford_results():
    data = supabase.table("forensic_flags").select("*").eq("analysis_type", "benford").order("score", desc=True).execute()
    return {"items": data.data or []}


@router.get("/forensic/duplicates")
def duplicate_results(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    query = supabase.table("forensic_flags").select("duplicate_group_id", count="exact").eq("analysis_type", "duplicate")
    groups_raw = query.execute()
    all_groups = list(set(
        r.get("duplicate_group_id") for r in (groups_raw.data or []) if r.get("duplicate_group_id")
    ))
    total_groups = len(all_groups)

    paginated = all_groups[(page - 1) * page_size:page * page_size]
    items = []
    for gid in paginated:
        members = supabase.table("forensic_flags").select("*, receipt:receipt_id(*)").eq(
            "duplicate_group_id", gid
        ).execute()
        items.append({
            "group_id": gid,
            "size": len(members.data or []),
            "members": members.data or [],
        })

    return {
        "total_groups": total_groups,
        "page": page,
        "page_size": page_size,
        "items": items,
    }


@router.get("/forensic/anomalies")
def anomaly_results(
    min_score: float = Query(0.0, ge=0.0),
    flag: str = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    query = supabase.table("forensic_flags").select("*, receipt:receipt_id(*)", count="exact") \
        .eq("analysis_type", "anomaly")
    if flag:
        query = query.ilike("flag", f"%{flag}%")
    query = query.gte("score", min_score)
    query = query.order("score", desc=True) \
        .range((page - 1) * page_size, page * page_size - 1)
    result = query.execute()
    return {
        "total": result.count if hasattr(result, "count") else len(result.data),
        "page": page,
        "page_size": page_size,
        "items": result.data,
    }


@router.get("/forensic/flags")
def all_flags(
    analysis_type: str = None,
    dismissed: bool = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    query = supabase.table("forensic_flags").select("*, receipt:receipt_id(*)", count="exact")
    if analysis_type:
        query = query.eq("analysis_type", analysis_type)
    if dismissed is not None:
        query = query.eq("dismissed", dismissed)
    query = query.order("created_at", desc=True) \
        .range((page - 1) * page_size, page * page_size - 1)
    result = query.execute()
    return {
        "total": result.count if hasattr(result, "count") else len(result.data),
        "page": page,
        "page_size": page_size,
        "items": result.data,
    }


@router.patch("/forensic/flags/{flag_id}")
def dismiss_flag(flag_id: str, dismissed: bool = True):
    data = {"dismissed": dismissed}
    if dismissed:
        data["dismissed_at"] = "now()"
    result = supabase.table("forensic_flags").update(data).eq("id", flag_id).execute()
    if not result.data:
        return {"error": "Flag not found"}
    return result.data[0]


@router.get("/forensic/summary")
def forensic_summary():
    flags = supabase.table("forensic_flags").select("analysis_type, score, flag", count="exact").execute()
    items = flags.data or []
    total = len(items)
    by_type = {}
    high_risk = 0
    for f in items:
        t = f.get("analysis_type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1
        if (f.get("score") or 0) >= 0.7:
            high_risk += 1
    return {
        "total_flags": total,
        "by_type": by_type,
        "high_risk": high_risk,
    }


@router.get("/forensic/runs")
def forensic_runs(page: int = Query(1, ge=1), page_size: int = Query(5, ge=1, le=20)):
    result = supabase.table("forensic_runs").select("*").order("started_at", desc=True) \
        .range((page - 1) * page_size, page * page_size - 1).execute()
    count_result = supabase.table("forensic_runs").select("id", count="exact").execute()
    return {
        "total": count_result.count if hasattr(count_result, "count") else 0,
        "page": page,
        "page_size": page_size,
        "items": result.data or [],
    }
