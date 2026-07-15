# Platform Superuser Dashboard Implementation Plan

**Goal:** A holistic platform overview for superusers showing all companies, users, and recent activity at a glance.

**Architecture:** Platform admin sidebar stays with 5 items (Dashboard, Companies, User Access, Admin, Audit) — but **Dashboard** becomes the holistic platform overview instead of the org-level dashboard. New `PlatformDashboard` component + one new backend endpoint for aggregated stats.

**Tech Stack:** FastAPI (backend), Next.js + Tailwind (frontend), Supabase

---

### Task 1: Backend — `GET /api/platform/summary` endpoint

**Files:**
- Create: `backend/app/routers/platform.py` (modify existing, add new endpoint)

**Details:**
Add a new endpoint to `platform.py` that returns aggregated counts for the platform dashboard:

```python
@router.get("/platform/summary")
def platform_summary(request: Request):
    user_id = _get_user_id(request)
    require_platform_admin(user_id)

    orgs = supabase.table("organizations").select("id, name, slug, status, created_at").order("created_at", desc=True).execute()
    orgs_data = orgs.data or []

    users = list_all_users()

    admins = [u for u in users if u.get("is_platform_admin")]

    recent_logs = query_audit_log(limit=20, offset=0)

    org_member_counts = {}
    for org in orgs_data:
        members = supabase.table("organization_members").select("user_id").eq("org_id", org["id"]).execute()
        org_member_counts[org["id"]] = len(members.data or [])

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    today_activity = supabase.table("audit_log").select("id").gte("created_at", today_start).execute()
    today_count = len(today_activity.data or [])

    return {
        "total_companies": len(orgs_data),
        "total_users": len(users),
        "platform_admins": len(admins),
        "activity_today": today_count,
        "companies": [
            {
                "id": o["id"],
                "name": o.get("name", ""),
                "slug": o.get("slug"),
                "status": o.get("status", "active"),
                "member_count": org_member_counts.get(o["id"], 0),
                "created_at": o.get("created_at"),
            }
            for o in orgs_data
        ],
        "users": [
            {
                "user_id": u["user_id"],
                "display_name": u.get("display_name", ""),
                "email": u.get("email", ""),
                "is_platform_admin": u.get("is_platform_admin", False),
                "orgs": u.get("orgs", []),
            }
            for u in users
        ],
        "recent_activity": [
            {
                "action": e.get("action"),
                "user_id": e.get("user_id"),
                "org_id": e.get("org_id"),
                "details": e.get("details"),
                "created_at": e.get("created_at"),
            }
            for e in recent_logs
        ],
    }
```

Import `datetime` at top of file.

---

### Task 2: Frontend — `fetchPlatformSummary()` API function

**Files:**
- Modify: `web/lib/api.ts` (add function)

Add after `fetchPlatformStatus()`:

```typescript
export function fetchPlatformSummary(): Promise<any> {
  return fetchApi("/api/platform/summary");
}
```

---

### Task 3: Frontend — `PlatformDashboard` component

**Files:**
- Modify: `web/app/page.tsx` (add new component + update tab render)

**Step 1: Create `PlatformDashboard` component**

Layout (compact, one-page, same pattern as existing dashboards):

```
┌──────────────────────────────────────────────────────────────┐
│  Platform Overview                                            │
├──────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ │ 12 Comps │ │ 48 Users │ │ 3 Admins │ │ 24 Today │        │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
├─────────────────────────────────┬────────────────────────────┤
│ Companies (12)                  │ Users (48)                 │
│ Name       Members     Status   │ Name         Orgs  Role    │
│ My Company 12          active   │ ed@...       3     admin   │
│ Acme Corp  8           active   │ low@...      1     viewer  │
│ Beta Inc   5           inactive │ man@...      1     manager │
├──────────────────────────────────────────────────────────────┤
│ Recent Activity                                              │
│ • user joined "Acme Corp"                   2 min ago         │
│ • org "Beta Inc" created                   15 min ago         │
│ • member role updated                       1 hour ago        │
└──────────────────────────────────────────────────────────────┘
```

4 stat cards at top using the same MiniBar/mini-card style from existing dashboards.

Companies table: name, member count, status badge (active/inactive), clickable row

Users table: name/email, org count, role badge, platform admin badge (PA)

Recent activity: last 20 audit entries with relative time, action description, user identifier

**Step 2: Update sidebar logic**

In `getSidebarItems()`, the platform admin already gets 5 items. The tab rendering at line 348 already maps "Dashboard" to `<DashboardTab>`. We need to change the `DashboardTab` to render `<PlatformDashboard>` when `isPlatformAdmin === true`.

**Step 3: Add the loading/fetch effect**

Use `useEffect` to call `fetchPlatformSummary()` when the component mounts and `isPlatformAdmin` is true.

---

### Execution Plan

1. Add `GET /api/platform/summary` to `backend/app/routers/platform.py`
2. Add `fetchPlatformSummary()` to `web/lib/api.ts`
3. Create `PlatformDashboard` component in `web/app/page.tsx`
4. Update the tab rendering to show `PlatformDashboard` instead of `DashboardTab` for platform admins
5. Restart backend, test locally
