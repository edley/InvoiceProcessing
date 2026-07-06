from app.supabase_client import supabase


def get_setting(key: str, default: str = None) -> str | None:
    try:
        result = supabase.table("app_settings").select("value").eq("key", key).execute()
        if result.data:
            return result.data[0]["value"]
    except Exception:
        pass
    return default


def get_all_settings() -> dict:
    try:
        result = supabase.table("app_settings").select("*").execute()
        return {row["key"]: row["value"] for row in (result.data or [])}
    except Exception:
        return {}


def upsert_setting(key: str, value: str) -> bool:
    try:
        supabase.table("app_settings").upsert({"key": key, "value": value}).execute()
        return True
    except Exception:
        return False
