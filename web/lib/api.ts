const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// In-memory headers — set synchronously when org/user changes
// Falls back to localStorage every call so late login / hot-reload never gets stuck
let _orgId: string | null = null;
let _userId: string | null = null;
let _accessToken: string | null = null;

function _loadFromStorage() {
  if (typeof window === "undefined") return;
  if (!_orgId) _orgId = localStorage.getItem("org_id");
  if (!_userId) _userId = localStorage.getItem("user_id");
  if (!_accessToken) _accessToken = localStorage.getItem("sb-access-token");
}

export function setApiHeaders(orgId: string | null, userId: string | null) {
  _orgId = orgId;
  _userId = userId;
}

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

export function getApiHeaders(): { orgId: string | null; userId: string | null; accessToken: string | null } {
  _loadFromStorage();
  return { orgId: _orgId, userId: _userId, accessToken: _accessToken };
}

function orgHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (_orgId) h["X-Org-Id"] = _orgId;
  if (_userId) h["X-User-Id"] = _userId;
  if (_accessToken) h["Authorization"] = `Bearer ${_accessToken}`;
  return h;
}

export async function uploadProof(file: File) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_URL}/api/upload`, {
    method: "POST",
    headers: orgHeaders(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function fetchProofs(status?: string, page = 1) {
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  const res = await fetch(`${API_URL}/api/proofs?${params}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch proofs");
  return res.json();
}

