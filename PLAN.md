# WhatsApp Payment Proof Processor — Plan

## Architecture

### Two-Tier Access Control
- **Platform Administrators**: Full access to all orgs, user management, promote/demote admins
- **Org-level roles**: `viewer` (read-only), `manager` (CRUD), `admin` (full + org management)

### Data Flow
- `org-context.tsx` → `GET /api/orgs` → `list_user_orgs()` → returns user's orgs with role + permissions
- `setApiHeaders(orgId, userId)` → in-memory variables (not localStorage) for API headers
- DB is always source of truth for org selection, role, and permissions

### Menu Permission System
- `organization_members.permissions` JSONB: `{"menus": ["Proofs", "Receipts", ...]}`
- Explicit `permissions.menus` overrides role-based defaults (checked before admin bypass)
- Platform admin sidebar is the only path that ignores menu permissions
- Dashboard excluded from both filtered and default menu lists

## Completed

### UI Changes
- Brand updated: "Whatapps" → "Tolmai Invoice Processing Platform" with blue gear icon
- User avatar (first initial + email) added to desktop header (between org selector and gear)
- **New Org Admin Dashboard**: Salesforce-style dashboard for non-platform-admin users showing:
  - Welcome header with org name, member count, proof/receipt counts
  - Metric cards (Team Members, Proofs, Receipts, Reconciliation Results)
  - Team Members list with avatar, name, role badge, online status indicator
  - Org Summary card with object counts and status
  - Proof Status Breakdown section
- Platform admin dashboard unchanged (stats, fraud detection, audit trail, forensic)

### Backend
- `org_service.py`: `require_org()` calls `require_role()` internally for membership validation
- `list_user_orgs()`: two-step query (org_members → orgs), includes `permissions` field
- Auto-create `user_profiles` + "My Company" org on first login (in `GET /orgs`)
- All migrations 015–019 idempotent

### Frontend
- `api.ts`: In-memory `_orgId`/`_userId` with `setApiHeaders()`/`getApiHeaders()`
- `org-context.tsx`: `refresh()` always selects first org from API (no localStorage for default)
- `getSidebarItems(role, isPlatformAdmin, permissions)`: filters by `permissions.menus` when set
- `MenuAccessTab`: Full CRUD for user-org menu permissions (grant form + table + inline edit)
- All role reads from `useOrg()` context, not `localStorage`
- User avatar (first initial + email) in desktop header

### Bugs Fixed
- `setCurrentOrg(org)` was passing `null` for userId, clearing `_userId` on org switch
- `AccountingEntriesTab` and `ReceiptsTab` read `org_role` from stale localStorage instead of context
- Auth state was read once via `getSession()` on mount with no listener for user switches
- Login/logout used `router.push()` which caches stale React state across navigations
- `onAuthStateChange` `SIGNED_OUT` handler was missing — user state persisted after logout
- All auth navigation now uses `window.location.href` for clean state
- `onAuthStateChange` listener handles `SIGNED_IN` and `SIGNED_OUT` events

## Remaining Issues

### user_profiles Table Schema
- Has columns added outside migrations: `email`, `company_id` (FK to `companies`), `name`, `role`, `updated_at`, `password_reset_required`, `phone`, `date_of_birth`, `address_line1`, `address_line2`, `city`, `state`, `postal_code`, `country`
- Backend auto-create code in `GET /orgs` doesn't include `email` or `company_id` — silently fails
- New users can't get `user_profiles` row via auto-create; must be inserted manually

### Duplicate "My Company" Orgs
- The auto-create in `GET /orgs` creates a new "My Company" org each time a user logs in with no orgs
- Multiple runs created 6+ duplicate "My Company" rows in `organizations`
- Needs cleanup + fix to auto-create only once (check for existing "My Company" before creating)

### Data Visibility for Org d32780aa-...
- Data exists in tables with `org_id = d32780aa-...` but is not visible in UI
- Likely because the selected org in the dropdown is different from `d32780aa-...`
- Or `require_org()` membership validation blocks the request

## Key Files
- `backend/app/services/org_service.py` — org logic, permissions, audit
- `backend/app/routers/orgs.py` — org CRUD + auto-create on login
- `web/lib/api.ts` — in-memory API headers
- `web/lib/org-context.tsx` — org state, `refresh()`, `setCurrentOrg()`
- `web/app/page.tsx` — sidebar, menu permissions, all tabs, user avatar header
- `backend/migrations/015_add_orgs.sql` — initial schema