export async function fetchProof(proofId: string) {
  const res = await fetch(`${API_URL}/api/proofs/${proofId}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch proof");
  return res.json();
}

export async function fetchReceipts(status?: string, page = 1) {
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  const res = await fetch(`${API_URL}/api/receipts?${params}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch receipts");
  return res.json();
}

export async function fetchReceipt(receiptId: string) {
  const res = await fetch(`${API_URL}/api/receipts/${receiptId}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch receipt");
  return res.json();
}

export async function syncProofToErp(proofId: string) {
  const res = await fetch(`${API_URL}/api/proofs/${proofId}/sync`, { method: "POST", headers: orgHeaders() });
  if (!res.ok) throw new Error("Sync failed");
  return res.json();
}

export async function updateReceipt(receiptId: string, data: Record<string, any>, changedBy?: string) {
  const payload = changedBy ? { ...data, changed_by: changedBy } : data;
  const res = await fetch(`${API_URL}/api/receipts/${receiptId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Update failed");
  return res.json();
}

export async function runReconciliation(dateFrom?: string, dateTo?: string) {
  const p = new URLSearchParams();
  if (dateFrom) p.set("date_from", dateFrom);
  if (dateTo) p.set("date_to", dateTo);
  const qs = p.toString();
  const res = await fetch(`${API_URL}/api/reconciliation/run${qs ? `?${qs}` : ""}`, { method: "POST", headers: orgHeaders() });
  if (!res.ok) throw new Error("Reconciliation failed");
  return res.json();
}

export async function fetchReconciliationStats() {
  const res = await fetch(`${API_URL}/api/reconciliation/stats`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function fetchReconciliationResults(params?: { classification?: string; match_type?: string }) {
  const p = new URLSearchParams({ page: "1", page_size: "200" });
  if (params?.classification) p.set("classification", params.classification);
  if (params?.match_type) p.set("match_type", params.match_type);
  const res = await fetch(`${API_URL}/api/reconciliation/results?${p}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch results");
  return res.json();
}

export async function fetchReconciliationProgress() {
  const res = await fetch(`${API_URL}/api/reconciliation/progress`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch progress");
  return res.json();
}

export async function overrideReclassification(resultId: string, data: { classification?: string; notes?: string; human_reviewed?: boolean }) {
  const res = await fetch(`${API_URL}/api/reconciliation/results/${resultId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Override failed");
  return res.json();
}

export async function manualMatch(data: { proof_receipt_id: string; accounting_entry_id?: string; notes?: string }) {
  const res = await fetch(`${API_URL}/api/reconciliation/match-manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Manual match failed");
  return res.json();
}

export async function createAccountingEntry(data: Record<string, any>) {
  const res = await fetch(`${API_URL}/api/accounting-entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Create failed");
  return res.json();
}

export async function fetchAccountingEntries(params?: { date_from?: string; date_to?: string; status?: string; page?: number; page_size?: number }) {
  const p = new URLSearchParams();
  if (params?.date_from) p.set("date_from", params.date_from);
  if (params?.date_to) p.set("date_to", params.date_to);
  if (params?.status) p.set("status", params.status);
  p.set("page", String(params?.page || 1));
  p.set("page_size", String(params?.page_size || 200));
  const res = await fetch(`${API_URL}/api/accounting-entries?${p}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch entries");
  return res.json();
}

export async function updateAccountingEntry(entryId: string, data: Record<string, any>) {
  const res = await fetch(`${API_URL}/api/accounting-entries/${entryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Update failed");
  return res.json();
}

export async function deleteAccountingEntry(entryId: string) {
  const res = await fetch(`${API_URL}/api/accounting-entries/${entryId}`, { method: "DELETE", headers: orgHeaders() });
  if (!res.ok) throw new Error("Delete failed");
}

export async function fetchProcessingLogs(params?: { proof_id?: string; date_from?: string; date_to?: string; search?: string; stage?: string; page?: number; page_size?: number }) {
  const p = new URLSearchParams();
  if (params?.proof_id) p.set("proof_id", params.proof_id);
  if (params?.date_from) p.set("date_from", params.date_from);
  if (params?.date_to) p.set("date_to", params.date_to);
  if (params?.search) p.set("search", params.search);
  if (params?.stage) p.set("stage", params.stage);
  p.set("page", String(params?.page || 1));
  p.set("page_size", String(params?.page_size || 100));
  const res = await fetch(`${API_URL}/api/logs?${p}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch logs");
  return res.json();
}

export async function createOrg(name: string) {
  const res = await fetch(`${API_URL}/api/orgs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to create org");
  return res.json();
}

export async function fetchOrgInfo() {
  const res = await fetch(`${API_URL}/api/orgs`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch org info");
  return res.json();
}

export async function fetchOrgDetail(orgId: string) {
  const res = await fetch(`${API_URL}/api/orgs/${orgId}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch org detail");
  return res.json();
}

export async function updateOrg(orgId: string, data: Record<string, any>) {
  const res = await fetch(`${API_URL}/api/orgs/${orgId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update org");
  return res.json();
}

export async function deleteOrg(orgId: string) {
  const res = await fetch(`${API_URL}/api/orgs/${orgId}`, {
    method: "DELETE",
    headers: orgHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete org");
}

export async function fetchOrgMembers(orgId: string) {
  const res = await fetch(`${API_URL}/api/orgs/${orgId}/members`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch members");
  return res.json();
}

export async function inviteMember(orgId: string, email: string, role: string) {
  const res = await fetch(`${API_URL}/api/orgs/${orgId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) throw new Error("Invite failed");
  return res.json();
}

export async function updateMemberRole(orgId: string, memberUserId: string, role: string) {
  const res = await fetch(`${API_URL}/api/orgs/${orgId}/members/${memberUserId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error("Update role failed");
  return res.json();
}

export async function removeMember(orgId: string, memberUserId: string) {
  const res = await fetch(`${API_URL}/api/orgs/${orgId}/members/${memberUserId}`, {
    method: "DELETE",
    headers: orgHeaders(),
  });
  if (!res.ok) throw new Error("Remove member failed");
}

export async function fetchDashboardStats() {
  const res = await fetch(`${API_URL}/api/dashboard/stats`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function fetchForensicFlags(analysisType?: string, dismissed?: boolean, page = 1, pageSize = 50) {
  const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (analysisType) p.set("analysis_type", analysisType);
  if (dismissed !== undefined) p.set("dismissed", String(dismissed));
  const res = await fetch(`${API_URL}/api/forensic/flags?${p}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch flags");
  return res.json();
}

export async function dismissFlag(flagId: string, dismissed = true) {
  const res = await fetch(`${API_URL}/api/forensic/flags/${flagId}?dismissed=${dismissed}`, {
    method: "PATCH",
    headers: orgHeaders(),
  });
  if (!res.ok) throw new Error("Failed to dismiss flag");
  return res.json();
}

export async function triggerForensic() {
  const res = await fetch(`${API_URL}/api/forensic/run`, { method: "POST", headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to start forensic analysis");
  return res.json();
}

export async function fetchForensicSummary() {
  const res = await fetch(`${API_URL}/api/forensic/summary`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch summary");
  return res.json();
}

export async function fetchBenfordResults() {
  const res = await fetch(`${API_URL}/api/forensic/benford`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch Benford results");
  return res.json();
}

export async function fetchDuplicateGroups(page = 1, pageSize = 50) {
  const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const res = await fetch(`${API_URL}/api/forensic/duplicates?${p}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch duplicates");
  return res.json();
}

export async function fetchAnomalies(minScore = 0, flag?: string, page = 1, pageSize = 50) {
  const p = new URLSearchParams({ min_score: String(minScore), page: String(page), page_size: String(pageSize) });
  if (flag) p.set("flag", flag);
  const res = await fetch(`${API_URL}/api/forensic/anomalies?${p}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch anomalies");
  return res.json();
}

export async function fetchForensicRuns(page = 1, pageSize = 5) {
  const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const res = await fetch(`${API_URL}/api/forensic/runs?${p}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch runs");
  return res.json();
}

// === Platform Admin API ===
export async function fetchPlatformStatus() {
  const res = await fetch(`${API_URL}/api/platform/status`, { headers: orgHeaders() });
  if (!res.ok) return { is_platform_admin: false };
  return res.json();
}

export async function fetchPlatformSummary() {
  const res = await fetch(`${API_URL}/api/platform/summary`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch platform summary");
  return res.json();
}

export async function fetchAllOrgs() {
  const res = await fetch(`${API_URL}/api/platform/orgs`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch all orgs");
  return res.json();
}

export async function fetchAllUsers() {
  const res = await fetch(`${API_URL}/api/platform/users`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch all users");
  return res.json();
}

export async function promotePlatformAdmin(userId: string) {
  const res = await fetch(`${API_URL}/api/platform/users/${userId}/promote`, { method: "POST", headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to promote");
  return res.json();
}

export async function demotePlatformAdmin(userId: string) {
  const res = await fetch(`${API_URL}/api/platform/users/${userId}/demote`, { method: "POST", headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to demote");
  return res.json();
}

export async function fetchAuditLog(params?: { org_id?: string; user_id?: string; action?: string; limit?: number; offset?: number }) {
  const p = new URLSearchParams();
  if (params?.org_id) p.set("org_id", params.org_id);
  if (params?.user_id) p.set("user_id", params.user_id);
  if (params?.action) p.set("action", params.action);
  if (params?.limit) p.set("limit", String(params.limit));
  if (params?.offset) p.set("offset", String(params.offset));
  const res = await fetch(`${API_URL}/api/platform/audit?${p}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch audit log");
  return res.json();
}

export async function fetchOrgAuditLog(orgId: string, limit = 50) {
  const res = await fetch(`${API_URL}/api/orgs/${orgId}/audit?limit=${limit}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch org audit log");
  return res.json();
}

export async function addUserToOrg(orgId: string, userId: string, role: string) {
  const res = await fetch(`${API_URL}/api/platform/orgs/${orgId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify({ user_id: userId, role }),
  });
  if (!res.ok) throw new Error("Failed to add user to org");
  return res.json();
}

export async function updateMemberPermissions(orgId: string, memberUserId: string, permissions: any) {
  const res = await fetch(`${API_URL}/api/orgs/${orgId}/members/${memberUserId}/permissions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify({ permissions }),
  });
  if (!res.ok) throw new Error("Failed to update permissions");
  return res.json();
}

// === Notifications API ===
export async function fetchNotifications(page = 1, pageSize = 20) {
  const res = await fetch(`${API_URL}/api/notifications?page=${page}&page_size=${pageSize}`, { headers: orgHeaders() });
  if (!res.ok) throw new Error("Failed to fetch notifications");
  return res.json();
}

export async function fetchUnreadCount() {
  const res = await fetch(`${API_URL}/api/notifications/unread-count`, { headers: orgHeaders() });
  if (!res.ok) return { count: 0 };
  return res.json();
}

export async function markNotificationRead(id: string) {
  await fetch(`${API_URL}/api/notifications/${id}/read`, { method: "PATCH", headers: orgHeaders() });
}

export async function markAllNotificationsRead() {
  await fetch(`${API_URL}/api/notifications/read-all`, { method: "POST", headers: orgHeaders() });
}

export async function toggleUserNotifications(userId: string, enabled: boolean) {
  const res = await fetch(`${API_URL}/api/platform/users/${userId}/notifications`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...orgHeaders() },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error("Failed to toggle notifications");
  return res.json();
}
