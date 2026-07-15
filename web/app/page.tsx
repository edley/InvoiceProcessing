"use client";

import { useEffect, useState, useRef, useCallback, Fragment } from "react";
import { supabase } from "@/lib/supabase";
import { useOrg, type OrgInfo } from "@/lib/org-context";
import { uploadProof, updateReceipt, runReconciliation, fetchReconciliationStats, fetchReconciliationResults, fetchReconciliationProgress, overrideReclassification, manualMatch, fetchAccountingEntries, createAccountingEntry, updateAccountingEntry, deleteAccountingEntry, fetchProcessingLogs, createOrg, fetchOrgInfo, fetchOrgMembers, inviteMember, updateMemberRole, removeMember, fetchPlatformSummary, fetchAllOrgs, fetchAllUsers, promotePlatformAdmin, demotePlatformAdmin, fetchAuditLog, fetchOrgAuditLog, updateMemberPermissions, addUserToOrg, fetchOrgDetail, updateOrg, deleteOrg, getApiHeaders, setApiHeaders, fetchNotifications, fetchUnreadCount, markNotificationRead, markAllNotificationsRead, toggleUserNotifications } from "@/lib/api";
import {
  Upload, FileText, Receipt, LogOut, RefreshCw, DollarSign, User, Hash, Calendar,
  Building2, CheckCircle, AlertCircle, UploadCloud, Edit3, Shield, AlertTriangle,
  ChevronDown, ChevronRight, Save, X, Loader2, Search, ExternalLink, BarChart3, Scale, Flag, Grip,
  Settings, ClipboardList, Menu, Database, Plus, Trash2, Filter, Check, History, Eye, ListChecks, UserCheck, Copy,
  Users, Mail, Send, UserPlus, Building, ChevronsUpDown, Globe, MapPin, Phone, Info, XCircle, Play, Bell
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
function headers(): Record<string, string> {
  const h: Record<string, string> = {};
  const { orgId, userId, accessToken } = getApiHeaders();
  if (orgId) h["X-Org-Id"] = orgId;
  if (userId) h["X-User-Id"] = userId;
  if (accessToken) h["Authorization"] = `Bearer ${accessToken}`;
  return h;
}
const TABS = ["Dashboard", "Upload", "Proofs", "Receipts", "Reconciliation", "Forensic", "Entries", "Logs", "Company", "Team"] as const;
type Tab = (typeof TABS)[number];

function getSidebarItems(role: string | null, isPlatformAdmin: boolean, permissions?: any): { key: string; label: string; icon: any }[] {
  // Platform admin sees a completely different sidebar (permissions ignored)
  if (isPlatformAdmin) {
    return [
      { key: "Dashboard", label: "Dashboard", icon: BarChart3 },
      { key: "Company", label: "Companies", icon: Building2 },
      { key: "Access", label: "User Access", icon: UserCheck },
      { key: "Team", label: "Admin", icon: Shield },
      { key: "Audit", label: "Audit Trail", icon: ClipboardList },
    ];
  }

  // If menu permissions are explicitly set, use them regardless of role
  const menuMenus = permissions?.menus;
  if (menuMenus && Array.isArray(menuMenus) && menuMenus.length > 0) {
    const allowedMenus = new Set(menuMenus);
    const menuMap: Record<string, { key: string; label: string; icon: any }> = {
      Dashboard: { key: "Dashboard", label: "Dashboard", icon: BarChart3 },
      Upload: { key: "Upload", label: "Upload", icon: UploadCloud },
      Proofs: { key: "Proofs", label: "Proofs", icon: FileText },
      Receipts: { key: "Receipts", label: "Receipts", icon: Receipt },
      Reconciliation: { key: "Reconciliation", label: "Reconciliation", icon: Scale },
      Entries: { key: "Entries", label: "Journal Entries", icon: Database },
      Forensic: { key: "Forensic", label: "Forensic", icon: Shield },
      Logs: { key: "Logs", label: "Activity Log", icon: ClipboardList },
    };
    const items: { key: string; label: string; icon: any }[] = [
      { key: "Dashboard", label: "Dashboard", icon: BarChart3 },
    ];
    for (const key of ["Upload", "Proofs", "Receipts", "Reconciliation", "Entries", "Forensic", "Logs"]) {
      if (allowedMenus.has(key) && menuMap[key]) {
        items.push(menuMap[key]);
      }
    }
    // Add Company/Team only if user has admin role
    if (role === "admin") {
      if (allowedMenus.has("Company")) items.push({ key: "Company", label: "Company", icon: Building2 });
      if (allowedMenus.has("Team")) items.push({ key: "Team", label: "Team", icon: Users });
    }
    return items;
  }

  // No permissions set — fall back to role-based defaults
  const isOrgAdmin = role === "admin";
  const canEdit = role === "admin" || role === "manager";
  const items: { key: string; label: string; icon: any }[] = [
    { key: "Dashboard", label: "Dashboard", icon: BarChart3 },
  ];
  if (canEdit) items.push({ key: "Upload", label: "Upload", icon: UploadCloud });
  items.push(
    { key: "Proofs", label: "Proofs", icon: FileText },
    { key: "Receipts", label: "Receipts", icon: Receipt },
    { key: "Reconciliation", label: "Reconciliation", icon: Scale },
    { key: "Entries", label: "Journal Entries", icon: Database },
    { key: "Forensic", label: "Forensic", icon: Shield },
    { key: "Logs", label: "Activity Log", icon: ClipboardList },
  );
  if (isOrgAdmin) {
    items.push({ key: "Company", label: "Company", icon: Building2 });
    items.push({ key: "Team", label: "Team", icon: Users });
  }
  return items;
}

const STEP_LABELS: Record<string, string> = {
  uploaded: "Uploading", ocr: "Extracting text", llm_primary: "AI extraction",
  llm_fallback: "AI fallback", regex: "Regex extraction", routing: "Saving result", done: "Complete",
};

export default function HomePage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("Dashboard");
  const [filterState, setFilterState] = useState<string>("");
  const [tabKey, setTabKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { orgs, currentOrg, setCurrentOrg, loading: orgLoading, isPlatformAdmin } = useOrg();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = "/login"; return; }
      setUser(session.user);
      localStorage.setItem("user_id", session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setUser(session.user);
        localStorage.setItem("user_id", session.user.id);
      } else if (event === "SIGNED_OUT") {
        setUser(null);
        localStorage.removeItem("user_id");
        setApiHeaders(null, null);
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => { if (e.matches) setMobileMenuOpen(false); };
    handler(mql);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function handleTabClick(key: string) {
    setTab(key);
    setMobileMenuOpen(false);
  }

  useEffect(() => {
    const items = getSidebarItems(currentOrg?.role || null, isPlatformAdmin, currentOrg?.permissions);
    const valid = items.some(i => i.key === tab);
    if (!valid) setTab("Dashboard");
  }, [currentOrg?.id, isPlatformAdmin, currentOrg?.role]);

  if (loading || orgLoading) return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading...</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col md:flex-row">
      {/* Mobile header bar */}
      <header className="md:hidden flex items-center justify-between px-4 h-12 bg-white border-b border-gray-100 sticky top-0 z-20">
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded p-1.5">
          <Menu size={18} />
        </button>
        <span className="text-sm font-semibold tracking-tight text-gray-900">Tolmai Invoice Processing Platform</span>
        <button onClick={() => setShowSettings(true)}
          className="text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded p-1.5">
          <Settings size={16} />
        </button>
      </header>

      {/* Mobile drawer overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute left-0 top-0 bottom-0 w-60 bg-white flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 h-12 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Settings size={16} className="text-blue-600 shrink-0" />
                <span className="text-sm font-semibold tracking-tight text-gray-900">Tolmai Invoice Processing Platform</span>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <nav className="py-2 px-2 overflow-y-auto flex-1">
{getSidebarItems(currentOrg?.role || null, isPlatformAdmin, currentOrg?.permissions).map((item) => {
                const Icon = item.icon;
                const active = tab === item.key;
                return (
                  <button key={item.key} onClick={() => handleTabClick(item.key)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs rounded transition-colors ${active ? "bg-gray-100 text-gray-900 font-medium" : "text-blue-400 hover:text-blue-600 hover:bg-blue-50"}`}>
                    <Icon size={15} strokeWidth={active ? 2 : 1.5} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="px-2 pb-3 space-y-1 border-t border-gray-50 pt-2">
              {orgs.length > 0 && (
                <div className="px-1 pb-1">
                  <label className="block text-[9px] text-gray-300 uppercase tracking-wider font-medium">Organization</label>
                  <select value={currentOrg?.id || ""} onChange={(e) => {
                    const found = orgs.find((o) => o.id === e.target.value);
                    if (found) setCurrentOrg(found);
                  }}
                    className="w-full border-0 px-0 py-1 text-xs text-gray-600 bg-transparent outline-none">
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>{o.name} ({o.role})</option>
                    ))}
                  </select>
                </div>
              )}
              <button onClick={() => { setShowSettings(true); setMobileMenuOpen(false); }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs rounded text-blue-400 hover:text-blue-600 hover:bg-blue-50">
                <div className="w-5 h-5 rounded bg-gray-100 text-gray-500 flex items-center justify-center text-[8px] font-bold">
                  {user.email?.[0]?.toUpperCase() || "U"}
                </div>
                <span className="truncate text-gray-500">{user.email}</span>
              </button>
              <button onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs rounded text-blue-400 hover:text-red-500 hover:bg-red-50">
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className={`hidden md:flex ${sidebarOpen ? "w-52" : "w-[60px]"} bg-white border-r border-gray-100 flex-col transition-all duration-200 sticky top-0 h-screen`}>
        <div className="flex items-center h-12 px-3 border-b border-gray-100 shrink-0">
          <div className={`flex items-center gap-2 ${!sidebarOpen ? "justify-center w-full" : ""}`}>
            <Settings size={16} className="text-blue-600 shrink-0" />
            <span className={`text-sm font-semibold tracking-tight text-gray-900 ${!sidebarOpen ? "hidden" : ""}`}>Tolmai Invoice Processing Platform</span>
          </div>
          {sidebarOpen && (
            <button onClick={() => setSidebarOpen(false)} className="ml-auto text-gray-200 hover:text-gray-400">
              <ChevronsUpDown size={14} />
            </button>
          )}
        </div>
        <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
          {getSidebarItems(currentOrg?.role || null, isPlatformAdmin, currentOrg?.permissions).map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button key={item.key} onClick={() => { setTab(item.key); setMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-xs transition-colors ${active ? "bg-gray-100 text-gray-900 font-medium" : "text-blue-400 hover:text-blue-600 hover:bg-blue-50"}`}>
                <Icon size={15} strokeWidth={active ? 2 : 1.5} />
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-gray-50 px-3 py-2">
          {sidebarOpen && (
            <div className="mb-1.5">
              <label className="block text-[9px] text-gray-300 uppercase tracking-wider font-medium">Organization</label>
              <select value={currentOrg?.id || ""} onChange={(e) => {
                const found = orgs.find((o) => o.id === e.target.value);
                if (found) setCurrentOrg(found);
              }}
                className="w-full border-0 px-0 py-0.5 text-xs text-gray-600 bg-transparent outline-none cursor-pointer">
                <option value="" disabled>Select org</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name} ({o.role})</option>
                ))}
              </select>
            </div>
          )}
          <div className={`flex items-center gap-1 ${!sidebarOpen ? "flex-col" : ""}`}>
            <button onClick={() => setShowSettings(true)}
              className={`flex items-center gap-1.5 px-2 py-1.5 text-[11px] rounded text-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors ${sidebarOpen ? "flex-1" : "w-full justify-center"}`}>
              <Settings size={12} />
              {sidebarOpen && <span>Settings</span>}
            </button>
            <button onClick={handleLogout}
              className={`flex items-center gap-1.5 px-2 py-1.5 text-[11px] rounded text-blue-400 hover:text-red-400 hover:bg-red-50 transition-colors ${sidebarOpen ? "flex-1" : "w-full justify-center"}`}>
              <LogOut size={12} />
              {sidebarOpen && <span>Logout</span>}
            </button>
          </div>
        </div>
      </aside>

      {!sidebarOpen && (
        <button onClick={() => setSidebarOpen(true)}
          className="hidden md:flex fixed left-[14px] bottom-3 z-10 w-[32px] h-[32px] items-center justify-center bg-white border border-gray-100 rounded text-gray-300 hover:text-gray-500 hover:shadow-sm transition-all">
          <ChevronsUpDown size={14} className="rotate-180" />
        </button>
      )}

      {/* Desktop header + Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="hidden md:flex bg-white px-4 lg:px-5 h-12 border-b border-gray-100 items-center justify-between sticky top-0 z-10">
          <h2 className="text-sm font-semibold text-gray-800">{getSidebarItems(currentOrg?.role || null, isPlatformAdmin, currentOrg?.permissions).find(i => i.key === tab)?.label || tab}</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <select value={currentOrg?.id || ""} onChange={(e) => {
                if (e.target.value === "__new__") { setShowSettings(true); return; }
                const found = orgs.find((o) => o.id === e.target.value);
                if (found) setCurrentOrg(found);
              }}
                className="appearance-none bg-gray-50 border border-gray-100 rounded px-2 py-1 pr-6 text-[11px] text-gray-600 outline-none cursor-pointer hover:border-gray-200">
                <option value="" disabled>{orgs.length === 0 ? "No org" : "Select org"}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name} ({o.role})</option>
                ))}
                {orgs.length > 0 && <option disabled>──────────</option>}
                <option value="__new__">+ New Organization</option>
              </select>
              <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
            </div>
            <div className="h-4 w-px bg-gray-100" />
            <div className="flex items-center gap-1.5 text-xs text-gray-500 px-1">
              <div className="w-5 h-5 rounded-full bg-gray-800 text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                {user.email?.[0]?.toUpperCase() || "U"}
              </div>
              <span className="truncate max-w-[120px] hidden lg:inline">{user.email}</span>
            </div>
            <div className="h-4 w-px bg-gray-100" />
            <NotificationBell />
            <button onClick={() => setShowSettings(true)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-blue-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors">
              <Settings size={13} />
            </button>
            <button onClick={handleLogout}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-blue-400 hover:text-red-400 rounded hover:bg-red-50 transition-colors">
              <LogOut size={13} />
            </button>
          </div>
        </header>

        <main className="flex-1 mx-auto w-full max-w-6xl px-3 sm:px-4 lg:px-6 py-4 sm:py-6 pb-20 md:pb-6">
          {tab === "Dashboard" && (isPlatformAdmin ? <PlatformDashboard /> : <DashboardTab key={currentOrg?.id || "no-org"} user={user} onNavigate={(t: string, f?: string) => { setFilterState(f || ""); setTabKey(k => k + 1); setTab(t as Tab); }} />)}
          {tab === "Upload" && <UploadTab user={user} />}
          {tab === "Proofs" && <ProofsTab key={`p-${tabKey}`} initialFilter={filterState} />}
          {tab === "Receipts" && <ReceiptsTab key={`r-${tabKey}`} initialFilter={filterState} user={user} />}
          {tab === "Reconciliation" && <ReconciliationTab key={`rec-${tabKey}`} initialFilter={filterState} />}
          {tab === "Forensic" && <ForensicTab />}
          {tab === "Entries" && <AccountingEntriesTab />}
          {tab === "Logs" && <ProcessingLogTab />}
          {tab === "Company" && <CompanyProfileTab isPlatformAdmin={isPlatformAdmin} />}
          {tab === "Access" && <UserAccessTab />}
          {tab === "Team" && (isPlatformAdmin ? <PlatformAdminPanel user={user} /> : <TeamTab user={user} isPlatformAdmin={false} />)}
          {tab === "Audit" && <AuditTab user={user} />}
        </main>
      </div>

      {showSettings && <SettingsModal user={user} onClose={() => setShowSettings(false)} />}

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 bg-white/90 backdrop-blur-md border-t border-gray-200/60 flex items-center justify-around px-1 pb-safe-or-0" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {getSidebarItems(currentOrg?.role || null, isPlatformAdmin, currentOrg?.permissions).slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button key={item.key} onClick={() => setTab(item.key)}
              className={`flex flex-col items-center gap-0.5 py-2 px-2 min-w-0 ${active ? "text-blue-600" : "text-blue-400"}`}>
              <Icon size={18} />
              <span className="text-[9px] font-medium leading-none truncate max-w-full">{item.label}</span>
            </button>
          );
        })}
        {getSidebarItems(currentOrg?.role || null, isPlatformAdmin, currentOrg?.permissions).length > 5 && (
          <button onClick={() => setMobileMenuOpen(true)}
            className="flex flex-col items-center gap-0.5 py-2 px-2 text-blue-400">
            <Menu size={18} />
            <span className="text-[9px] font-medium">More</span>
          </button>
        )}
      </nav>
    </div>
  );
}

/* ========== SETTINGS MODAL ========== */
function SettingsModal({ user, onClose }: { user: any; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [llmProvider, setLlmProvider] = useState("openai");
  const [llmModel, setLlmModel] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [nvidiaKey, setNvidiaKey] = useState("");
  const [nvidiaBaseUrl, setNvidiaBaseUrl] = useState("");
  const [nvidiaModel, setNvidiaModel] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [savingLlm, setSavingLlm] = useState(false);
  const [llmMsg, setLlmMsg] = useState("");

  useEffect(() => {
    fetch(`${API}/api/settings`, { headers: headers() }).then(r => r.json()).then(data => {
      if (data.llm_provider) setLlmProvider(data.llm_provider);
      if (data.llm_model) setLlmModel(data.llm_model);
      if (data.openai_api_key) setOpenaiKey(data.openai_api_key);
      if (data.nvidia_api_key) setNvidiaKey(data.nvidia_api_key);
      if (data.nvidia_base_url) setNvidiaBaseUrl(data.nvidia_base_url);
      if (data.nvidia_model) setNvidiaModel(data.nvidia_model);
      setSettingsLoaded(true);
    }).catch(() => setSettingsLoaded(true));
  }, []);

  async function handleResetPassword() {
    setMsg("");
    if (!password || password.length < 6) { setMsg("Password must be at least 6 characters"); return; }
    if (password !== confirm) { setMsg("Passwords do not match"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      setMsg("Password updated successfully");
      setPassword("");
      setConfirm("");
    } catch (e: any) { setMsg(e.message); }
    finally { setSaving(false); }
  }

  async function handleSaveLlm() {
    setLlmMsg("");
    setSavingLlm(true);
    try {
      const body: any = { llm_provider: llmProvider, llm_model: llmModel };
      if (openaiKey) body.openai_api_key = openaiKey;
      if (nvidiaKey) body.nvidia_api_key = nvidiaKey;
      if (nvidiaBaseUrl) body.nvidia_base_url = nvidiaBaseUrl;
      if (nvidiaModel) body.nvidia_model = nvidiaModel;
      const res = await fetch(`${API}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      setLlmMsg("LLM settings saved");
    } catch (e: any) { setLlmMsg(e.message); }
    finally { setSavingLlm(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl p-5 sm:p-6 w-full sm:max-w-md mx-0 sm:mx-4 max-h-[90vh] overflow-y-auto sm:min-h-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Settings</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="text-xs text-gray-500 mb-4">{user.email}</div>

        {/* Password section */}
        <div className="border-b pb-4 mb-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Change Password</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">New Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none" placeholder="Min 6 characters" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Confirm Password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none" placeholder="Repeat password" />
            </div>
            {msg && <p className={`text-xs ${msg.includes("success") ? "text-green-600" : "text-red-600"}`}>{msg}</p>}
            <button onClick={handleResetPassword} disabled={saving}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? "Updating..." : "Change Password"}
            </button>
          </div>
        </div>

        {/* Organization section */}
        <div className="border-b pb-4 mb-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><Building size={14} /> Organization</h4>
          <OrgSettingsPanel />
        </div>

        {/* LLM Configuration section */}
        {settingsLoaded && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">LLM Configuration</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Provider</label>
                <select value={llmProvider} onChange={(e) => setLlmProvider(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none bg-white">
                  <option value="openai">OpenAI</option>
                  <option value="nvidia">NVIDIA</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <input type="text" value={llmModel} onChange={(e) => setLlmModel(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none" placeholder={llmProvider === "openai" ? "gpt-4o-mini" : "nvidia/llama-3.1-nemotron-70b-instruct"} />
              </div>
              {llmProvider === "openai" ? (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">OpenAI API Key</label>
                  <input type="password" value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none" placeholder="sk-..." />
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">NVIDIA API Key</label>
                    <input type="password" value={nvidiaKey} onChange={(e) => setNvidiaKey(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none" placeholder="nvapi-..." />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">NVIDIA Base URL</label>
                    <input type="text" value={nvidiaBaseUrl} onChange={(e) => setNvidiaBaseUrl(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none" placeholder="https://integrate.api.nvidia.com/v1" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">NVIDIA Model</label>
                    <input type="text" value={nvidiaModel} onChange={(e) => setNvidiaModel(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 outline-none" placeholder="nvidia/llama-3.1-nemotron-70b-instruct" />
                  </div>
                </>
              )}
              {llmMsg && <p className={`text-xs ${llmMsg.includes("saved") ? "text-green-600" : "text-red-600"}`}>{llmMsg}</p>}
              <button onClick={handleSaveLlm} disabled={savingLlm}
                className="w-full flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {savingLlm ? <Loader2 size={14} className="animate-spin" /> : null}
                {savingLlm ? "Saving..." : "Save LLM Settings"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== ORG SETTINGS PANEL ========== */
function OrgSettingsPanel() {
  const { currentOrg, refresh } = useOrg();
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!currentOrg) { setLoading(false); return; }
    setLoading(true);
    fetchOrgMembers(currentOrg.id)
      .then((data) => setMembers(data.items || []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [currentOrg]);

  async function handleInvite() {
    if (!currentOrg || !inviteEmail) return;
    setSaving(true);
    setMsg("");
    try {
      await inviteMember(currentOrg.id, inviteEmail, inviteRole);
      setMsg("Invite sent");
      setInviteEmail("");
      const data = await fetchOrgMembers(currentOrg.id);
      setMembers(data.items || []);
    } catch (e: any) { setMsg(e.message); }
    finally { setSaving(false); }
  }

  async function handleRoleChange(memberUserId: string, role: string) {
    if (!currentOrg) return;
    try {
      await updateMemberRole(currentOrg.id, memberUserId, role);
      const data = await fetchOrgMembers(currentOrg.id);
      setMembers(data.items || []);
    } catch (e: any) { alert(e.message); }
  }

  async function handleRemove(memberUserId: string) {
    if (!currentOrg) return;
    try {
      await removeMember(currentOrg.id, memberUserId);
      const data = await fetchOrgMembers(currentOrg.id);
      setMembers(data.items || []);
    } catch (e: any) { alert(e.message); }
  }

  const userRole = currentOrg?.role || "viewer";
  const isAdmin = userRole === "admin";

  const [newOrgName, setNewOrgName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreateOrg() {
    if (!newOrgName.trim()) return;
    setCreating(true);
    setMsg("");
    try {
      await createOrg(newOrgName.trim());
      setNewOrgName("");
      setMsg("Organization created!");
      await refresh();
    } catch (e: any) { setMsg(e.message); }
    finally { setCreating(false); }
  }

  if (!currentOrg) return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">You don't belong to any organization yet.</p>
      <div className="flex items-center gap-2">
        <input type="text" value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)}
          placeholder="Organization name..."
          className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 outline-none" />
        <button onClick={handleCreateOrg} disabled={creating || !newOrgName.trim()}
          className="flex items-center gap-1 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
          {creating ? <Loader2 size={12} className="animate-spin" /> : <Building2 size={12} />}
          Create
        </button>
      </div>
      {msg && <p className={`text-xs ${msg.includes("created") ? "text-green-600" : "text-red-600"}`}>{msg}</p>}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Current Org Info */}
      <div className="rounded-lg bg-indigo-50 p-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-indigo-900">{currentOrg.name}</p>
          <p className="text-xs text-indigo-600">Your role: {currentOrg.role}</p>
        </div>
        <span className="text-[10px] font-medium bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{currentOrg.id.slice(0, 8)}</span>
      </div>

      {/* Invite Form (admin only) */}
      {isAdmin && (
        <div className="flex items-center gap-2">
          <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="Email to invite..."
            className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 outline-none" />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs bg-white">
            <option value="viewer">Viewer</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
          <button onClick={handleInvite} disabled={saving || !inviteEmail}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            <Send size={12} />
            {saving ? "..." : "Invite"}
          </button>
        </div>
      )}
      {msg && <p className={`text-xs ${msg.includes("sent") ? "text-green-600" : "text-red-600"}`}>{msg}</p>}

      {/* Members List */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-500">Members ({members.length})</span>
        </div>
        {loading ? (
          <div className="text-xs text-gray-400 py-2"><Loader2 size={12} className="animate-spin inline mr-1" />Loading...</div>
        ) : members.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">No members found.</p>
        ) : (
          <div className="space-y-1.5">
            {members.map((m: any) => (
              <div key={m.user_id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-[9px] font-bold shrink-0">
                  {m.email?.[0]?.toUpperCase() || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">{m.email || m.user_id?.slice(0, 8)}</p>
                </div>
                {isAdmin ? (
                  <div className="flex items-center gap-1">
                    <select value={m.role} onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                      className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] bg-white">
                      <option value="viewer">Viewer</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button onClick={() => handleRemove(m.user_id)} className="text-gray-400 hover:text-red-600 p-0.5" title="Remove">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ) : (
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                    m.role === "admin" ? "bg-indigo-50 text-indigo-700" :
                    m.role === "manager" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"
                  }`}>{m.role}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== COMPANY PROFILE TAB ========== */
function CompanyProfileTab({ isPlatformAdmin }: { isPlatformAdmin?: boolean }) {
  const { currentOrg, orgs, setCurrentOrg, refresh } = useOrg();
  const userRole = currentOrg?.role || "";
  const isOrgAdmin = userRole === "admin";

  const [allOrgs, setAllOrgs] = useState<any[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [orgDetail, setOrgDetail] = useState<any>(null);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isPlatform = isPlatformAdmin;

  const [form, setForm] = useState({
    name: "", legal_name: "", email: "", phone: "", fax: "", website: "",
    address: "", city: "", state: "", postal_code: "", country: "",
    vat_number: "", tax_id: "", sic_code: "", company_type: "",
    employee_count: "", annual_revenue: "",
    industry: "", description: "", parent_company: "",
  });

  // Load org list for platform admin
  useEffect(() => {
    if (isPlatform) {
      setLoadingOrgs(true);
      fetchAllOrgs()
        .then(r => {
          setAllOrgs(r?.items || []);
          if (r?.items?.length > 0 && !selectedOrgId) {
            setSelectedOrgId(r.items[0].id);
          }
        })
        .catch(() => setAllOrgs([]))
        .finally(() => setLoadingOrgs(false));
    } else if (currentOrg) {
      setAllOrgs([currentOrg]);
      setSelectedOrgId(currentOrg.id);
      setLoadingOrgs(false);
    } else {
      setLoadingOrgs(false);
    }
  }, [isPlatform, currentOrg]);

  // Load org detail when selected
  useEffect(() => {
    if (!selectedOrgId) { setOrgDetail(null); return; }
    setLoadingDetail(true);
    fetchOrgDetail(selectedOrgId)
      .then(d => {
        setOrgDetail(d);
        setForm({
          name: d.name || "", legal_name: d.legal_name || "", email: d.email || "",
          phone: d.phone || "", fax: d.fax || "", website: d.website || "",
          address: d.address || "", city: d.city || "", state: d.state || "",
          postal_code: d.postal_code || "", country: d.country || "",
          vat_number: d.vat_number || "", tax_id: d.tax_id || "", sic_code: d.sic_code || "",
          company_type: d.company_type || "",
          employee_count: d.employee_count ?? "", annual_revenue: d.annual_revenue ?? "",
          industry: d.industry || "", description: d.description || "", parent_company: d.parent_company || "",
        });
      })
      .catch(() => setOrgDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [selectedOrgId]);

  function set(field: string, value: any) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!selectedOrgId) return;
    setSaving(true); setMsg("");
    try {
      const payload: Record<string, any> = { ...form };
      if (payload.employee_count === "") payload.employee_count = null;
      if (payload.annual_revenue === "") payload.annual_revenue = null;
      await updateOrg(selectedOrgId, payload);
      setMsg("Company saved successfully");
      // Refresh org list
      if (isPlatform) {
        const r = await fetchAllOrgs();
        setAllOrgs(r?.items || []);
      } else {
        await refresh();
      }
    } catch (e: any) { setMsg(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!selectedOrgId) return;
    setDeleting(true); setMsg("");
    try {
      await deleteOrg(selectedOrgId);
      setMsg("Company deleted");
      setShowDeleteConfirm(false);
      if (isPlatform) {
        const r = await fetchAllOrgs();
        setAllOrgs(r?.items || []);
        if (r?.items?.length > 0) setSelectedOrgId(r.items[0].id);
        else setSelectedOrgId("");
      } else {
        await refresh();
      }
    } catch (e: any) { setMsg(e.message); }
    finally { setDeleting(false); }
  }

  async function handleCreateNew() {
    const name = prompt("Enter company name:");
    if (!name?.trim()) return;
    try {
      await createOrg(name.trim());
      if (isPlatform) {
        const r = await fetchAllOrgs();
        setAllOrgs(r?.items || []);
        if (r?.items?.length > 0) setSelectedOrgId(r.items[r.items.length - 1].id);
      } else {
        await refresh();
      }
      setMsg("Company created");
    } catch (e: any) { setMsg(e.message); }
  }

  const cannotEdit = !isPlatform && !isOrgAdmin;

  // Show org list view for platform admin
  if (isPlatform) {
    return (
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Company Management</h2>
            <p className="text-xs text-gray-400 mt-0.5">Create, edit and manage organizations</p>
          </div>
          <button onClick={handleCreateNew}
            className="flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-800 transition-colors">
            <Plus size={13} /> New Company
          </button>
        </div>

        <div className="flex gap-4">
          {/* Org list sidebar */}
          <div className="w-56 shrink-0">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Organizations</p>
              </div>
              {loadingOrgs ? (
                <div className="text-xs text-gray-400 py-4 text-center"><Loader2 size={12} className="animate-spin inline mr-1" />Loading...</div>
              ) : allOrgs.length === 0 ? (
                <div className="text-xs text-gray-400 py-4 text-center">No organizations yet</div>
              ) : (
                <div className="divide-y divide-gray-50 max-h-[calc(100vh-300px)] overflow-y-auto">
                  {allOrgs.map(o => (
                    <button key={o.id} onClick={() => setSelectedOrgId(o.id)}
                      className={`w-full text-left px-3 py-2.5 transition-colors ${selectedOrgId === o.id ? "bg-gray-50 border-l-2 border-black" : "hover:bg-gray-50 border-l-2 border-transparent"}`}>
                      <p className="text-xs font-medium text-gray-800 truncate">{o.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{o.industry || "—"}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Detail panel */}
          <div className="flex-1 min-w-0">
            {!selectedOrgId ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Building2 size={40} className="mb-3 opacity-30" />
                <p className="text-sm">Select an organization to edit</p>
              </div>
            ) : loadingDetail ? (
              <div className="text-xs text-gray-400 py-8 text-center"><Loader2 size={14} className="animate-spin inline mr-1" />Loading...</div>
            ) : orgDetail ? (
              <CompanyForm form={form} set={set} handleSave={handleSave} handleDelete={() => setShowDeleteConfirm(true)}
                saving={saving} deleting={deleting} msg={msg} cannotEdit={false}
                selectedOrgName={orgDetail.name} />
            ) : (
              <p className="text-xs text-red-400">Failed to load organization</p>
            )}
          </div>
        </div>

        {/* Delete confirmation modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full mx-3">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Delete {orgDetail?.name}?</h3>
              <p className="text-xs text-gray-500 mb-4">This will permanently delete the organization and all associated data. This action cannot be undone.</p>
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setShowDeleteConfirm(false)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                <button onClick={handleDelete} disabled={deleting}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors">
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Regular user view
  if (!currentOrg) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <Building2 size={40} className="mb-3 opacity-30" />
        <p className="text-sm">No organization selected</p>
      </div>
    );
  }

  if (loadingDetail) {
    return <div className="text-xs text-gray-400 py-8 text-center"><Loader2 size={14} className="animate-spin inline mr-1" />Loading...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Company Profile</h2>
          <p className="text-xs text-gray-400 mt-0.5">Manage your organization's information</p>
        </div>
        {cannotEdit && (
          <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded">View only</span>
        )}
      </div>

      <CompanyForm form={form} set={set} handleSave={handleSave} handleDelete={() => setShowDeleteConfirm(true)}
        saving={saving} deleting={deleting} msg={msg} cannotEdit={cannotEdit}
        selectedOrgName={orgDetail?.name} />

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full mx-3">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Delete {orgDetail?.name}?</h3>
            <p className="text-xs text-gray-500 mb-4">This will permanently delete the organization and all associated data.</p>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== COMPANY FORM (shared) ========== */
function CompanyForm({ form, set, handleSave, handleDelete, saving, deleting, msg, cannotEdit, selectedOrgName }: {
  form: any; set: (f: string, v: any) => void; handleSave: () => void; handleDelete: () => void;
  saving: boolean; deleting: boolean; msg: string; cannotEdit: boolean; selectedOrgName: string;
}) {
  const INDUSTRIES = ["Technology", "Finance", "Healthcare", "Manufacturing", "Retail", "Real Estate",
    "Consulting", "Education", "Legal", "Construction", "Transportation", "Energy",
    "Hospitality", "Media", "Agriculture", "Nonprofit", "Government", "Other"];
  const COMPANY_TYPES = ["Prospect", "Customer", "Partner", "Vendor", "Competitor", "Other"];

  const inputClass = `w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400 transition-colors`;
  const labelClass = `block text-xs font-medium text-gray-500 mb-1`;

  return (
    <div className="space-y-5">
      {/* Core Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Core Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
          <div className="sm:col-span-2">
            <label className={labelClass}>Company Name *</label>
            <div className="relative">
              <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={form.name} onChange={e => set("name", e.target.value)}
                disabled={cannotEdit} placeholder="Acme Corp"
                className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400" />
            </div>
          </div>
          <div>
            <label className={labelClass}>Legal Name</label>
            <input type="text" value={form.legal_name} onChange={e => set("legal_name", e.target.value)}
              disabled={cannotEdit} placeholder="Acme Corporation"
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Parent Company</label>
            <input type="text" value={form.parent_company} onChange={e => set("parent_company", e.target.value)}
              disabled={cannotEdit} placeholder="Parent organization"
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Company Email</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="email" value={form.email} onChange={e => set("email", e.target.value)}
                disabled={cannotEdit} placeholder="info@acme.com"
                className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400" />
            </div>
          </div>
          <div>
            <label className={labelClass}>Website</label>
            <div className="relative">
              <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={form.website} onChange={e => set("website", e.target.value)}
                disabled={cannotEdit} placeholder="https://acme.com"
                className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400" />
            </div>
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <div className="relative">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={form.phone} onChange={e => set("phone", e.target.value)}
                disabled={cannotEdit} placeholder="+1 555-123-4567"
                className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400" />
            </div>
          </div>
          <div>
            <label className={labelClass}>Fax</label>
            <input type="text" value={form.fax} onChange={e => set("fax", e.target.value)}
              disabled={cannotEdit} placeholder="+1 555-123-4568"
              className={inputClass} />
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><MapPin size={13} /> Address</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
          <div className="sm:col-span-2">
            <label className={labelClass}>Street Address</label>
            <input type="text" value={form.address} onChange={e => set("address", e.target.value)}
              disabled={cannotEdit} placeholder="123 Main Street, Suite 100"
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>City</label>
            <input type="text" value={form.city} onChange={e => set("city", e.target.value)}
              disabled={cannotEdit} placeholder="San Francisco"
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>State / Province</label>
            <input type="text" value={form.state} onChange={e => set("state", e.target.value)}
              disabled={cannotEdit} placeholder="CA"
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Postal Code</label>
            <input type="text" value={form.postal_code} onChange={e => set("postal_code", e.target.value)}
              disabled={cannotEdit} placeholder="94105"
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Country</label>
            <input type="text" value={form.country} onChange={e => set("country", e.target.value)}
              disabled={cannotEdit} placeholder="United States"
              className={inputClass} />
          </div>
        </div>
      </div>

      {/* Classification */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Classification</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
          <div>
            <label className={labelClass}>Industry</label>
            <select value={form.industry} onChange={e => set("industry", e.target.value)}
              disabled={cannotEdit}
              className={`${inputClass} appearance-none bg-white`}>
              <option value="">Select industry...</option>
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Company Type</label>
            <select value={form.company_type} onChange={e => set("company_type", e.target.value)}
              disabled={cannotEdit}
              className={`${inputClass} appearance-none bg-white`}>
              <option value="">Select type...</option>
              {COMPANY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Employee Count</label>
            <input type="number" value={form.employee_count} onChange={e => set("employee_count", e.target.value ? parseInt(e.target.value) : "")}
              disabled={cannotEdit} placeholder="50"
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Annual Revenue ($)</label>
            <input type="number" step="0.01" value={form.annual_revenue} onChange={e => set("annual_revenue", e.target.value ? parseFloat(e.target.value) : "")}
              disabled={cannotEdit} placeholder="1000000"
              className={inputClass} />
          </div>
        </div>
      </div>

      {/* Tax & Registration */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><FileText size={13} /> Tax & Registration</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
          <div>
            <label className={labelClass}>VAT Number</label>
            <input type="text" value={form.vat_number} onChange={e => set("vat_number", e.target.value)}
              disabled={cannotEdit} placeholder="EU VAT ID"
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Tax ID / EIN</label>
            <input type="text" value={form.tax_id} onChange={e => set("tax_id", e.target.value)}
              disabled={cannotEdit} placeholder="XX-XXXXXXX"
              className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>SIC Code</label>
            <input type="text" value={form.sic_code} onChange={e => set("sic_code", e.target.value)}
              disabled={cannotEdit} placeholder="7371"
              className={inputClass} />
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">About</h3>
        <textarea value={form.description} onChange={e => set("description", e.target.value)}
          disabled={cannotEdit} rows={3}
          className={`${inputClass} resize-none`} placeholder="Company description..." />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!cannotEdit && (
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Saving..." : "Save Changes"}
            </button>
          )}
          {msg && <span className={`text-xs ${msg.includes("saved") || msg.includes("created") || msg.includes("deleted") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
        </div>
        {!cannotEdit && (
          <button onClick={handleDelete} disabled={deleting}
            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
            <Trash2 size={12} /> Delete Company
          </button>
        )}
      </div>
    </div>
  );
}

/* ========== TEAM TAB ========== */
const PERMISSION_MATRIX: { role: string; label: string; actions: { name: string; allowed: boolean }[] }[] = [
  { role: "viewer", label: "Viewer", actions: [
    { name: "View Dashboard", allowed: true },
    { name: "View Proofs", allowed: true },
    { name: "View Receipts", allowed: true },
    { name: "Upload Files", allowed: false },
    { name: "Edit Records", allowed: false },
    { name: "Delete Records", allowed: false },
    { name: "Run Reconciliation", allowed: false },
    { name: "Manage Members", allowed: false },
  ]},
  { role: "manager", label: "Manager", actions: [
    { name: "View Dashboard", allowed: true },
    { name: "View Proofs", allowed: true },
    { name: "View Receipts", allowed: true },
    { name: "Upload Files", allowed: true },
    { name: "Edit Records", allowed: true },
    { name: "Delete Records", allowed: true },
    { name: "Run Reconciliation", allowed: true },
    { name: "Manage Members", allowed: false },
  ]},
  { role: "admin", label: "Admin", actions: [
    { name: "View Dashboard", allowed: true },
    { name: "View Proofs", allowed: true },
    { name: "View Receipts", allowed: true },
    { name: "Upload Files", allowed: true },
    { name: "Edit Records", allowed: true },
    { name: "Delete Records", allowed: true },
    { name: "Run Reconciliation", allowed: true },
    { name: "Manage Members", allowed: true },
  ]},
];

function TeamTab({ user, isPlatformAdmin }: { user: any; isPlatformAdmin: boolean }) {
  const { currentOrg, orgs, setCurrentOrg, refresh } = useOrg();
  const [subTab, setSubTab] = useState<"orgs" | "people" | "permissions">("people");
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("viewer");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [creating, setCreating] = useState(false);
  const [orgFilter, setOrgFilter] = useState("all");

  const isAdmin = currentOrg?.role === "admin";

  useEffect(() => {
    if (!currentOrg) { setLoading(false); return; }
    setLoading(true);
    fetchOrgMembers(currentOrg.id)
      .then((data) => setMembers(data.items || []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [currentOrg]);

  async function handleAddUser() {
    if (!currentOrg || !addEmail) return;
    setSaving(true); setMsg("");
    try {
      await inviteMember(currentOrg.id, addEmail, addRole);
      setMsg("User added"); setAddEmail("");
      const data = await fetchOrgMembers(currentOrg.id);
      setMembers(data.items || []);
    } catch (e: any) { setMsg(e.message); }
    finally { setSaving(false); }
  }

  async function handleRoleChange(memberUserId: string, role: string) {
    if (!currentOrg) return;
    try {
      await updateMemberRole(currentOrg.id, memberUserId, role);
      const data = await fetchOrgMembers(currentOrg.id);
      setMembers(data.items || []);
    } catch (e: any) { alert(e.message); }
  }

  async function handleRemove(memberUserId: string) {
    if (!currentOrg) return;
    try {
      await removeMember(currentOrg.id, memberUserId);
      const data = await fetchOrgMembers(currentOrg.id);
      setMembers(data.items || []);
    } catch (e: any) { alert(e.message); }
  }

  async function handleCreateOrg() {
    if (!newOrgName.trim()) return;
    setCreating(true); setMsg("");
    try {
      const org = await createOrg(newOrgName.trim());
      setNewOrgName("");
      setMsg(`"${org.name}" created`);
      await refresh();
    } catch (e: any) { setMsg(e.message); }
    finally { setCreating(false); }
  }

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-100 pb-2">
        <button onClick={() => setSubTab("orgs")}
          className={`text-xs px-3 py-1.5 rounded transition-colors ${subTab === "orgs" ? "bg-gray-900 text-white font-medium" : "text-gray-400 hover:text-gray-600"}`}>
          Organizations
        </button>
        <button onClick={() => setSubTab("people")}
          className={`text-xs px-3 py-1.5 rounded transition-colors ${subTab === "people" ? "bg-gray-900 text-white font-medium" : "text-gray-400 hover:text-gray-600"}`}>
          People
        </button>
        <button onClick={() => setSubTab("permissions")}
          className={`text-xs px-3 py-1.5 rounded transition-colors ${subTab === "permissions" ? "bg-gray-900 text-white font-medium" : "text-gray-400 hover:text-gray-600"}`}>
          Permissions
        </button>
      </div>

      {/* ====== ORGS TAB ====== */}
      {subTab === "orgs" && (
        <div className="space-y-4">
          {/* My orgs */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Organizations</p>
            {orgs.length === 0 ? (
              <p className="text-xs text-gray-400">No organizations yet.</p>
            ) : (
              <div className="space-y-1">
                {orgs.map((o) => {
                  const isCurrent = currentOrg?.id === o.id;
                  return (
                    <div key={o.id}
                      className={`flex items-center justify-between rounded px-3 py-2 ${isCurrent ? "bg-gray-100" : "bg-gray-50 hover:bg-gray-100"}`}>
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded bg-gray-300 text-white flex items-center justify-center text-[8px] font-bold">{o.name[0]}</div>
                        <div>
                          <p className="text-xs font-medium text-gray-800">{o.name}</p>
                          <p className="text-[10px] text-gray-400">{o.role}</p>
                        </div>
                      </div>
                      {isCurrent ? (
                        <span className="text-[10px] text-gray-400">active</span>
                      ) : (
                        <button onClick={() => setCurrentOrg(o)}
                          className="text-[10px] text-gray-500 hover:text-black underline">switch</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-medium text-gray-500 mb-2">Create Organization</p>
            <div className="flex items-center gap-2">
              <input type="text" value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Organization name..."
                className="flex-1 rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-gray-400" />
              <button onClick={handleCreateOrg} disabled={creating || !newOrgName.trim()}
                className="flex items-center gap-1 rounded bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Create
              </button>
            </div>
            {msg && <p className="text-xs text-green-600 mt-1">{msg}</p>}
          </div>
        </div>
      )}

      {/* ====== PEOPLE TAB ====== */}
      {subTab === "people" && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Add Person to Company</p>
            <div className="flex items-center gap-2">
              <input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)}
                placeholder="Email address..."
                className="flex-1 rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-gray-400" />
              <select value={addRole} onChange={(e) => setAddRole(e.target.value)}
                className="rounded border border-gray-200 px-2 py-1.5 text-xs bg-white outline-none">
                <option value="viewer">Viewer</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
              <button onClick={handleAddUser} disabled={saving || !addEmail || !currentOrg}
                className="flex items-center gap-1 rounded bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                Add
              </button>
            </div>
            {msg && <p className={`text-xs mt-1 ${msg === "User added" ? "text-green-600" : "text-red-600"}`}>{msg}</p>}
            {!currentOrg && <p className="text-xs text-gray-400 mt-1">Select an organization first.</p>}
          </div>

          <div className="border-t border-gray-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500">People ({members.length})</p>
              <div className="flex items-center gap-1">
                <label className="text-[10px] text-gray-400">Org:</label>
                <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}
                  className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] bg-white outline-none">
                  <option value="all">All</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            </div>
            {loading ? (
              <div className="text-xs text-gray-400 py-4"><Loader2 size={12} className="animate-spin inline mr-1" />Loading...</div>
            ) : members.length === 0 ? (
              <p className="text-xs text-gray-400 py-4">No people in this organization.</p>
            ) : (
              <div className="space-y-1">
                {members.map((m: any) => (
                  <div key={m.user_id} className="flex items-center gap-3 rounded bg-gray-50 px-3 py-2.5">
                    <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-500">
                      {(m.display_name?.[0] || m.email?.[0] || "?").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{m.display_name || m.email || m.user_id?.slice(0, 8)}</p>
                      {m.email && <p className="text-[10px] text-gray-400 truncate">{m.email}</p>}
                    </div>
                    {isAdmin || isPlatformAdmin ? (
                      <div className="flex items-center gap-1">
                        <select value={m.role} onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                          className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] bg-white outline-none">
                          <option value="viewer">Viewer</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button onClick={() => handleRemove(m.user_id)} className="text-gray-300 hover:text-red-500 p-1" title="Remove">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        m.role === "admin" ? "bg-gray-800 text-white" :
                        m.role === "manager" ? "bg-gray-200 text-gray-700" : "bg-gray-100 text-gray-500"
                      }`}>{m.role}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====== PERMISSIONS TAB ====== */}
      {subTab === "permissions" && (
        <div className="space-y-4">
          <p className="text-xs font-medium text-gray-500 mb-2">Role Permissions</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left font-medium text-gray-400 py-2 pr-4">Action</th>
                  {PERMISSION_MATRIX.map(p => (
                    <th key={p.role} className="text-center font-medium text-gray-600 py-2 px-3">{p.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_MATRIX[0].actions.map((action, idx) => (
                  <tr key={idx} className="border-b border-gray-50">
                    <td className="py-2 pr-4 text-gray-700">{action.name}</td>
                    {PERMISSION_MATRIX.map(p => (
                      <td key={p.role} className="text-center py-2 px-3">
                        {p.actions[idx].allowed ? (
                          <Check size={13} className="inline text-green-500" />
                        ) : (
                          <X size={13} className="inline text-gray-300" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-medium text-gray-500 mb-2">User Role Summary</p>
            {loading ? (
              <div className="text-xs text-gray-400 py-2"><Loader2 size={12} className="animate-spin inline mr-1" />Loading...</div>
            ) : members.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">No members found.</p>
            ) : (
              <div className="space-y-1">
                {members.map((m: any) => (
                  <div key={m.user_id} className="flex items-center gap-3 rounded bg-gray-50 px-3 py-2">
                    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-bold text-gray-500">
                      {(m.display_name?.[0] || m.email?.[0] || "?").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate">{m.display_name || m.email || m.user_id?.slice(0, 8)}</p>
                    </div>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      m.role === "admin" ? "bg-gray-800 text-white" :
                      m.role === "manager" ? "bg-gray-200 text-gray-700" : "bg-gray-100 text-gray-500"
                    }`}>{m.role}</span>
                    {isAdmin && (
                      <button onClick={() => { setSubTab("people"); }} className="text-[10px] text-gray-400 hover:text-black underline">change</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== ACCOUNTING ENTRIES TAB ========== */
function AccountingEntriesTab() {
  const { currentOrg } = useOrg();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ amount: "", currency: "USD", status: "posted" });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const canEdit = currentOrg?.role === "admin" || currentOrg?.role === "manager";

  useEffect(() => { loadEntries(); }, [dateFrom, dateTo, statusFilter]);

  async function loadEntries() {
    setLoading(true);
    try {
      const data = await fetchAccountingEntries({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        status: statusFilter || undefined,
        page_size: 200,
      });
      setEntries(data.items || []);
    } catch { setEntries([]); }
    finally { setLoading(false); }
  }

  function resetForm() {
    setForm({ amount: "", currency: "USD", receipt_number: "", payer_name: "", payment_date: "", description: "", vendor: "", cost_center: "", account_code: "", status: "posted", notes: "" });
  }

  function startCreate() {
    resetForm();
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(e: any) {
    setForm({
      amount: e.amount ?? "",
      currency: e.currency ?? "USD",
      receipt_number: e.receipt_number ?? "",
      payer_name: e.payer_name ?? "",
      payment_date: e.payment_date ?? "",
      description: e.description ?? "",
      vendor: e.vendor ?? "",
      cost_center: e.cost_center ?? "",
      account_code: e.account_code ?? "",
      status: e.status ?? "posted",
      notes: e.notes ?? "",
    });
    setEditingId(e.id);
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.amount) payload.amount = parseFloat(payload.amount);
      if (editingId) {
        await updateAccountingEntry(editingId, payload);
      } else {
        await createAccountingEntry(payload);
      }
      setShowForm(false);
      setEditingId(null);
      loadEntries();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    try {
      await deleteAccountingEntry(id);
      setConfirmDelete(null);
      loadEntries();
    } catch (e: any) { alert(e.message); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Accounting Entries</h2>
        <div className="flex items-center gap-2">
          <button onClick={loadEntries} className="text-sm text-gray-500 hover:text-blue-600"><RefreshCw size={14} className="inline mr-1" />Refresh</button>
          {canEdit && (
            <button onClick={startCreate} className="flex items-center gap-1 text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"><Plus size={14} />Add Entry</button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-2 flex-wrap items-center">
        <div className="flex items-center gap-1.5">
          <Filter size={14} className="text-gray-400" />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 outline-none" title="From date" />
          <span className="text-xs text-gray-400">—</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 outline-none" title="To date" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 outline-none bg-white">
          <option value="">All Statuses</option>
          <option value="posted">Posted</option>
          <option value="pending">Pending</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {(dateFrom || dateTo || statusFilter) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); setStatusFilter(""); }}
            className="text-xs text-gray-500 hover:text-red-600 px-2 py-1.5 border rounded-lg">Clear</button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{entries.length} entries</span>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="rounded-xl border bg-white p-5 shadow-sm mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">{editingId ? "Edit Entry" : "New Entry"}</h3>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Amount *", key: "amount", type: "number" },
              { label: "Currency", key: "currency" },
              { label: "Receipt #", key: "receipt_number" },
              { label: "Payer Name", key: "payer_name" },
              { label: "Payment Date", key: "payment_date", type: "date" },
              { label: "Vendor", key: "vendor" },
              { label: "Cost Center", key: "cost_center" },
              { label: "Account Code", key: "account_code" },
              { label: "Status", key: "status" },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-xs text-gray-500 mb-0.5">{f.label}</label>
                {f.key === "status" ? (
                  <select value={form[f.key] || "posted"} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 outline-none bg-white">
                    <option value="posted">Posted</option>
                    <option value="pending">Pending</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                ) : (
                  <input type={f.type || "text"} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 outline-none" />
                )}
              </div>
            ))}
          </div>
          <div className="mt-3">
            <label className="block text-xs text-gray-500 mb-0.5">Description</label>
            <textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 outline-none" rows={2} />
          </div>
          <div className="mt-3">
            <label className="block text-xs text-gray-500 mb-0.5">Notes</label>
            <textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 outline-none" rows={2} />
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => { setShowForm(false); setEditingId(null); }}
              className="text-xs text-gray-500 px-3 py-1.5 border rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.amount}
              className="flex items-center gap-1 text-xs text-white bg-blue-600 px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {saving ? "Saving..." : editingId ? "Update Entry" : "Create Entry"}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? <div className="text-center py-8 text-sm text-gray-500"><Loader2 size={16} className="animate-spin inline mr-2" />Loading...</div>
      : entries.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-10 text-center">
          <Database size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500 mb-1">No accounting entries found</p>
          <p className="text-xs text-gray-400 mb-4">Adjust date filters or create a new entry</p>
          <button onClick={startCreate} className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"><Plus size={14} className="inline mr-1" />Add Entry</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-gray-500 font-medium">
                <th className="px-3 py-2.5 whitespace-nowrap">Receipt #</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Amount</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Payer</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Vendor</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Date</th>
                <th className="px-3 py-2.5 whitespace-nowrap">CC</th>
                <th className="px-3 py-2.5 whitespace-nowrap">AC</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Status</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Description</th>
                <th className="px-3 py-2.5 whitespace-nowrap w-24 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{e.receipt_number || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-semibold text-gray-800">
                    {e.amount != null ? `${Number(e.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${e.currency || "USD"}` : "—"}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 max-w-[120px] truncate" title={e.payer_name}>{e.payer_name || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 max-w-[100px] truncate" title={e.vendor}>{e.vendor || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{e.payment_date || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{e.cost_center || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{e.account_code || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded-full ${
                      e.status === "posted" ? "bg-green-50 text-green-700" :
                      e.status === "pending" ? "bg-yellow-50 text-yellow-700" :
                      e.status === "cancelled" ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-600"
                    }`}>{e.status}</span>
                  </td>
                  <td className="px-3 py-2.5 max-w-[160px] truncate text-gray-500" title={e.description || e.notes}>{e.description || e.notes || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      {canEdit && <button onClick={() => startEdit(e)} className="text-gray-400 hover:text-blue-600 p-1" title="Select"><Check size={14} /></button>}
                      {canEdit && <button onClick={() => startEdit(e)} className="text-gray-400 hover:text-amber-600 p-1" title="Amend"><Edit3 size={14} /></button>}
                      {canEdit && (confirmDelete === e.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleDelete(e.id)} className="text-red-600 hover:text-red-800 p-1" title="Confirm Delete"><Check size={14} /></button>
                          <button onClick={() => setConfirmDelete(null)} className="text-gray-400 hover:text-gray-600 p-1" title="Cancel"><X size={14} /></button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(e.id)} className="text-gray-400 hover:text-red-600 p-1" title="Delete"><Trash2 size={14} /></button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ========== PROCESSING LOG TAB ========== */
function ProcessingLogTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { loadLogs(); }, [page, dateFrom, dateTo, search, stageFilter]);

  const STAGES = ["", "upload", "ocr", "classify", "llm_primary", "llm_fallback", "regex", "routing", "erp_sync", "reconciliation", "reconciliation_analysis", "extraction"];

  async function loadLogs() {
    setLoading(true);
    try {
      const data = await fetchProcessingLogs({
        page, page_size: 50,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: search || undefined,
        stage: stageFilter || undefined,
      });
      setLogs(data.items || []);
      setTotal(data.total || 0);
    } catch { setLogs([]); }
    finally { setLoading(false); }
  }

  const STAGE_COLORS: Record<string, string> = {
    upload: "bg-blue-50 text-blue-700",
    ocr: "bg-gray-50 text-gray-700",
    classify: "bg-purple-50 text-purple-700",
    llm_primary: "bg-indigo-50 text-indigo-700",
    llm_fallback: "bg-amber-50 text-amber-700",
    regex: "bg-orange-50 text-orange-700",
    routing: "bg-cyan-50 text-cyan-700",
    erp_sync: "bg-emerald-50 text-emerald-700",
    reconciliation: "bg-blue-50 text-blue-700",
    reconciliation_analysis: "bg-violet-50 text-violet-700",
    extraction: "bg-green-50 text-green-700",
  };

  function formatMessage(msg: string | null) {
    if (!msg) return "—";
    try {
      const parsed = JSON.parse(msg);
      return typeof parsed === "object" ? JSON.stringify(parsed, null, 2) : msg;
    } catch {
      return msg;
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold">Processing Log</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search..."
              className="rounded-lg border border-gray-300 pl-7 pr-3 py-1.5 text-xs focus:border-blue-500 outline-none w-36" />
          </div>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 outline-none" />
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 outline-none" />
          <button onClick={loadLogs} className="text-xs text-gray-500 hover:text-blue-600 bg-white border rounded-lg px-2.5 py-1.5"><RefreshCw size={12} className="inline mr-1" /> Refresh</button>
        </div>
      </div>
      <div className="mb-3 flex gap-1.5 flex-wrap">
        {STAGES.map((s) => (
          <button key={s} onClick={() => { setStageFilter(s); setPage(1); }}
            className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
              stageFilter === s ? "bg-indigo-600 text-white shadow-sm" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}>
            {s ? s.replace(/_/g, " ") : "All"}
          </button>
        ))}
        {(dateFrom || dateTo || search || stageFilter) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); setSearch(""); setStageFilter(""); setPage(1); }}
            className="text-[10px] text-gray-400 hover:text-red-600 px-2 py-1 border border-gray-200 rounded-full">Clear</button>
        )}
        <span className="text-[10px] text-gray-400 ml-auto self-center">{total} entries</span>
      </div>

      {loading ? <div className="text-center py-8 text-sm text-gray-500"><Loader2 size={16} className="animate-spin inline mr-2" />Loading...</div>
      : logs.length === 0 ? <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">No log entries found.</div>
      : (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-gray-500 font-medium">
                <th className="px-3 py-2.5 whitespace-nowrap w-24">Stage</th>
                <th className="px-3 py-2.5 whitespace-nowrap w-16">Status</th>
                <th className="px-3 py-2.5">Message</th>
                <th className="px-3 py-2.5 whitespace-nowrap w-36">Created At</th>
                <th className="px-3 py-2.5 whitespace-nowrap w-10"></th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const isExpanded = expandedId === log.id;
                return (
                  <Fragment key={log.id}>
                    <tr className={`border-b last:border-0 hover:bg-gray-50 transition-colors ${log.status === "failure" ? "bg-red-50/20" : ""}`}>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${STAGE_COLORS[log.stage] || "bg-gray-50 text-gray-600"}`}>
                          {log.stage?.replace(/_/g, " ") || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          log.status === "success" ? "bg-green-50 text-green-700" :
                          log.status === "failure" ? "bg-red-50 text-red-700" :
                          "bg-gray-50 text-gray-600"
                        }`}>{log.status || "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 max-w-[400px]">
                        <p className="text-gray-700 truncate" title={log.message || ""}>{log.message ? (log.message.length > 120 ? log.message.slice(0, 120) + "..." : log.message) : "—"}</p>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">
                        {log.created_at ? new Date(log.created_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button onClick={() => setExpandedId(isExpanded ? null : log.id)}
                          className="text-gray-400 hover:text-indigo-600 p-1 transition-colors" title="View details">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${log.id}-detail`}>
                        <td colSpan={5} className="px-3 pb-3">
                          <div className="rounded-lg bg-gray-50 border p-3 text-xs font-mono text-gray-700 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                            {formatMessage(log.message)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {total > 50 && (
            <div className="flex items-center justify-center gap-2 p-3 border-t">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="text-xs text-gray-500 px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-30 transition-colors">Previous</button>
              <span className="text-xs text-gray-400">Page {page} of {Math.ceil(total / 50)}</span>
              <button disabled={page >= Math.ceil(total / 50)} onClick={() => setPage(p => p + 1)}
                className="text-xs text-gray-500 px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-30 transition-colors">Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ========== UPLOAD TAB ========== */
function UploadTab({ user }: { user: any }) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [proofId, setProofId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploadResults, setUploadResults] = useState<{name: string; status: string}[]>([]);
  const [uploadIndex, setUploadIndex] = useState(0);
  const pollRef = useRef<any>(null);
  const cancelRef = useRef(false);
  const uploadingRef = useRef(false);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function cancelUpload() {
    cancelRef.current = true;
    uploadingRef.current = false;
    if (pollRef.current) clearInterval(pollRef.current);
    setUploading(false);
    setProofId(null);
    setProgress(0);
    setCurrentStep("");
    setFiles([]);
  }

  const STEP_LABELS_LOCAL: Record<string, string> = {
    uploaded: "Uploading", ocr: "Extracting text", llm_primary: "AI extraction",
    llm_fallback: "AI fallback", regex: "Regex extraction", routing: "Saving result", done: "Complete",
  };

  function startPolling(id: string) {
    setProofId(id);
    setCurrentStep("uploaded");
    setProgress(10);
    pollRef.current = setInterval(async () => {
      try {
        const [logsRes, proofRes] = await Promise.all([
          fetch(`${API}/api/logs?proof_id=${id}&page=1&page_size=5`, { headers: headers() }),
          fetch(`${API}/api/proofs/${id}`, { headers: headers() }),
        ]);
        if (!logsRes.ok || !proofRes.ok) return;
        const logs = (await logsRes.json()).items || [];
        const proof = await proofRes.json();
        const stages = logs.map((l: any) => l.stage);
        let step = "uploaded";
        if (stages.includes("ocr")) step = "ocr";
        if (stages.includes("llm_primary") || stages.includes("llm_fallback") || stages.includes("regex")) step = "llm_primary";
        if (stages.includes("routing")) step = "routing";
        setCurrentStep(step);
        setProgress(step === "routing" ? 85 : step === "llm_primary" ? 60 : step === "ocr" ? 30 : 10);
        if (["completed", "review_needed", "failed", "ready_to_process"].includes(proof.status)) {
          clearInterval(pollRef.current!);
          setProgress(100);
          setCurrentStep("done");
          setUploading(false);
          setFiles([]);
        }
      } catch (_) {}
    }, 2000);
  }

  async function handleUpload() {
    if (!files.length || uploadingRef.current) return;
    uploadingRef.current = true;
    cancelRef.current = false;
    setUploading(true);
    setError("");
    setUploadResults([]);
    setUploadIndex(0);
    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) break;
      const f = files[i];
      setUploadIndex(i);
      setUploadResults(prev => [...prev, { name: f.name, status: "uploading" }]);
      setProgress(5);
      setCurrentStep("uploaded");
      try {
        const res = await uploadProof(f);
        if (cancelRef.current) break;
        await new Promise<void>((resolve) => {
          const pid = res.id;
          const interval = setInterval(async () => {
            try {
              if (cancelRef.current) { clearInterval(interval); resolve(); return; }
              const proofRes = await fetch(`${API}/api/proofs/${pid}`, { headers: headers() });
              const proof = await proofRes.json();
              if (["completed", "review_needed", "failed", "ready_to_process"].includes(proof.status)) {
                clearInterval(interval);
                setUploadResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: proof.status === "failed" ? "failed" : "done" } : r));
                setProgress(100);
                setCurrentStep("done");
                resolve();
              }
            } catch (_) {}
          }, 2000);
        });
      } catch (err: any) {
        if (cancelRef.current) break;
        setUploadResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: "failed" } : r));
        setError(err.message);
      }
    }
    uploadingRef.current = false;
    if (!cancelRef.current) {
      setFiles([]);
      setUploading(false);
      setProofId(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-0 sm:px-1">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h2 className="text-lg sm:text-xl font-bold">Upload Documents</h2>
        <p className="text-[10px] sm:text-xs text-gray-400">PDF only</p>
      </div>

      {/* Drop zone */}
      {!uploading && !proofId && (
        <div
          onDrop={(e) => { e.preventDefault(); setDragOver(false); setFiles(Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf")); if (Array.from(e.dataTransfer.files).some(f => f.type !== "application/pdf")) setError("Non-PDF files ignored"); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          className={`relative rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center cursor-pointer transition-all ${
            dragOver ? "border-blue-500 bg-blue-50 scale-[1.02]" : "border-gray-300 bg-white hover:border-blue-400 hover:shadow-lg"
          }`}>
          <div className={`absolute inset-0 rounded-2xl transition-opacity ${dragOver ? "bg-blue-50/50" : "opacity-0"}`} />
          <div className="relative">
            <div className={`mx-auto mb-4 w-16 h-16 rounded-2xl flex items-center justify-center transition-colors ${dragOver ? "bg-blue-100" : "bg-gray-100"}`}>
              <Upload size={28} className={dragOver ? "text-blue-600" : "text-gray-400"} />
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">
              {dragOver ? "Drop files here" : "Drag & drop PDF files here"}
            </p>
            <p className="text-xs text-gray-400 mb-4">or</p>
            <label className="inline-flex items-center gap-2 cursor-pointer rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 shadow-sm hover:shadow-md transition-all">
              <UploadCloud size={16} />
              Browse Files
              <input type="file" accept=".pdf" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            </label>
          </div>
        </div>
      )}

      {/* Selected files list */}
      {files.length > 0 && !uploading && (
        <div className="mt-4 rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700">{files.length} file{files.length > 1 ? "s" : ""} selected</span>
            <button onClick={() => setFiles([])} className="text-xs text-gray-500 hover:text-red-600">Clear all</button>
          </div>
          <div className="space-y-1.5">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <FileText size={14} className="text-gray-400" />
                <span className="flex-1 truncate text-gray-700">{f.name}</span>
                <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(1)} KB</span>
              </div>
            ))}
          </div>
          <button onClick={handleUpload} disabled={uploading}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            <UploadCloud size={16} />
            {uploading ? "Uploading..." : `Upload & Process ${files.length > 1 ? `(${files.length} files)` : ""}`}
          </button>
        </div>
      )}

      {/* Full-screen processing overlay */}
      {uploading && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" style={{ backdropFilter: "blur(4px)" }}>
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4">
            <div className="text-center mb-6">
              <div className="relative inline-block mb-4">
                <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="34" fill="none" stroke="#e5e7eb" strokeWidth="5" />
                  <circle cx="40" cy="40" r="34" fill="none" stroke="url(#progGradO)" strokeWidth="5"
                    strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 34}`}
                    strokeDashoffset={`${2 * Math.PI * 34 * (1 - progress / 100)}`}
                    className="transition-all duration-700 ease-out" />
                  <defs>
                    <linearGradient id="progGradO" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 size="28" className="text-blue-500 animate-spin" />
                </div>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">Processing Documents</h3>
              <p className="text-sm text-gray-500">
                {currentStep === "done" ? "Finalizing..." :
                 `File ${uploadIndex + 1} of ${files.length} — ${STEP_LABELS_LOCAL[currentStep] || "Processing..."}`}
              </p>
              <div className="mt-4">
                <div className="text-3xl font-bold text-blue-600">{Math.round(progress)}%</div>
                <div className="text-xs text-gray-400 mt-0.5">complete</div>
              </div>
            </div>

            {/* Step indicators */}
            <div className="mb-6">
              <div className="flex items-center gap-1">
                {["uploaded","ocr","llm_primary","routing"].map((s, i) => {
                  const steps = ["uploaded","ocr","llm_primary","routing"];
                  const idx = steps.indexOf(currentStep);
                  const isActive = s === currentStep;
                  const isDone = idx > i;
                  return (
                    <div key={s} className="flex-1 flex items-center gap-1">
                      <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all ${
                        isDone ? "bg-blue-500 text-white" :
                        isActive ? "bg-blue-100 text-blue-700 ring-2 ring-blue-300" :
                        "bg-gray-100 text-gray-400"
                      }`}>
                        {isDone ? <Check size={14} /> : i + 1}
                      </div>
                      {i < 3 && <div className={`flex-1 h-0.5 rounded ${isDone ? "bg-blue-400" : "bg-gray-200"}`} />}
                    </div>
                  );
                })}
              </div>
              <div className="flex text-[10px] text-gray-400 mt-1 px-0.5">
                {["Upload","OCR","Extract","Save"].map((l, i) => (
                  <div key={l} className={`flex-1 ${i === 0 ? "text-left" : i === 3 ? "text-right" : "text-center"}`}>{l}</div>
                ))}
              </div>
            </div>

            <button onClick={cancelUpload}
              className="w-full rounded-xl border-2 border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 transition-all flex items-center justify-center gap-2">
              <XCircle size={16} />
              Cancel Processing
            </button>
          </div>
        </div>
      )}

      {/* Upload results */}
      {uploadResults.length > 0 && !uploading && (
        <div className="mt-4 rounded-xl border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Upload Results</h3>
          <div className="space-y-1.5">
            {uploadResults.map((r, i) => (
              <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                r.status === "done" ? "bg-green-50 text-green-700" :
                r.status === "failed" ? "bg-red-50 text-red-600" :
                "bg-gray-50 text-gray-500"
              }`}>
                {r.status === "done" ? <CheckCircle size={14} /> : r.status === "failed" ? <AlertCircle size={14} /> : <Loader2 size={14} className="animate-spin" />}
                <span className="flex-1 truncate">{r.name}</span>
                <span className="text-xs font-medium">{r.status}</span>
              </div>
            ))}
          </div>
          <button onClick={() => { setUploadResults([]); setFiles([]); setProofId(null); }}
            className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            Upload More
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 p-4 text-sm text-red-600 border border-red-200">
          <AlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}

/* ========== DASHBOARD TAB ========== */
function OrgAdminDashboard({ user }: { user: any }) {
  const { currentOrg } = useOrg();
  const [members, setMembers] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchOrgMembers(currentOrg?.id || "").then(r => setMembers(r?.items || [])).catch(() => {}),
      fetch(`${API}/api/dashboard/stats`, { headers: headers() }).then(r => r.json()).then(setStats).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [currentOrg?.id]);

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Loading dashboard...</div>;

  const p = stats?.proofs || { total: 0, by_status: {} };
  const r = stats?.receipts || { total: 0, by_status: {} };
  const rec = stats?.reconciliation || { total: 0 };
  const activeMembers = members.filter((m: any) => m.user_id);
  const onlineCount = activeMembers.length;
  const showBreakdown = Object.keys(p.by_status || {}).length > 0;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
        {/* Welcome bar */}
        <div className="rounded-lg border bg-gradient-to-r from-blue-600 to-indigo-700 p-3 text-white shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-[9px] font-medium uppercase tracking-wider">Home</p>
              <h2 className="text-lg font-bold mt-0.5">{currentOrg?.name || "Organization"} Dashboard</h2>
              <p className="text-blue-200 text-[11px] mt-0.5">
                {activeMembers.length} member{activeMembers.length !== 1 ? "s" : ""} &middot; {p.total} proof{p.total !== 1 ? "s" : ""} &middot; {r.total} receipt{r.total !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="bg-white/15 rounded-lg px-2.5 py-1.5 text-right shrink-0">
              <div className="text-lg font-bold">{rec.total}</div>
              <div className="text-[9px] text-blue-200">Reconciliations</div>
            </div>
          </div>
        </div>

        {/* Metric cards */}
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border bg-white p-3 flex items-center gap-3 shadow-sm">
            <div className="rounded-lg p-2 bg-blue-50 text-blue-600"><Users size={16} /></div>
            <div><div className="text-base font-bold">{activeMembers.length}</div><div className="text-[10px] text-gray-500">Team Members</div></div>
          </div>
          <div className="rounded-lg border bg-white p-3 flex items-center gap-3 shadow-sm">
            <div className="rounded-lg p-2 bg-purple-50 text-purple-600"><FileText size={16} /></div>
            <div><div className="text-base font-bold">{p.total}</div><div className="text-[10px] text-gray-500">Proofs</div></div>
          </div>
          <div className="rounded-lg border bg-white p-3 flex items-center gap-3 shadow-sm">
            <div className="rounded-lg p-2 bg-green-50 text-green-600"><Receipt size={16} /></div>
            <div><div className="text-base font-bold">{r.total}</div><div className="text-[10px] text-gray-500">Receipts</div></div>
          </div>
          <div className="rounded-lg border bg-white p-3 flex items-center gap-3 shadow-sm">
            <div className="rounded-lg p-2 bg-amber-50 text-amber-600"><BarChart3 size={16} /></div>
            <div><div className="text-base font-bold">{rec.total}</div><div className="text-[10px] text-gray-500">Reconciliation</div></div>
          </div>
        </div>

        {/* Team + Summary + Status */}
        <div className="grid gap-2 lg:grid-cols-3">
          {/* Team Members */}
          <div className="lg:col-span-2 rounded-lg border bg-white shadow-sm">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
              <h3 className="text-[11px] font-semibold text-gray-600 flex items-center gap-1.5"><Users size={12} /> Team Members</h3>
              <span className="text-[10px] text-gray-400">{activeMembers.length} user{activeMembers.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {activeMembers.map((m: any) => (
                <div key={m.user_id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 transition-colors">
                  <div className="w-6 h-6 rounded-full bg-gray-800 text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                    {(m.display_name || m.email || "U")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-700 truncate">{m.display_name || "Unnamed"}</span>
                    <span className={`text-[9px] font-medium px-1 py-0.5 rounded shrink-0 ${
                      m.role === "admin" ? "bg-purple-50 text-purple-700" :
                      m.role === "manager" ? "bg-blue-50 text-blue-700" :
                      "bg-gray-50 text-gray-500"
                    }`}>{m.role}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    <span className="text-[9px] text-gray-400">active</span>
                  </div>
                </div>
              ))}
              {activeMembers.length === 0 && (
                <div className="px-3 py-6 text-center text-[10px] text-gray-400">No team members</div>
              )}
            </div>
          </div>

          {/* Org Summary */}
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="px-3 py-2 border-b border-gray-100">
              <h3 className="text-[11px] font-semibold text-gray-600 flex items-center gap-1.5"><BarChart3 size={12} /> Org Summary</h3>
            </div>
            <div className="px-3 py-2 space-y-0.5">
              {[
                ["Proofs", p.total], ["Receipts", r.total], ["Reconciliation", rec.total], ["Team", activeMembers.length],
              ].map(([label, val]) => (
                <div key={label as string} className="flex items-center justify-between text-[11px] py-1.5 border-t border-gray-50 first:border-t-0">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-gray-700 font-medium">{val}</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-[11px] py-1.5 border-t border-gray-50">
                <span className="text-gray-500">Status</span>
                <span className="inline-flex items-center gap-1 text-green-600 font-medium text-[10px]"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Active</span>
              </div>
            </div>
          </div>
        </div>

        {/* Proof status breakdown */}
        {showBreakdown && (
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <h4 className="text-[11px] font-semibold text-gray-600 mb-2 flex items-center gap-1.5"><FileText size={12} className="text-gray-400" /> Proof Status</h4>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(p.by_status).map(([status, count]: [string, any]) => (
                <span key={status} className="rounded bg-gray-50 px-2 py-1 text-[10px] flex items-center gap-1.5 border border-gray-100">
                  <span className="text-gray-500 capitalize">{status.replace(/_/g, " ")}</span>
                  <span className="font-semibold text-gray-700">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [u, n] = await Promise.all([
        fetchUnreadCount(),
        fetchNotifications(1, 10),
      ]);
      setUnread(u.count || 0);
      setNotifications(n.items || []);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function timeAgo(ts: string) {
    if (!ts) return "";
    const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (sec < 60) return "now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    return `${Math.floor(hr / 24)}d`;
  }

  function typeIcon(type: string) {
    switch (type) {
      case "review_needed": return <AlertTriangle size={11} className="text-amber-500" />;
      case "fraud_detected": return <Shield size={11} className="text-red-500" />;
      case "upload_failed": return <XCircle size={11} className="text-red-400" />;
      default: return <Info size={11} className="text-blue-400" />;
    }
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    setUnread(0);
    setNotifications(n => n.map(n => ({ ...n, is_read: true })));
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => { load(); setOpen(!open); }}
        className="relative flex items-center px-2 py-1 text-blue-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors">
        <Bell size={13} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[7px] font-bold leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white rounded-lg border shadow-lg z-50">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-gray-100">
            <h3 className="text-[11px] font-semibold text-gray-700">Notifications</h3>
            {unread > 0 && (
              <button onClick={handleMarkAllRead} className="text-[9px] text-blue-500 hover:text-blue-700">Mark all read</button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {notifications.length === 0 && (
              <div className="px-2.5 py-4 text-[10px] text-gray-400 text-center">No notifications</div>
            )}
            {notifications.map((n: any) => (
              <div key={n.id} className={`px-2.5 py-2 flex items-start gap-2 border-b border-gray-50 hover:bg-gray-50/50 ${n.is_read ? "" : "bg-blue-50/30"}`}>
                <div className="mt-0.5">{typeIcon(n.type)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-medium text-gray-800 truncate">{n.title}</p>
                  {n.body && <p className="text-[9px] text-gray-500 truncate">{n.body}</p>}
                </div>
                <span className="text-[8px] text-gray-400 shrink-0 mt-0.5">{timeAgo(n.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlatformDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPlatformSummary().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Loading platform overview...</div>;
  if (!data) return <div className="p-8 text-center text-red-400 text-sm">Failed to load platform data</div>;

  const cards = [
    { label: "Companies", value: data.total_companies, color: "bg-blue-500" },
    { label: "Users", value: data.total_users, color: "bg-emerald-500" },
    { label: "Admins", value: data.platform_admins, color: "bg-amber-500" },
    { label: "Today", value: data.activity_today, color: "bg-violet-500" },
  ];

  function timeAgo(ts: string) {
    if (!ts) return "";
    const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }

  function actionLabel(action: string) {
    const map: Record<string, string> = {
      create_org: "org created",
      add_member: "member added",
      remove_member: "member removed",
      update_role: "role updated",
      update_permissions: "permissions updated",
      promote_to_platform_admin: "promoted to admin",
      demote_from_platform_admin: "demoted from admin",
      upload_proof: "proof uploaded",
    };
    return map[action] || action.replace(/_/g, " ");
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
        <div className="rounded-lg border bg-gradient-to-r from-blue-600 to-indigo-700 p-3 text-white shadow-sm">
          <p className="text-blue-100 text-[9px] font-medium uppercase tracking-wider">Platform Overview</p>
          <h1 className="text-lg font-bold mt-0.5">Superuser Dashboard</h1>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-2">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg border bg-white p-2.5 shadow-sm">
              <div className="flex items-center gap-1.5 mb-1">
                <div className={`w-1.5 h-1.5 rounded-full ${c.color}`} />
                <span className="text-[10px] text-gray-500 font-medium">{c.label}</span>
              </div>
              <span className="text-xl font-bold text-gray-800">{c.value}</span>
            </div>
          ))}
        </div>

        {/* Companies + Users tables */}
        <div className="grid grid-cols-2 gap-2">
          {/* Companies */}
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="px-2.5 py-1.5 border-b border-gray-100">
              <h3 className="text-[11px] font-semibold text-gray-700">Companies ({data.companies?.length || 0})</h3>
            </div>
            <div className="overflow-y-auto max-h-[220px]">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-gray-400 uppercase tracking-wider border-b border-gray-50">
                    <th className="text-left px-2.5 py-1 font-medium">Name</th>
                    <th className="text-center px-2 py-1 font-medium">Members</th>
                    <th className="text-center px-2 py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.companies || []).map((org: any) => (
                    <tr key={org.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-2.5 py-1.5 font-medium text-gray-800">{org.name}</td>
                      <td className="text-center px-2 py-1.5 text-gray-600">{org.member_count}</td>
                      <td className="text-center px-2 py-1.5">
                        <span className={`inline-block px-1.5 py-0.5 rounded-full text-[9px] font-medium ${
                          org.status === "active"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-gray-100 text-gray-500"
                        }`}>
                          {org.status || "active"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Users */}
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="px-2.5 py-1.5 border-b border-gray-100">
              <h3 className="text-[11px] font-semibold text-gray-700">Users ({data.users?.length || 0})</h3>
            </div>
            <div className="overflow-y-auto max-h-[220px]">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-gray-400 uppercase tracking-wider border-b border-gray-50">
                    <th className="text-left px-2.5 py-1 font-medium">Name</th>
                    <th className="text-center px-2 py-1 font-medium">Orgs</th>
                    <th className="text-center px-2 py-1 font-medium">Role</th>
                    <th className="text-center px-2 py-1 font-medium">Notif</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.users || []).map((u: any) => (
                    <tr key={u.user_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-2.5 py-1.5">
                        <div className="flex items-center gap-1">
                          <span className="font-medium text-gray-800 truncate max-w-[120px]">{u.display_name || u.email || u.user_id.slice(0, 8)}</span>
                          {u.is_platform_admin && (
                            <span className="px-1 py-0.5 rounded bg-amber-100 text-amber-700 text-[8px] font-bold">PA</span>
                          )}
                        </div>
                      </td>
                      <td className="text-center px-2 py-1.5 text-gray-600">{u.orgs?.length || 0}</td>
                      <td className="text-center px-2 py-1.5">
                        {u.orgs?.slice(0, 2).map((o: any) => (
                          <span key={o.id} className={`inline-block mr-0.5 px-1 py-0.5 rounded text-[9px] font-medium ${
                            o.role === "admin" ? "bg-blue-50 text-blue-700"
                            : o.role === "manager" ? "bg-emerald-50 text-emerald-700"
                            : "bg-gray-100 text-gray-600"
                          }`}>{o.role[0]}</span>
                        ))}
                        {(u.orgs?.length || 0) > 2 && (
                          <span className="text-[9px] text-gray-400">+{u.orgs.length - 2}</span>
                        )}
                      </td>
                      <td className="text-center px-2 py-1.5">
                        <button
                          onClick={async () => {
                            await toggleUserNotifications(u.user_id, !u.notifications_enabled);
                            u.notifications_enabled = !u.notifications_enabled;
                            setData(prev => ({ ...prev }));
                          }}
                          className={`p-1 rounded transition-colors ${
                            u.notifications_enabled !== false
                              ? "text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                              : "text-gray-300 hover:text-gray-500 hover:bg-gray-100"
                          }`}
                          title={u.notifications_enabled !== false ? "Notifications on" : "Notifications off"}
                        >
                          <Bell size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="rounded-lg border bg-white shadow-sm">
          <div className="px-2.5 py-1.5 border-b border-gray-100">
            <h3 className="text-[11px] font-semibold text-gray-700">Recent Activity</h3>
          </div>
          <div className="divide-y divide-gray-50 max-h-[180px] overflow-y-auto">
            {(data.recent_activity || []).length === 0 && (
              <div className="px-2.5 py-3 text-[10px] text-gray-400 text-center">No recent activity</div>
            )}
            {(data.recent_activity || []).map((e: any, i: number) => (
              <div key={i} className="px-2.5 py-1.5 flex items-center justify-between hover:bg-gray-50/50">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-700">{actionLabel(e.action)}</span>
                  <span className="text-[9px] text-gray-400">by</span>
                  <span className="text-[9px] font-medium text-gray-500">{e.user_id?.slice(0, 8)}</span>
                  {e.org_id && <span className="text-[9px] text-gray-400">in org {e.org_id?.slice(0, 6)}</span>}
                </div>
                <span className="text-[9px] text-gray-400 shrink-0">{timeAgo(e.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardTab({ user, onNavigate }: { user: any; onNavigate: (tab: string, filter?: string) => void }) {
  const { currentOrg } = useOrg();
  const orgRole = currentOrg?.role;
  const [ds, setDs] = useState<any>(null);
  const [docTypeStats, setDocTypeStats] = useState<Record<string, number>>({});
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [forensicSummary, setForensicSummary] = useState<any>(null);

  useEffect(() => { loadStats(); }, [dateFrom, dateTo, currentOrg?.id]);

  function dateParams() {
    const p = new URLSearchParams({ page: "1", page_size: "1" });
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    return p.toString();
  }

  async function loadStats() {
    try {
      const [dashData, fs, ...dtRes] = await Promise.all([
        fetch(`${API}/api/dashboard/stats`, { headers: headers() }).then(r => r.json()),
        fetch(`${API}/api/forensic/summary`, { headers: headers() }).then(r => r.json()).catch(() => null),
        ...["receipt","invoice","payment_proof","id","passport","driving_license","birth_certificate","other","unclassified"].map(
          dt => fetch(`${API}/api/proofs?document_type=${dt}&${dateParams()}`, { headers: headers() }).then(r => r.json())
        ),
      ]);
      setDs(dashData);
      setForensicSummary(fs);
      const dtLabels = ["receipt","invoice","payment_proof","id","passport","driving_license","birth_certificate","other","unclassified"];
      const dtMap: Record<string, number> = {};
      dtRes.forEach((d, i) => { if (d.total > 0) dtMap[dtLabels[i]] = d.total; });
      setDocTypeStats(dtMap);
    } catch (_) {}
  }

  const p = ds?.proofs || { total: 0, completed_pct: 0, by_status: {} };
  const r = ds?.receipts || { total: 0, reviewed_pct: 0, needing_review: 0, by_status: {} };
  const rec = ds?.reconciliation || { total: 0, fraud_pct: 0, fraud_count: 0, by_classification: {} };
  const audit = ds?.audit || { receipts_with_audit: 0, receipts_without_audit: 0, coverage_pct: 0 };
  const hi = ds?.human_intervention || { receipts_needing_review: 0, unmatched_proofs: 0, potential_fraud: 0, forensic_required: 0, total_pending: 0 };
  const fs = forensicSummary || { total_flags: 0, high_risk: 0, by_type: {} };

  // Org admin sees Salesforce-style dashboard; manager/viewer/staff see stats
  if (orgRole === "admin") return <OrgAdminDashboard user={user} />;

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Date filter row */}
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <span>From</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="rounded border border-gray-300 px-1.5 py-1 text-[10px] w-28 focus:border-blue-500 outline-none" />
          <span>—</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="rounded border border-gray-300 px-1.5 py-1 text-[10px] w-28 focus:border-blue-500 outline-none" />
        </div>
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); }}
            className="text-[10px] text-gray-400 hover:text-red-500 px-1.5 py-1 border rounded">Clear</button>
        )}
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
        {/* Top stat cards */}
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Total Proofs", value: p.total, icon: FileText, color: "text-blue-600 bg-blue-50", tab: "Proofs" as Tab, filter: "" },
            { label: "Total Receipts", value: r.total, icon: Receipt, color: "text-purple-600 bg-purple-50", tab: "Receipts" as Tab, filter: "" },
            { label: "Needs Review", value: r.needing_review, icon: AlertTriangle, color: "text-orange-600 bg-orange-50", tab: "Receipts" as Tab, filter: "review_needed" },
            { label: "Pending Human", value: hi.total_pending, icon: UserCheck, color: "text-red-600 bg-red-50", tab: "Receipts" as Tab, filter: "review_needed" },
          ].map((s) => (
            <button key={s.label} onClick={() => s.tab && onNavigate(s.tab, s.filter)}
              className="rounded-lg border bg-white p-3 flex items-center gap-3 cursor-pointer hover:shadow-sm hover:-translate-y-0.5 transition-all text-left">
              <div className={`rounded-lg p-2 ${s.color}`}><s.icon size={18} /></div>
              <div><div className="text-lg font-bold">{s.value}</div><div className="text-[10px] text-gray-500">{s.label}</div></div>
            </button>
          ))}
        </div>

        {/* Middle row: Completion + Fraud + Audit */}
        <div className="grid gap-2 sm:grid-cols-3">
          {/* Completion progress */}
          <div className="rounded-lg border bg-white p-3">
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-[11px] font-semibold text-gray-600 flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> Completion</h4>
              <span className="text-[10px] text-gray-400">{p.total} proofs</span>
            </div>
            <MiniBar value={p.completed_pct} label="Processed" color="bg-green-500" />
            <MiniBar value={r.reviewed_pct} label="Reviewed" color="bg-purple-500" />
          </div>

          {/* Fraud Detection */}
          <div className="rounded-lg border bg-white p-3">
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-[11px] font-semibold text-gray-600 flex items-center gap-1"><Shield size={12} className="text-red-500" /> Fraud</h4>
              <span className="text-[10px] text-gray-400">{rec.total} matched</span>
            </div>
            {rec.total > 0 ? (
              <div className="space-y-1">
                {[
                  { key: "correct", label: "Correct", color: "bg-green-500", count: rec.by_classification?.correct || 0 },
                  { key: "minor_mistake", label: "Minor", color: "bg-yellow-400", count: rec.by_classification?.minor_mistake || 0 },
                  { key: "potential_fraud", label: "Fraud", color: "bg-orange-500", count: rec.by_classification?.potential_fraud || 0 },
                  { key: "forensic_required", label: "Forensic", color: "bg-red-500", count: rec.by_classification?.forensic_required || 0 },
                  { key: "fraud_detected", label: "Detected", color: "bg-red-700", count: rec.by_classification?.fraud_detected || 0 },
                ].filter(x => x.count > 0).map(({ key, label, color, count }) => (
                  <button key={key} onClick={() => onNavigate("Reconciliation", key)}
                    className="w-full flex items-center gap-1.5 text-[10px] cursor-pointer hover:opacity-80">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />
                    <span className="flex-1 text-gray-500">{label}</span>
                    <span className="font-medium text-gray-700">{count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-gray-400">Run reconciliation</p>
            )}
          </div>

          {/* Audit Coverage */}
          <div className="rounded-lg border bg-white p-3">
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-[11px] font-semibold text-gray-600 flex items-center gap-1"><History size={12} className="text-indigo-500" /> Audit</h4>
              <span className="text-[10px] text-gray-400">{r.total} receipts</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${audit.coverage_pct}%` }} />
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-gray-400">
              <span>{audit.receipts_with_audit} covered</span>
              <span className="font-semibold text-indigo-600">{audit.coverage_pct}%</span>
            </div>
          </div>
        </div>

        {/* Human Intervention Alert */}
        {hi.total_pending > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <UserCheck size={14} className="text-red-500 shrink-0" />
              <span className="text-[11px] font-semibold text-red-700">{hi.total_pending} items need review</span>
              <button onClick={() => onNavigate("Receipts", "review_needed")} className="ml-auto text-[10px] text-red-600 underline">View all</button>
            </div>
            <div className="flex gap-2">
              {[
                { label: "Receipts", value: hi.receipts_needing_review, tab: "Receipts", filter: "review_needed" },
                { label: "Potential Fraud", value: hi.potential_fraud, tab: "Reconciliation", filter: "potential_fraud" },
                { label: "Forensic", value: hi.forensic_required, tab: "Reconciliation", filter: "forensic_required" },
              ].filter(x => x.value > 0).map(x => (
                <button key={x.label} onClick={() => onNavigate(x.tab, x.filter)}
                  className="text-[10px] bg-white/80 rounded-lg px-2.5 py-1.5 border border-red-100 hover:bg-red-50 cursor-pointer flex items-center gap-1">
                  <span className="font-semibold text-red-600">{x.value}</span>
                  <span className="text-gray-500">{x.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Forensic Summary */}
        {fs.total_flags > 0 && (
          <div className="rounded-lg border bg-gradient-to-r from-indigo-50 to-violet-50 p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Shield size={14} className="text-indigo-500 shrink-0" />
              <span className="text-[11px] font-semibold text-indigo-800">{fs.total_flags} forensic flags</span>
              <button onClick={() => onNavigate("Forensic")} className="ml-auto text-[10px] text-indigo-600 underline">Details</button>
            </div>
            <div className="flex gap-2">
              {[
                { label: "Benford", value: fs.by_type?.benford || 0 },
                { label: "Duplicates", value: fs.by_type?.duplicate || 0 },
                { label: "Anomalies", value: fs.by_type?.anomaly || 0 },
              ].filter(s => s.value > 0).map(s => (
                <span key={s.label} className="text-[10px] bg-white/70 rounded px-2 py-0.5 text-gray-600">{s.label}: {s.value}</span>
              ))}
              {fs.high_risk > 0 && (
                <span className="text-[10px] text-red-600 bg-red-50 rounded px-2 py-0.5 flex items-center gap-1">
                  <AlertTriangle size={10} /> {fs.high_risk} high-risk
                </span>
              )}
            </div>
          </div>
        )}

        {/* Doc type chips */}
        {Object.keys(docTypeStats).length > 0 && (
          <div className="rounded-lg border bg-white p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <FileText size={12} className="text-gray-400" />
              <span className="text-[11px] font-semibold text-gray-600">Documents</span>
              <span className="ml-auto text-[10px] text-gray-400">{Object.values(docTypeStats).reduce((a, b) => a + b, 0)} total</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(docTypeStats).map(([dt, count]) => (
                <button key={dt} onClick={() => onNavigate("Proofs", dt)}
                  className="rounded-full px-2 py-0.5 text-[10px] cursor-pointer hover:shadow-sm transition-all bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100">
                  {dt.replace(/_/g, " ")} {count}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-xs text-gray-500 w-20 shrink-0">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-700 w-12 text-right">{value}%</span>
    </div>
  );
}

function MiniBar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-[10px] text-gray-400 w-14 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-[10px] font-medium text-gray-600 w-8 text-right">{value}%</span>
    </div>
  );
}

/* ========== FORENSIC TAB ========== */
function ForensicTab() {
  const [benford, setBenford] = useState<any>(null);
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [narrativeFlags, setNarrativeFlags] = useState<any[]>([]);
  const [narrativeTotal, setNarrativeTotal] = useState(0);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<any>({ status: "idle", progress: 0, current_step: "", message: "" });
  const [activeSection, setActiveSection] = useState<string>("benford");
  const [dupPage, setDupPage] = useState(1);
  const [dupTotal, setDupTotal] = useState(0);
  const [anomPage, setAnomPage] = useState(1);
  const [anomTotal, setAnomTotal] = useState(0);
  const [runs, setRuns] = useState<any[]>([]);
  const pollRef = useRef<any>(null);

  useEffect(() => {
    loadData();
    loadRuns();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [sum, ben, dupRes, anomRes, narRes] = await Promise.all([
        fetch(`${API}/api/forensic/summary`, { headers: headers() }).then(r => r.json()),
        fetch(`${API}/api/forensic/benford`, { headers: headers() }).then(r => r.json()),
        fetch(`${API}/api/forensic/duplicates?page=1&page_size=50`, { headers: headers() }).then(r => r.json()),
        fetch(`${API}/api/forensic/anomalies?page=1&page_size=50`, { headers: headers() }).then(r => r.json()),
        fetch(`${API}/api/forensic/flags?analysis_type=narrative&page=1&page_size=50`, { headers: headers() }).then(r => r.json()).catch(() => ({ items: [], total: 0 })),
      ]);
      setSummary(sum);
      setBenford(ben);
      setDuplicates(dupRes.items || []);
      setDupTotal(dupRes.total_groups || 0);
      setAnomalies(anomRes.items || []);
      setAnomTotal(anomRes.total || 0);
      setNarrativeFlags(narRes.items || []);
      setNarrativeTotal(narRes.total || 0);
    } catch (_) {}
    setLoading(false);
  }

  function loadRuns() {
    fetch(`${API}/api/forensic/runs?page=1&page_size=5`, { headers: headers() }).then(r => r.json()).then(d => {
      setRuns(d.items || []);
    }).catch(() => {});
  }

  function startPolling() {
    let failCount = 0;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/forensic/progress`, { headers: headers() });
        if (!res.ok) {
          failCount++;
          if (failCount >= 3) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setRunning(false);
            setProgress({ status: "failed", progress: 0, current_step: "Connection lost", message: `HTTP ${res.status}` });
          }
          return;
        }
        failCount = 0;
        const p = await res.json();
        setProgress(p);
        if (p.status === "completed" || p.status === "failed" || p.status === "cancelled") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setRunning(false);
          if (p.status !== "cancelled") {
            loadData();
            loadRuns();
          }
        }
      } catch (_) {
        failCount++;
        if (failCount >= 3) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setRunning(false);
          setProgress({ status: "failed", progress: 0, current_step: "Connection lost", message: "Network error" });
        }
      }
    }, 1000);
  }

  async function handleRun() {
    setRunning(true);
    setProgress({ status: "running", progress: 0, current_step: "Starting...", message: "" });
    try {
      const res = await fetch(`${API}/api/forensic/run`, { method: "POST", headers: headers() });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(errBody.detail || `HTTP ${res.status}`);
      }
      startPolling();
    } catch (e: any) {
      setRunning(false);
      setProgress({ status: "failed", progress: 0, current_step: "Failed to start", message: e.message });
    }
  }

  async function handleCancel() {
    try {
      await fetch(`${API}/api/forensic/cancel`, { method: "POST", headers: headers() });
    } catch (_) {}
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setRunning(false);
    setProgress({ status: "idle", progress: 0, current_step: "", message: "" });
  }

  function loadMoreAnomalies(page: number) {
    setAnomPage(page);
    fetch(`${API}/api/forensic/anomalies?page=${page}&page_size=50`, { headers: headers() }).then(r => r.json()).then(d => {
      setAnomalies(d.items || []);
      setAnomTotal(d.total || 0);
    }).catch(() => {});
  }

  function loadMoreDuplicates(page: number) {
    setDupPage(page);
    fetch(`${API}/api/forensic/duplicates?page=${page}&page_size=50`, { headers: headers() }).then(r => r.json()).then(d => {
      setDuplicates(d.items || []);
      setDupTotal(d.total_groups || 0);
    }).catch(() => {});
  }

  const isRunning = running || progress.status === "running";

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0 mb-2">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-indigo-600" />
          <div>
            <h2 className="text-sm font-bold">Forensic Analysis</h2>
            <p className="text-[10px] text-gray-400">Benford's Law &middot; Duplicates &middot; Anomalies &middot; LLM</p>
          </div>
        </div>
        <button onClick={handleRun} disabled={isRunning}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-[11px] font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all">
          {isRunning ? (
            <><Loader2 size={12} className="animate-spin" /> Running...</>
          ) : (
            <><Play size={12} /> Run Analysis</>
          )}
        </button>
      </div>

      {/* Full-screen processing overlay */}
      {isRunning && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" style={{ backdropFilter: "blur(4px)" }}>
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4">
            <div className="text-center mb-6">
              <div className="relative inline-block mb-4">
                <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="34" fill="none" stroke="#e5e7eb" strokeWidth="5" />
                  <circle cx="40" cy="40" r="34" fill="none" stroke="url(#forensicGrad)" strokeWidth="5"
                    strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 34}`}
                    strokeDashoffset={`${2 * Math.PI * 34 * (1 - progress.progress / 100)}`}
                    className="transition-all duration-700 ease-out" />
                  <defs>
                    <linearGradient id="forensicGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#a855f7" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 size={28} className="text-indigo-500 animate-spin" />
                </div>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">Forensic Analysis</h3>
              <p className="text-sm text-gray-500">{progress.current_step || "Initializing..."}</p>
              {progress.message && <p className="text-xs text-gray-400 mt-1">{progress.message}</p>}
              <div className="mt-4">
                <div className="text-3xl font-bold text-indigo-600">{Math.round(progress.progress)}%</div>
                <div className="text-xs text-gray-400 mt-0.5">complete</div>
              </div>
            </div>
            <div className="mb-6">
              <div className="flex items-center gap-1">
                {["Fetching", "Benford", "Duplicates", "Anomalies", "LLM"].map((step, i) => {
                  const steps = ["Fetching", "Benford", "Duplicates", "Anomalies", "LLM"];
                  const idx = steps.findIndex(s => progress.current_step?.toLowerCase().includes(s.toLowerCase()));
                  const isActive = step === steps[idx];
                  const isDone = idx > i;
                  return (
                    <div key={step} className="flex-1 flex items-center gap-1">
                      <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all ${
                        isDone ? "bg-indigo-500 text-white" :
                        isActive ? "bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300" :
                        "bg-gray-100 text-gray-400"
                      }`}>
                        {isDone ? <Check size={14} /> : i + 1}
                      </div>
                      {i < 4 && <div className={`flex-1 h-0.5 rounded ${isDone ? "bg-indigo-400" : "bg-gray-200"}`} />}
                    </div>
                  );
                })}
              </div>
              <div className="flex text-[10px] text-gray-400 mt-1 px-0.5">
                {["Receipts", "Benford", "Duplicates", "Anomalies", "LLM"].map((l, i) => (
                  <div key={l} className={`flex-1 ${i === 0 ? "text-left" : i === 4 ? "text-right" : "text-center"}`}>{l}</div>
                ))}
              </div>
            </div>
            <button onClick={handleCancel}
              className="w-full rounded-xl border-2 border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 transition-all flex items-center justify-center gap-2">
              <XCircle size={16} /> Cancel Analysis
            </button>
          </div>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
        {/* Summary Cards */}
        {summary && !isRunning && (
          <div className="grid gap-2 grid-cols-4">
            {[
              { label: "Total Flags", value: summary.total_flags, color: "text-indigo-600 bg-indigo-50", icon: Shield },
              { label: "Benford", value: summary.by_type?.benford || 0, color: "text-blue-600 bg-blue-50", icon: BarChart3 },
              { label: "Duplicates", value: summary.by_type?.duplicate || 0, color: "text-orange-600 bg-orange-50", icon: Copy },
              { label: "LLM Findings", value: (summary.by_type?.narrative || 0) + (summary.by_type?.pattern || 0) + (summary.by_type?.contextual || 0), color: "text-purple-600 bg-purple-50", icon: Search },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border bg-white p-2.5 flex items-center gap-2.5 shadow-sm">
                <div className={`rounded-lg p-1.5 ${s.color}`}><s.icon size={14} /></div>
                <div><div className="text-sm font-bold">{s.value}</div><div className="text-[10px] text-gray-500">{s.label}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* Section Tabs */}
        {!isRunning && summary && summary.total_flags > 0 && (
          <div className="flex gap-1 flex-wrap shrink-0">
            {[
              { key: "benford", label: "Benford's Law", count: summary.by_type?.benford || 0 },
              { key: "duplicates", label: "Duplicates", count: summary.by_type?.duplicate || 0 },
              { key: "anomalies", label: "Anomalies", count: summary.by_type?.anomaly || 0 },
              { key: "narrative", label: "LLM Analysis", count: narrativeTotal },
            ].map((s) => (
              <button key={s.key} onClick={() => setActiveSection(s.key)}
                className={`rounded px-2.5 py-1 text-[10px] font-medium transition-all ${
                  activeSection === s.key ? "bg-indigo-600 text-white shadow-sm" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}>
                {s.label} {s.count > 0 && <span className="ml-0.5 opacity-70">({s.count})</span>}
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !isRunning && summary?.total_flags === 0 && (
          <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
            <Shield size={28} className="mx-auto text-gray-300 mb-2" />
            <p className="text-xs font-medium text-gray-600 mb-0.5">No forensic flags yet</p>
            <p className="text-[10px] text-gray-400 mb-3">Run analysis to detect anomalies, duplicates, and Benford's Law violations</p>
            <button onClick={handleRun} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3.5 py-1.5 text-[11px] font-medium hover:bg-indigo-700 shadow-sm transition-all">
              <Play size={11} /> Run Analysis
            </button>
          </div>
        )}

        {/* Benford's Law */}
        {!loading && activeSection === "benford" && benford?.items?.length > 0 && (
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-semibold text-gray-600">Benford's Law — First Digit Distribution</h3>
              {benford.items[0]?.details && (
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                  Math.abs((benford.items[0]?.details?.deviation_pct || 0)) > 50 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
                }`}>
                  Deviation: {benford.items[0]?.details?.deviation_pct?.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="space-y-1">
              {[1,2,3,4,5,6,7,8,9].map(d => {
                const expected = 100 * Math.log10(1 + 1/d);
                const obsItems = benford.items.filter((i: any) => i.details?.digit === d);
                const observed = obsItems.length > 0 ? obsItems[0].details?.observed_pct || 0 : expected;
                const isFlagged = obsItems.length > 0;
                const deviation = observed - expected;
                return (
                  <div key={d} className={`rounded px-2.5 py-1.5 ${isFlagged ? "bg-red-50/50 border border-red-100" : "bg-gray-50"}`}>
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-gray-600 w-6">d={d}</span>
                        <span className="text-[9px] text-gray-400">Benford: {expected.toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500">Observed: <strong className={isFlagged ? "text-red-600" : "text-gray-700"}>{observed.toFixed(1)}%</strong></span>
                        {isFlagged && <span className="text-[9px] font-medium text-red-600">{deviation > 0 ? "+" : ""}{deviation.toFixed(1)}%</span>}
                      </div>
                    </div>
                    <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden relative">
                      <div className="absolute inset-0 flex">
                        <div className="h-full bg-blue-400/30" style={{ width: `${Math.min(expected, 100)}%` }} />
                      </div>
                      <div className={`h-full rounded-full transition-all ${isFlagged ? "bg-red-500" : "bg-indigo-500"}`}
                        style={{ width: `${Math.min(observed, 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Duplicates */}
        {!loading && activeSection === "duplicates" && duplicates.length > 0 && (
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <h3 className="text-[11px] font-semibold text-gray-600">Duplicate Payment Groups</h3>
              <span className="text-[10px] text-gray-400">{dupTotal} groups</span>
            </div>
            <div className="divide-y">
              {duplicates.map((g: any) => (
                <div key={g.group_id} className="p-2.5 hover:bg-gray-50">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="rounded bg-orange-100 text-orange-700 px-1.5 py-0.5 text-[9px] font-medium">{g.size} receipts</span>
                    <span className="text-[9px] text-gray-400 font-mono">{(g.group_id || "").slice(0, 8)}</span>
                  </div>
                  <div className="space-y-1">
                    {g.members?.map((m: any) => (
                      <div key={m.id} className="flex items-center gap-2 text-[10px] bg-gray-50 rounded px-2 py-1.5">
                        <div className="w-1 h-1 rounded-full bg-orange-400 shrink-0" />
                        <span className="font-medium text-gray-600 w-16 truncate">{m.receipt?.receipt_number || "—"}</span>
                        <span className="text-gray-500 w-20 truncate">{m.receipt?.payer_name || "—"}</span>
                        <span className="font-semibold text-gray-700 w-16">{m.receipt?.amount != null ? Number(m.receipt.amount).toLocaleString() : "—"}</span>
                        <span className="text-gray-400">{m.receipt?.payment_date || "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {dupTotal > 50 && (
              <div className="flex items-center justify-center gap-2 p-2 border-t">
                <button disabled={dupPage <= 1} onClick={() => loadMoreDuplicates(dupPage - 1)}
                  className="text-[10px] px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-30">Prev</button>
                <span className="text-[10px] text-gray-400">{dupPage} / {Math.ceil(dupTotal / 50)}</span>
                <button disabled={dupPage >= Math.ceil(dupTotal / 50)} onClick={() => loadMoreDuplicates(dupPage + 1)}
                  className="text-[10px] px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-30">Next</button>
              </div>
            )}
          </div>
        )}

        {/* Anomalies */}
        {!loading && activeSection === "anomalies" && anomalies.length > 0 && (
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <h3 className="text-[11px] font-semibold text-gray-600">Anomaly Scored Receipts</h3>
              <span className="text-[10px] text-gray-400">{anomTotal} flags</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-gray-500 font-medium">
                    <th className="px-3 py-2">Risk</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Receipt #</th>
                    <th className="px-3 py-2">Payer</th>
                    <th className="px-3 py-2">Amount</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((a: any) => {
                    const score = a.score || 0;
                    const riskColor = score >= 0.8 ? "bg-red-100 text-red-700" : score >= 0.5 ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-700";
                    return (
                      <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <div className={`w-1.5 h-1.5 rounded-full ${score >= 0.8 ? "bg-red-500" : score >= 0.5 ? "bg-orange-500" : "bg-yellow-500"}`} />
                            <span className={`text-[9px] font-medium px-1 py-0.5 rounded-full ${riskColor}`}>{score >= 0.8 ? "High" : score >= 0.5 ? "Med" : "Low"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-12 h-1 rounded-full bg-gray-100">
                              <div className={`h-full rounded-full ${score >= 0.8 ? "bg-red-500" : score >= 0.5 ? "bg-orange-500" : "bg-yellow-500"}`} style={{ width: `${score * 100}%` }} />
                            </div>
                            <span className="text-gray-600 w-6">{(score * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-700">{a.receipt?.receipt_number || "—"}</td>
                        <td className="px-3 py-2 text-gray-500 max-w-[100px] truncate">{a.receipt?.payer_name || "—"}</td>
                        <td className="px-3 py-2 font-semibold text-gray-700">{a.receipt?.amount != null ? Number(a.receipt.amount).toLocaleString() : "—"}</td>
                        <td className="px-3 py-2 text-gray-400">{a.receipt?.payment_date || "—"}</td>
                        <td className="px-3 py-2 max-w-[140px] truncate text-gray-400" title={a.flag}>{a.flag || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {anomTotal > 50 && (
              <div className="flex items-center justify-center gap-2 p-2 border-t">
                <button disabled={anomPage <= 1} onClick={() => loadMoreAnomalies(anomPage - 1)}
                  className="text-[10px] px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-30">Prev</button>
                <span className="text-[10px] text-gray-400">{anomPage} / {Math.ceil(anomTotal / 50)}</span>
                <button disabled={anomPage >= Math.ceil(anomTotal / 50)} onClick={() => loadMoreAnomalies(anomPage + 1)}
                  className="text-[10px] px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-30">Next</button>
              </div>
            )}
          </div>
        )}

        {/* LLM Narrative Analysis */}
        {!loading && activeSection === "narrative" && narrativeFlags.length > 0 && (
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <h3 className="text-[11px] font-semibold text-gray-600">LLM Forensic Findings</h3>
              <span className="text-[10px] text-gray-400">{narrativeTotal} findings</span>
            </div>
            <div className="divide-y">
              {narrativeFlags.map((f: any) => {
                const score = f.score || 0;
                const riskColor = score >= 0.7 ? "bg-red-100 text-red-700" : score >= 0.4 ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-700";
                return (
                  <div key={f.id} className="p-2.5 hover:bg-gray-50">
                    <div className="flex items-start gap-2">
                      <div className={`mt-0.5 rounded-full p-1 shrink-0 ${score >= 0.7 ? "bg-red-50 text-red-500" : score >= 0.4 ? "bg-orange-50 text-orange-500" : "bg-yellow-50 text-yellow-500"}`}>
                        <Search size={10} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-[9px] font-medium px-1 py-0.5 rounded-full ${riskColor}`}>{(score * 100).toFixed(0)}% risk</span>
                          <span className="text-[9px] text-gray-400 uppercase">{f.analysis_type}</span>
                        </div>
                        <p className="text-[11px] font-medium text-gray-700 mb-0.5">{f.flag}</p>
                        {f.details?.explanation && <p className="text-[10px] text-gray-500">{f.details.explanation}</p>}
                        <div className="flex items-center gap-2 mt-1 text-[9px] text-gray-400">
                          {f.receipt?.receipt_number && <span>#{f.receipt.receipt_number}</span>}
                          {f.receipt?.payer_name && <span>{f.receipt.payer_name}</span>}
                          {f.receipt?.amount != null && <span>{Number(f.receipt.amount).toLocaleString()}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Runs */}
        {runs.length > 0 && !isRunning && (
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <h4 className="text-[11px] font-semibold text-gray-600 mb-1.5">Recent Runs</h4>
            <div className="space-y-1">
              {runs.map((r: any) => (
                <div key={r.id} className="flex items-center gap-2 text-[10px] bg-gray-50 rounded px-2.5 py-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${r.status === "completed" ? "bg-green-500" : r.status === "failed" ? "bg-red-500" : "bg-yellow-500"}`} />
                  <span className="text-gray-500 capitalize">{r.status}</span>
                  {r.results?.total_flags != null && <span className="text-gray-400">{r.results.total_flags} flags</span>}
                  {r.results?.total_receipts != null && <span className="text-gray-400">&middot; {r.results.total_receipts} receipts</span>}
                  <span className="text-gray-400 ml-auto">{(r.completed_at || r.started_at) ? new Date(r.completed_at || r.started_at).toLocaleString() : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && !isRunning && (
          <div className="text-center py-6 text-xs text-gray-500">
            <Loader2 size={14} className="animate-spin inline mr-1" /> Loading...
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== PROOFS TAB ========== */
function ProofsTab({ initialFilter = "" }: { initialFilter?: string }) {
  const [proofs, setProofs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(initialFilter);
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Record<string, any>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadProofs(); }, [filter, docTypeFilter, dateFrom, dateTo]);

  async function loadProofs() {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: "1", page_size: "100" });
      if (filter) p.set("status", filter);
      if (docTypeFilter) p.set("document_type", docTypeFilter);
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
      const res = await fetch(`${API}/api/proofs?${p}`, { headers: headers() });
      const d = await res.json();
      setProofs(d.items || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  async function toggleExpand(proofId: string) {
    if (expandedId === proofId) { setExpandedId(null); return; }
    setExpandedId(proofId);
    if (!receipts[proofId]) {
      try {
        const res = await fetch(`${API}/api/receipts?page=1&page_size=100`, { headers: headers() });
        const d = await res.json();
        const match = (d.items || []).find((r: any) => r.proof_id === proofId);
        if (match) {
          setReceipts(prev => ({ ...prev, [proofId]: match }));
          setForm({
            amount: match.amount ?? "", currency: match.currency ?? "USD",
            payer_name: match.payer_name ?? "", bank_issuer: match.bank_issuer ?? "",
            receipt_number: match.receipt_number ?? "", payment_date: match.payment_date ?? "",
            description: match.description ?? "",
            purchase_currency: match.purchase_currency ?? "",
            transaction_currency: match.transaction_currency ?? "",
            transaction_amount: match.transaction_amount ?? "",
            card_number: match.card_number ?? "", card_type: match.card_type ?? "",
            payee: match.payee ?? "", address: match.address ?? "",
          });
        }
      } catch (_) {}
    }
  }

  async function handleSave(receiptId: string, proofId: string) {
    setSaving(true);
    try {
      const updated = await updateReceipt(receiptId, { ...form, status: "reviewed" });
      setReceipts(prev => ({ ...prev, [proofId]: updated }));
      setEditing(null);
      loadProofs();
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  }

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-700", processing: "bg-blue-50 text-blue-700",
    completed: "bg-green-50 text-green-700", review_needed: "bg-orange-50 text-orange-700",
    failed: "bg-red-50 text-red-700", ready_to_process: "bg-emerald-50 text-emerald-700",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Proofs</h2>
        <button onClick={loadProofs} className="text-sm text-gray-500 hover:text-blue-600"><RefreshCw size={14} className="inline mr-1" /> Refresh</button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-2 flex-wrap items-center">
        <div className="flex items-center gap-1.5">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 outline-none" title="From date" />
          <span className="text-xs text-gray-400">—</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 outline-none" title="To date" />
        </div>
        <select value={docTypeFilter} onChange={e => setDocTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 outline-none bg-white">
          <option value="">All Types</option>
          <option value="receipt">Receipt</option>
          <option value="invoice">Invoice</option>
          <option value="payment_proof">Payment Proof</option>
          <option value="id">ID</option>
          <option value="passport">Passport</option>
          <option value="driving_license">Driving License</option>
          <option value="birth_certificate">Birth Certificate</option>
          <option value="other">Other</option>
          <option value="unclassified">Unclassified</option>
        </select>
        {["", "pending", "completed", "review_needed", "ready_to_process", "failed"].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs ${filter === s ? "bg-blue-600 text-white" : "bg-white border text-gray-600 hover:bg-gray-50"}`}>
            {s ? s.replace(/_/g, " ") : "All"}
          </button>
        ))}
        {(dateFrom || dateTo || filter || docTypeFilter) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); setFilter(""); setDocTypeFilter(""); }}
            className="text-xs text-gray-500 hover:text-red-600 px-2 py-1.5 border rounded-lg">Clear</button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{proofs.length} proofs</span>
      </div>

      {/* Table */}
      {loading ? <div className="text-center py-8 text-sm text-gray-500"><Loader2 size={16} className="animate-spin inline mr-2" />Loading...</div>
      : proofs.length === 0 ? <div className="text-center py-8 text-sm text-gray-500">No proofs found.</div>
      : (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-gray-500 font-medium">
                <th className="px-3 py-2.5 whitespace-nowrap">File Name</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Type</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Method</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Status</th>
                <th className="px-3 py-2.5 whitespace-nowrap">ERP</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Date</th>
                <th className="px-3 py-2.5 whitespace-nowrap w-10 text-center">Expand</th>
              </tr>
            </thead>
            <tbody>
              {proofs.map((p) => {
                const isOpen = expandedId === p.id;
                const receipt = receipts[p.id];
                return (
                  <Fragment key={p.id}>
                    <tr className={`border-b hover:bg-gray-50 transition-colors cursor-pointer ${isOpen ? "bg-blue-50/30" : ""}`} onClick={() => toggleExpand(p.id)}>
                      <td className="px-3 py-2.5 font-medium text-gray-800 max-w-[200px] truncate" title={p.file_name}>{p.file_name}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          ["receipt","invoice","payment_proof"].includes(p.document_type)
                            ? "bg-blue-50 text-blue-700"
                            : p.document_type && p.document_type !== "unclassified"
                            ? "bg-gray-100 text-gray-600"
                            : "bg-gray-50 text-gray-400"
                        }`}>
                          {p.document_type ? p.document_type.replace(/_/g, " ") : "unclassified"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">{p.processing_method ? p.processing_method.replace(/_/g, " ") : "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusColors[p.status] || "bg-gray-100 text-gray-600"}`}>
                          {p.status?.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${p.erp_status === "synced" ? "bg-green-50 text-green-700" : "bg-gray-50 text-gray-500"}`}>
                          {p.erp_status || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">{p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-center text-gray-400">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50">
                        <td colSpan={7} className="px-5 py-4 border-b">
                          {receipt ? (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Receipt size={14} /> Receipt</h4>
                                {receipt.status === "review_needed" && editing !== receipt.id && (
                                  <button onClick={(e) => { e.stopPropagation(); setEditing(receipt.id); setForm({
                                    amount: receipt.amount ?? "", currency: receipt.currency ?? "USD",
                                    payer_name: receipt.payer_name ?? "", bank_issuer: receipt.bank_issuer ?? "",
                                    receipt_number: receipt.receipt_number ?? "", payment_date: receipt.payment_date ?? "",
                                    description: receipt.description ?? "",
                                    purchase_currency: receipt.purchase_currency ?? "",
                                    transaction_currency: receipt.transaction_currency ?? "",
                                    card_number: receipt.card_number ?? "", card_type: receipt.card_type ?? "",
                                    payee: receipt.payee ?? "", address: receipt.address ?? "",
                                  }); }} className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 bg-orange-50 px-2.5 py-1 rounded-lg border border-orange-200">
                                    <Edit3 size={12} /> Review & Edit
                                  </button>
                                )}
                                {receipt.status === "reviewed" && <span className="text-xs text-green-600 font-medium flex items-center gap-1"><CheckCircle size={12} /> Reviewed</span>}
                              </div>

                              {editing === receipt.id ? (
                                <div className="grid grid-cols-2 gap-3" onClick={(e) => e.stopPropagation()}>
                                  {[
                                    { label: "Amount", key: "amount" }, { label: "Currency", key: "currency" },
                                    { label: "Payer Name", key: "payer_name" }, { label: "Bank Issuer", key: "bank_issuer" },
                                    { label: "Receipt #", key: "receipt_number" }, { label: "Payment Date", key: "payment_date" },
                                    { label: "Description", key: "description" },
                                    { label: "Purchase Currency", key: "purchase_currency" },
                                    { label: "Transaction Currency", key: "transaction_currency" },
                                    { label: "Transaction Amount", key: "transaction_amount" },
                                    { label: "Card Number", key: "card_number" }, { label: "Card Type", key: "card_type" },
                                    { label: "Payee", key: "payee" }, { label: "Address", key: "address" },
                                  ].map((f) => (
                                    <div key={f.key}>
                                      <label className="block text-xs text-gray-500 mb-0.5">{f.label}</label>
                                      <input type="text" value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                                        className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 outline-none" />
                                    </div>
                                  ))}
                                  <div className="col-span-2 flex gap-2 pt-1">
                                    <button onClick={() => setEditing(null)} className="text-xs text-gray-500 px-3 py-1.5 border rounded-lg hover:bg-gray-50">Cancel</button>
                                    <button onClick={() => handleSave(receipt.id, p.id)} disabled={saving}
                                      className="flex items-center gap-1 text-xs text-white bg-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                                      {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                      {saving ? "Saving..." : "Save & Mark Reviewed"}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm" onClick={(e) => e.stopPropagation()}>
                                  {receipt.amount != null && <span className="flex items-center gap-1 font-semibold"><DollarSign size={14} className="text-green-600" /> {Number(receipt.amount).toFixed(2)} {receipt.currency}</span>}
                                  {receipt.payer_name && <span className="flex items-center gap-1 text-gray-600"><User size={13} /> {receipt.payer_name}</span>}
                                  {receipt.bank_issuer && <span className="flex items-center gap-1 text-gray-600"><Building2 size={13} /> {receipt.bank_issuer}</span>}
                                  {receipt.receipt_number && <span className="flex items-center gap-1 text-gray-600"><Hash size={13} /> {receipt.receipt_number}</span>}
                                  {receipt.payment_date && <span className="flex items-center gap-1 text-gray-600"><Calendar size={13} /> {receipt.payment_date}</span>}
                                  {receipt.description && <span className="flex items-center gap-1 text-gray-600 truncate max-w-[200px]"><FileText size={13} /> {receipt.description}</span>}
                                  {receipt.confidence_score != null && (
                                    <span className={`flex items-center gap-1 text-xs font-medium ${receipt.confidence_score >= 0.85 ? "text-green-600" : receipt.confidence_score >= 0.5 ? "text-yellow-600" : "text-red-600"}`}>
                                      <Shield size={12} /> {Math.round(receipt.confidence_score * 100)}%
                                    </span>
                                  )}
                                  {receipt.purchase_currency && <span className="flex items-center gap-1 text-gray-600"><DollarSign size={13} /> Purchase: {receipt.purchase_currency}</span>}
                                  {receipt.transaction_currency && <span className="flex items-center gap-1 text-gray-600"><DollarSign size={13} /> Txn: {receipt.transaction_currency}</span>}
                                  {receipt.transaction_amount != null && <span className="flex items-center gap-1 text-gray-600"><DollarSign size={13} /> Txn Amt: {Number(receipt.transaction_amount).toFixed(2)}</span>}
                                  {receipt.card_number && <span className="flex items-center gap-1 text-gray-600"><Building2 size={13} /> {receipt.card_number}</span>}
                                  {receipt.card_type && <span className="flex items-center gap-1 text-gray-600"><Building2 size={13} /> {receipt.card_type}</span>}
                                  {receipt.payee && <span className="flex items-center gap-1 text-gray-600"><User size={13} /> Payee: {receipt.payee}</span>}
                                  {receipt.address && <span className="flex items-center gap-1 text-gray-600 truncate max-w-[200px]" title={receipt.address}><FileText size={13} /> {receipt.address}</span>}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-center py-6 text-sm text-gray-400" onClick={(e) => e.stopPropagation()}>
                              <FileText size={24} className="mx-auto mb-2 opacity-50" />
                              <p>No receipt extracted yet</p>
                              <p className="text-xs">The PDF may still be processing or extraction failed</p>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ========== RECEIPTS TAB ========== */
function ReceiptsTab({ initialFilter = "", user }: { initialFilter?: string; user?: any }) {
  const { currentOrg } = useOrg();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(initialFilter);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [auditReceiptId, setAuditReceiptId] = useState<string | null>(null);
  const [auditRecords, setAuditRecords] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => { loadReceipts(); }, [filter, dateFrom, dateTo]);

  async function loadReceipts() {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: "1", page_size: "100" });
      if (filter) p.set("status", filter);
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
      const res = await fetch(`${API}/api/receipts?${p}`, { headers: headers() });
      const d = await res.json();
      setReceipts(d.items || []);
    } catch (e) { console.error("loadReceipts error:", e); } finally { setLoading(false); }
  }

  async function loadAudit(receiptId: string) {
    setAuditLoading(true);
    setAuditReceiptId(receiptId);
    try {
      const res = await fetch(`${API}/api/receipts/${receiptId}/audit`, { headers: headers() });
      const d = await res.json();
      setAuditRecords(d.items || []);
    } catch (e) { console.error(e); setAuditRecords([]); }
    finally { setAuditLoading(false); }
  }

  const FIELD_LABELS_AUDIT: Record<string, string> = {
    amount: "Amount", currency: "Currency", payer_name: "Payer Name",
    bank_issuer: "Bank Issuer", receipt_number: "Receipt #", payment_date: "Payment Date",
    description: "Description", purchase_currency: "Purchase Currency",
    transaction_currency: "Transaction Currency", transaction_amount: "Transaction Amount",
    card_number: "Card Number", card_type: "Card Type", payee: "Payee", address: "Address",
    status: "Status", confidence_score: "Confidence Score",
  };

  function startEdit(r: any) {
    setEditingId(r.id);
    setForm({
      amount: r.amount ?? "", currency: r.currency ?? "USD",
      payer_name: r.payer_name ?? "", bank_issuer: r.bank_issuer ?? "",
      receipt_number: r.receipt_number ?? "", payment_date: r.payment_date ?? "",
      description: r.description ?? "",
      purchase_currency: r.purchase_currency ?? "",
      transaction_currency: r.transaction_currency ?? "",
      card_number: r.card_number ?? "", card_type: r.card_type ?? "",
      payee: r.payee ?? "", address: r.address ?? "",
    });
  }

  async function handleSave(receiptId: string, origReceipt: any) {
    setSaving(true);
    try {
      const needsReview = origReceipt.status === "review_needed";
      const payload = needsReview ? { ...form, status: "reviewed" } : form;
      const updated = await updateReceipt(receiptId, payload, user?.id);
      setReceipts(prev => prev.map(r => r.id === receiptId ? updated : r));
      setEditingId(null);
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  }

  const filtered = search ? receipts.filter(r =>
    Object.values(r).some(v => String(v ?? "").toLowerCase().includes(search.toLowerCase()))
  ) : receipts;

  function confidenceBadge(score: number | null) {
    if (score == null) return null;
    const color = score >= 0.85 ? "text-green-700 bg-green-50 border-green-200" : score >= 0.5 ? "text-yellow-700 bg-yellow-50 border-yellow-200" : "text-red-700 bg-red-50 border-red-200";
    return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${color}`}>{Math.round(score * 100)}%</span>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Receipts</h2>
        <button onClick={loadReceipts} className="text-sm text-gray-500 hover:text-blue-600"><RefreshCw size={14} className="inline mr-1" /> Refresh</button>
      </div>
      <div className="mb-4 flex gap-2 flex-wrap items-center">
        <div className="flex items-center gap-1.5">
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setEditingId(null); }}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 outline-none" title="From date" />
          <span className="text-xs text-gray-400">—</span>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setEditingId(null); }}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 outline-none" title="To date" />
        </div>
        {["", "extracted", "review_needed", "reviewed", "synced", "failed"].map((s) => (
          <button key={s} onClick={() => { setFilter(s); setEditingId(null); }}
            className={`rounded-full px-3 py-1 text-xs ${filter === s ? "bg-blue-600 text-white" : "bg-white border text-gray-600 hover:bg-gray-50"}`}>
            {s ? s.replace(/_/g, " ") : "All"}
          </button>
        ))}
        {(dateFrom || dateTo || filter) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); setFilter(""); }}
            className="text-xs text-gray-500 hover:text-red-600 px-2 py-1.5 border rounded-lg">Clear</button>
        )}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-gray-300 pl-7 pr-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none w-40" />
        </div>
        <span className="text-xs text-gray-400">{filtered.length} receipts</span>
      </div>

      {/* Edit form overlay */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={() => setEditingId(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl p-5 sm:p-6 w-full sm:max-w-lg mx-0 sm:mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Edit Receipt</h3>
              <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Amount", key: "amount" }, { label: "Currency", key: "currency" },
                { label: "Payer Name", key: "payer_name" }, { label: "Bank Issuer", key: "bank_issuer" },
                { label: "Receipt #", key: "receipt_number" }, { label: "Payment Date", key: "payment_date" },
                { label: "Purchase Currency", key: "purchase_currency" },
                { label: "Transaction Currency", key: "transaction_currency" },
                { label: "Transaction Amount", key: "transaction_amount" },
                { label: "Card Number", key: "card_number" }, { label: "Card Type", key: "card_type" },
                { label: "Payee", key: "payee" }, { label: "Address", key: "address" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="block text-xs text-gray-500 mb-0.5">{f.label}</label>
                  <input type="text" value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 outline-none" />
                </div>
              ))}
            </div>
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-0.5">Description</label>
              <textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 outline-none w-full" rows={2} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 px-3 py-1.5 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => {
                const r = receipts.find(x => x.id === editingId);
                if (r) handleSave(editingId, r);
              }} disabled={saving}
                className="flex items-center gap-1 text-xs text-white bg-blue-600 px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? <div className="text-center py-8 text-sm text-gray-500"><Loader2 size={16} className="animate-spin inline mr-2" />Loading...</div>
      : filtered.length === 0 ? <div className="text-center py-8 text-sm text-gray-500">No receipts found.</div>
      : (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-gray-500 font-medium">
                <th className="px-3 py-2.5 whitespace-nowrap">Receipt #</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Amount</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Payer</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Bank</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Date</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Conf</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Status</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Description</th>
                <th className="px-3 py-2.5 whitespace-nowrap w-24 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={`border-b last:border-0 hover:bg-gray-50 transition-colors ${r.status === "review_needed" ? "bg-orange-50/30" : ""}`}>
                  <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{r.receipt_number || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-semibold text-gray-800">
                    {r.amount != null ? `${Number(r.amount).toFixed(2)} ${r.currency || "USD"}` : "—"}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 max-w-[120px] truncate" title={r.payer_name}>{r.payer_name || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 max-w-[100px] truncate" title={r.bank_issuer}>{r.bank_issuer || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{r.payment_date || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{confidenceBadge(r.confidence_score) || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                      r.status === "extracted" ? "bg-blue-50 text-blue-700" :
                      r.status === "review_needed" ? "bg-orange-50 text-orange-700" :
                      r.status === "reviewed" ? "bg-emerald-50 text-emerald-700" :
                      r.status === "synced" ? "bg-green-50 text-green-700" :
                      r.status === "failed" ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-600"
                    }`}>{r.status?.replace(/_/g, " ")}</span>
                  </td>
                  <td className="px-3 py-2.5 max-w-[160px] truncate text-gray-500" title={r.description}>{r.description || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      {(() => {
                        const role = currentOrg?.role;
                        const canEditReceipt = role === "admin" || role === "manager";
                        return (<>
                          {canEditReceipt && <button onClick={() => startEdit(r)} className="text-gray-400 hover:text-blue-600 p-1" title="Select"><Check size={14} /></button>}
                          {canEditReceipt && <button onClick={() => startEdit(r)} className="text-gray-400 hover:text-amber-600 p-1" title="Amend"><Edit3 size={14} /></button>}
                          <button onClick={() => loadAudit(r.id)} className="text-gray-400 hover:text-indigo-600 p-1" title="Audit Trail"><History size={14} /></button>
                          {canEditReceipt && (confirmDelete === r.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => {
                                updateReceipt(r.id, { status: "failed" }, user?.id).then(() => { setConfirmDelete(null); loadReceipts(); });
                              }} className="text-red-600 hover:text-red-800 p-1" title="Confirm"><Check size={14} /></button>
                              <button onClick={() => setConfirmDelete(null)} className="text-gray-400 hover:text-gray-600 p-1" title="Cancel"><X size={14} /></button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDelete(r.id)} className="text-gray-400 hover:text-red-600 p-1" title="Delete"><Trash2 size={14} /></button>
                          ))}
                        </>);
                      })()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Audit trail modal */}
      {auditReceiptId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={() => setAuditReceiptId(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl p-5 sm:p-6 w-full sm:max-w-lg mx-0 sm:mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><History size={16} className="text-indigo-500" /> Audit Trail</h3>
              <button onClick={() => setAuditReceiptId(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            {auditLoading ? (
              <div className="text-center py-8 text-sm text-gray-500"><Loader2 size={16} className="animate-spin inline mr-2" />Loading...</div>
            ) : auditRecords.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-400">No changes recorded yet.</div>
            ) : (
              <div className="space-y-3">
                {auditRecords.map((a: any) => (
                  <div key={a.id} className="rounded-lg border bg-gray-50 p-3 text-xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-700">{FIELD_LABELS_AUDIT[a.field_name] || a.field_name}</span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(a.changed_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">Old value</div>
                        <div className="bg-red-50 text-red-700 rounded px-2 py-1 break-all line-through">{a.old_value || <span className="text-gray-300 italic">empty</span>}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">New value</div>
                        <div className="bg-green-50 text-green-700 rounded px-2 py-1 break-all">{a.new_value || <span className="text-gray-300 italic">empty</span>}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== RECONCILIATION TAB ========== */
const CLASS_COLORS: Record<string, string> = {
  correct: "bg-green-100 text-green-800 border-green-200",
  minor_mistake: "bg-yellow-100 text-yellow-800 border-yellow-200",
  potential_fraud: "bg-orange-100 text-orange-800 border-orange-200",
  forensic_required: "bg-red-100 text-red-800 border-red-200",
  fraud_detected: "bg-red-200 text-red-900 border-red-300",
  pending: "bg-gray-100 text-gray-600 border-gray-200",
};

const FIELD_LABELS: Record<string, string> = {
  amount: "Amount", currency: "Currency", payer_name: "Payer / Vendor",
  payment_date: "Date", receipt_number: "Receipt #", description: "Description",
};

function ReconciliationTab({ initialFilter = "" }: { initialFilter?: string }) {
  const [results, setResults] = useState<any[]>([]);
  const [proofsById, setProofsById] = useState<Record<string, any>>({});
  const [entriesById, setEntriesById] = useState<Record<string, any>>({});
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [activeReconTab, setActiveReconTab] = useState<"unmatched_proof" | "unmatched_entry" | "reconciled">("reconciled");
  const [reconClassFilter, setReconClassFilter] = useState(initialFilter || "");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [allEntries, setAllEntries] = useState<any[]>([]);
  const [progress, setProgress] = useState<any>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => { loadData(); }, [activeReconTab, reconClassFilter]);

  async function loadData() {
    setLoading(true);
    try {
      const params: any = {};
      if (activeReconTab === "reconciled") {
        if (reconClassFilter) params.classification = reconClassFilter;
      } else {
        params.match_type = activeReconTab;
      }
      const [statsRes, resultsRes, accRes] = await Promise.all([
        fetchReconciliationStats(),
        fetchReconciliationResults(Object.keys(params).length ? params : undefined),
        fetchAccountingEntries(),
      ]);
      setStats(statsRes);
      const parsedResults = (resultsRes.items || []).map((r: any) => ({
        ...r,
        _aa: typeof r.ai_analysis === "string" ? (() => { try { return JSON.parse(r.ai_analysis); } catch { return null; } })() : r.ai_analysis,
      }));
      setResults(parsedResults);
      setAllEntries(accRes.items || []);

      const eMap: Record<string, any> = {};
      (accRes.items || []).forEach((e: any) => { eMap[e.id] = e; });
      setEntriesById(eMap);

      const proofIds = Array.from(new Set((resultsRes.items || []).map((r: any) => r.proof_receipt_id).filter(Boolean)));
      const pMap: Record<string, any> = {};
      if (proofIds.length > 0) {
        const p = new URLSearchParams({ page: "1", page_size: "100" });
        const pr = await fetch(`${API}/api/receipts?${p}`, { headers: headers() });
        if (pr.ok) {
          const pd = await pr.json();
          (pd.items || []).forEach((r: any) => { pMap[r.id] = r; });
        }
      }
      setProofsById(pMap);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  async function handleRun() {
    setRunning(true);
    setProgress({ total: 0, processed: 0, current_label: "Starting..." });
    try {
      await runReconciliation(dateFrom || undefined, dateTo || undefined);
      const poll = setInterval(async () => {
        try {
          const p = await fetchReconciliationProgress();
          setProgress(p);
          if (p.status === "complete" || p.status === "failed") {
            clearInterval(poll);
            if (p.status === "complete") {
              await loadData();
            }
            setRunning(false);
            setTimeout(() => setProgress(null), 2000);
          }
        } catch { clearInterval(poll); setRunning(false); setProgress(null); }
      }, 400);
    } catch (e: any) {
      alert(e.message);
      setRunning(false);
      setProgress(null);
    }
  }

  async function handleOverride(resultId: string, classification: string) {
    setSaving(true);
    try {
      await overrideReclassification(resultId, { classification, notes, human_reviewed: true });
      await loadData();
      setNotes("");
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  }

  async function handleManualMatch(resultId: string, proofReceiptId: string, entryId: string) {
    setSaving(true);
    try {
      await manualMatch({ proof_receipt_id: proofReceiptId, accounting_entry_id: entryId || undefined, notes });
      await loadData();
      setNotes("");
      setExpandedId(null);
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  }

  function classBadge(c: string) {
    const label = c.replace(/_/g, " ");
    const color = CLASS_COLORS[c] || CLASS_COLORS.pending;
    return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${color}`}>{label}</span>;
  }

  const CLASS_FILTERS = ["", "correct", "minor_mistake", "potential_fraud", "forensic_required", "fraud_detected"];

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold">Reconciliation</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span>From</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 outline-none" />
            <span>To</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 outline-none" />
          </div>
          <button onClick={loadData} className="text-sm text-gray-500 hover:text-blue-600"><RefreshCw size={14} className="inline mr-1" /> Refresh</button>
          <button onClick={handleRun} disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {running ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />}
            {running ? "Running..." : "Run Reconciliation"}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {progress && progress.status !== "complete" && (
        <div className="mb-4 rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 size={14} className="animate-spin text-blue-600" />
              <span className="font-medium text-gray-700">
                {progress.total > 0 ? `Processing ${progress.processed} of ${progress.total}` : "Processing..."}
              </span>
            </div>
            <span className="text-xs text-gray-400">
              {progress.total > 0 ? `${Math.round((progress.processed / progress.total) * 100)}%` : ""}
            </span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: progress.total > 0 ? `${(progress.processed / progress.total) * 100}%` : "5%" }} />
          </div>
          {progress.current_label && <p className="text-xs text-gray-400 mt-1.5">{progress.current_label}</p>}
        </div>
      )}

      {/* 3-section tabs */}
      <div className="mb-4 flex gap-1 border-b border-gray-100">
        {[
          { key: "unmatched_proof" as const, label: "Proof — No Entry", icon: FileText },
          { key: "unmatched_entry" as const, label: "Entry — No Proof", icon: Receipt },
          { key: "reconciled" as const, label: "Reconciled", icon: CheckCircle },
        ].map((t) => {
          const count = t.key === "reconciled"
            ? Math.max(0, (stats.total ?? 0) - (stats.unmatched_proof ?? 0) - (stats.unmatched_entry ?? 0))
            : (stats[t.key] ?? 0);
          return (
            <button key={t.key} onClick={() => setActiveReconTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
                activeReconTab === t.key
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}>
              <t.icon size={14} />
              {t.label}
              {count > 0 && (
                <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  activeReconTab === t.key ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"
                }`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Classification filter — only for reconciled tab */}
      {activeReconTab === "reconciled" && (
        <div className="mb-4 flex gap-2 flex-wrap items-center">
          {CLASS_FILTERS.map((c) => (
            <button key={c} onClick={() => setReconClassFilter(c)}
              className={`rounded-full px-3 py-1 text-xs ${reconClassFilter === c ? "bg-blue-600 text-white" : "bg-white border text-gray-600 hover:bg-gray-50"}`}>
              {c ? c.replace(/_/g, " ") : "All classifications"}
            </button>
          ))}
          <span className="text-xs text-gray-400 ml-auto">{results.length} results</span>
        </div>
      )}

      {/* Table */}
      {loading ? <div className="text-center py-8 text-sm text-gray-500"><Loader2 size={16} className="animate-spin inline mr-2" />Loading...</div>
      : results.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 p-8 text-center">
          <Scale size={32} className="mx-auto text-blue-300 mb-3" />
          <h3 className="text-lg font-semibold text-blue-800 mb-1">
            {activeReconTab === "unmatched_proof" ? "No unmatched proofs"
             : activeReconTab === "unmatched_entry" ? "No unmatched entries"
             : "No reconciled results"}
          </h3>
          <p className="text-sm text-blue-600 mb-4">
            {activeReconTab === "reconciled" && reconClassFilter ? "No results match the selected classification filter."
             : "Run reconciliation to cross-reference proofs with accounting entries."}
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-blue-500">
            <span className="inline-flex items-center gap-1"><FileText size={12} /> {stats.total ?? 0} total results</span>
            <span className="text-blue-300">|</span>
            <span className="inline-flex items-center gap-1"><Calendar size={12} /> Set date range above and run</span>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-gray-500 font-medium">
                <th className="px-3 py-2.5 whitespace-nowrap">Receipt #</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Proof Amount</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Payer</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Entry</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Entry Amount</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Diff</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Type</th>
                {activeReconTab === "reconciled" && <th className="px-3 py-2.5 whitespace-nowrap">Classification</th>}
                <th className="px-3 py-2.5 whitespace-nowrap w-10 text-center">Expand</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const isOpen = expandedId === r.id;
                const proof = r.proof_receipt_id ? proofsById[r.proof_receipt_id] : null;
                const entry = r.accounting_entry_id ? entriesById[r.accounting_entry_id] : null;
                const isUnmatched = r.match_type === "unmatched_proof" || r.match_type === "unmatched_entry";
                const colSpan = activeReconTab === "reconciled" ? 9 : 8;
                return (
                  <Fragment key={r.id}>
                    <tr className={`border-b hover:bg-gray-50 transition-colors cursor-pointer ${isOpen ? "bg-blue-50/30" : ""}`}
                      onClick={() => setExpandedId(isOpen ? null : r.id)}>
                      <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">
                        {isUnmatched && r.match_type === "unmatched_entry" ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          proof?.receipt_number || <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-semibold text-gray-800">
                        {isUnmatched && r.match_type === "unmatched_entry" ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          proof?.amount != null ? `${Number(proof.amount).toFixed(2)}` : <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 max-w-[120px] truncate" title={proof?.payer_name}>
                        {isUnmatched && r.match_type === "unmatched_entry" ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          proof?.payer_name || <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 max-w-[120px] truncate" title={entry?.vendor || entry?.payer_name}>
                        {entry?.vendor || entry?.payer_name || <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-semibold text-gray-800">
                        {entry?.amount != null ? `${Number(entry.amount).toFixed(2)}` : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {!isUnmatched && r.amount_diff != null ? (
                          <span className={`font-semibold ${Math.abs(r.amount_diff) > 0.5 ? "text-red-600" : "text-green-600"}`}>
                            {r.amount_diff >= 0 ? "+" : ""}{Number(r.amount_diff).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {isUnmatched ? (
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                            r.match_type === "unmatched_proof" ? "bg-blue-50 text-blue-700" : "bg-orange-50 text-orange-700"
                          }`}>
                            {r.match_type === "unmatched_proof" ? "Unmatched Proof" : "Unmatched Entry"}
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">Matched</span>
                        )}
                      </td>
                      {activeReconTab === "reconciled" && (
                        <td className="px-3 py-2.5 whitespace-nowrap">{classBadge(r.classification)}</td>
                      )}
                      <td className="px-3 py-2.5 whitespace-nowrap text-center text-gray-400">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50">
                        <td colSpan={colSpan} className="px-5 py-4 border-b space-y-4">
                          {isUnmatched ? (
                            <div className="space-y-3">
                              {r.match_type === "unmatched_proof" ? (
                                <>
                                  <p className="text-sm text-gray-600">This receipt has no matching entry in the accounting system.</p>
                                  <div className="flex items-center gap-3">
                                    <select id={`match-entry-${r.id}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs bg-white flex-1"
                                      defaultValue="">
                                      <option value="" disabled>Select accounting entry to link...</option>
                                      {allEntries.filter((e) => e.status === "posted").map((e) => (
                                        <option key={e.id} value={e.id}>{e.receipt_number || e.vendor || e.id.slice(0, 8)} — {e.amount} {e.currency}</option>
                                      ))}
                                    </select>
                                    <button onClick={() => {
                                      const sel = document.getElementById(`match-entry-${r.id}`) as HTMLSelectElement;
                                      if (sel?.value) handleManualMatch(r.id, r.proof_receipt_id, sel.value);
                                    }} disabled={saving}
                                      className="text-xs text-white bg-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                                      {saving ? <Loader2 size={12} className="animate-spin" /> : "Link & Mark Reviewed"}
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <div className="space-y-3">
                                  <div className="flex items-start gap-3 p-3 rounded-lg border border-orange-200 bg-orange-50">
                                    <div className="shrink-0 w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                                      <AlertTriangle size={16} className="text-orange-600" />
                                    </div>
                                    <div>
                                      <p className="text-sm font-medium text-orange-800">No proof document loaded for this entry</p>
                                      <p className="text-xs text-orange-600 mt-0.5">The accounting entry exists but no receipt has been uploaded for verification.</p>
                                    </div>
                                  </div>
                                  {entry && (
                                    <div className="rounded-lg border bg-white p-3">
                                      <h4 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Entry Details</h4>
                                      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                                        {["vendor", "receipt_number", "amount", "currency", "payment_date", "description", "account_code", "cost_center"].filter(f => entry[f]).map(f => (
                                          <div key={f} className="flex items-center gap-2">
                                            <span className="text-gray-400 text-xs w-28 capitalize">{f.replace(/_/g, " ")}</span>
                                            <span className="font-mono text-xs text-gray-800">{String(entry[f])}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {proof && (
                                <div className="flex items-center gap-3 text-xs text-gray-500 border-b pb-3">
                                  <div className="flex items-center gap-1.5">
                                    <ExternalLink size={12} />
                                    <span>Receipt: <span className="font-medium text-gray-700">{proof.id.slice(0, 8)}</span></span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <FileText size={12} />
                                    <span>Proof: <span className="font-medium text-gray-700">{proof.payment_proofs?.file_name || proof.proof_id || "—"}</span></span>
                                  </div>
                                  {entry && (
                                    <div className="flex items-center gap-1.5">
                                      <Building2 size={12} />
                                      <span>Accounting: <span className="font-medium text-gray-700">{entry.id.slice(0, 8)}</span></span>
                                    </div>
                                  )}
                                </div>
                              )}
                              {r._aa?.summary && (
                                <div className={`rounded-lg border p-3 text-sm ${
                                  r._aa.risk_level === "high" ? "bg-red-50 border-red-200" :
                                  r._aa.risk_level === "medium" ? "bg-orange-50 border-orange-200" : "bg-blue-50 border-blue-200"
                                }`}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-semibold text-gray-600">AI Analysis</span>
                                    <span className={`text-xs font-medium ${
                                      r._aa.risk_level === "high" ? "text-red-600" :
                                      r._aa.risk_level === "medium" ? "text-orange-600" : "text-blue-600"
                                    }`}>Risk: {r._aa.risk_level}</span>
                                  </div>
                                  <p className="text-xs text-gray-700">{r._aa.summary}</p>
                                  {r._aa.details && r._aa.details.length > 0 && (
                                    <ul className="mt-1.5 space-y-0.5">
                                      {r._aa.details.map((d: string, i: number) => (
                                        <li key={i} className="text-xs text-gray-600 flex items-start gap-1"><span className="mt-0.5">•</span> {d}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}
                              <div className="grid grid-cols-2 gap-6">
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><Receipt size={14} /> Extracted from PDF</h4>
                                  <div className="space-y-2 text-sm">
                                    {["amount", "currency", "payer_name", "payment_date", "receipt_number", "description"].map((f) => {
                                      const pv = proof?.[f];
                                      const isDiff = f === "amount" && r.amount_diff != null && Math.abs(r.amount_diff_pct) > 0.5;
                                      return (
                                        <div key={f} className="flex items-center justify-between">
                                          <span className="text-gray-500 text-xs w-28">{FIELD_LABELS[f]}</span>
                                          <span className={`font-mono text-xs ${!pv ? "text-gray-300" : isDiff ? "text-red-600 font-semibold" : "text-gray-800"}`}>
                                            {f === "amount" && pv != null ? `${Number(pv).toFixed(2)}` : String(pv ?? "—")}
                                          </span>
                                        </div>
                                      );
                                    })}
                                    {r.matched_fields && typeof r.matched_fields === "object" && (
                                      <div className="flex items-center gap-2 pt-1 text-xs">
                                        {Object.entries(r.matched_fields).map(([k, v]) => (
                                          <span key={k} className={`rounded-full px-2 py-0.5 ${v ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                                            {k.replace(/_/g, " ")} {v ? "✓" : "✗"}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><Building2 size={14} /> Accounting System</h4>
                                  <div className="space-y-2 text-sm">
                                    {["amount", "currency", "payer_name", "payment_date", "receipt_number", "description"].map((f) => {
                                      const ev = entry?.[f];
                                      const isDiff = f === "amount" && r.amount_diff != null && Math.abs(r.amount_diff_pct) > 0.5;
                                      return (
                                        <div key={f} className="flex items-center justify-between">
                                          <span className="text-gray-500 text-xs w-28">{FIELD_LABELS[f]}</span>
                                          <span className={`font-mono text-xs ${!ev ? "text-gray-300" : isDiff ? "text-red-600 font-semibold" : "text-gray-800"}`}>
                                            {f === "amount" && ev != null ? `${Number(ev).toFixed(2)}` : String(ev ?? "—")}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="pt-2 border-t flex items-end gap-3">
                            <div className="flex-1">
                              <label className="block text-xs text-gray-500 mb-1">Notes</label>
                              <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                                placeholder="Add note..." className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none" />
                            </div>
                            <select defaultValue="" onChange={(e) => { if (e.target.value) handleOverride(r.id, e.target.value); }}
                              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs bg-white">
                              <option value="" disabled>Override classification...</option>
                              {["correct", "minor_mistake", "potential_fraud", "forensic_required", "fraud_detected"].map((c) => (
                                <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                              ))}
                            </select>
                            {r.human_reviewed && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={12} /> Reviewed</span>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function confidenceBadge(score: number | null) {
  if (score == null) return null;
  if (score >= 0.85) return <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 rounded-full px-2 py-0.5 border border-green-200"><Shield size={11} /> {Math.round(score * 100)}%</span>;
  if (score >= 0.5) return <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 bg-yellow-50 rounded-full px-2 py-0.5 border border-yellow-200"><AlertTriangle size={11} /> {Math.round(score * 100)}%</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 rounded-full px-2 py-0.5 border border-red-200"><AlertCircle size={11} /> {Math.round(score * 100)}%</span>;
}

/* ==================================================================
   Platform Admin Panel (4 UIs)
   ================================================================== */

const ALL_MENUS = [
  { key: "Dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "Upload", label: "Upload", icon: UploadCloud },
  { key: "Proofs", label: "Proofs", icon: FileText },
  { key: "Receipts", label: "Receipts", icon: Receipt },
  { key: "Reconciliation", label: "Reconciliation", icon: Scale },
  { key: "Entries", label: "Journal Entries", icon: Database },
  { key: "Forensic", label: "Forensic", icon: Shield },
  { key: "Logs", label: "Activity Log", icon: ClipboardList },
  { key: "Team", label: "Team", icon: Users },
];

const ADMIN_TABS = [
  { key: "create", label: "Create Org", icon: Plus },
  { key: "profile", label: "Company Profile", icon: Building2 },
  { key: "rights", label: "Manage Rights", icon: Shield },
  { key: "menus", label: "Menu Access", icon: Settings },
  { key: "orgs", label: "Org Access", icon: Users },
] as const;

function PlatformAdminPanel({ user }: { user: any }) {
  const [adminTab, setAdminTab] = useState<string>("create");
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [allOrgs, setAllOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchAllUsers().then(r => setAllUsers(r?.items || [])).catch(() => {}),
      fetchAllOrgs().then(r => setAllOrgs(r?.items || [])).catch(() => {}),
    ]).then(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-xs text-gray-400 py-8 text-center"><Loader2 size={14} className="animate-spin inline mr-1" />Loading...</div>;

  return (
    <div>
      <div className="flex items-center gap-1 mb-4 border-b border-gray-100 pb-2">
        {ADMIN_TABS.map(t => (
          <button key={t.key} onClick={() => setAdminTab(t.key)}
            className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded transition-colors ${adminTab === t.key ? "bg-gray-900 text-white font-medium" : "text-gray-400 hover:text-gray-600"}`}>
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      {adminTab === "create" && <CreateOrgTab allOrgs={allOrgs} onOrgCreated={() => fetchAllOrgs().then(r => setAllOrgs(r?.items || [])).catch(() => {})} />}
      {adminTab === "profile" && <AdminCompanyProfileTab allOrgs={allOrgs} />}
      {adminTab === "rights" && <ManageRightsTab allUsers={allUsers} onUserChange={() => fetchAllUsers().then(r => setAllUsers(r?.items || [])).catch(() => {})} />}
      {adminTab === "menus" && <MenuAccessTab allUsers={allUsers} />}
      {adminTab === "orgs" && <OrgAccessTab allUsers={allUsers} allOrgs={allOrgs} onRefresh={() => {
        fetchAllUsers().then(r => setAllUsers(r?.items || [])).catch(() => {});
        fetchAllOrgs().then(r => setAllOrgs(r?.items || [])).catch(() => {});
      }} />}
    </div>
  );
}

// ----- Tab 1: Create Org -----
function CreateOrgTab({ allOrgs, onOrgCreated }: { allOrgs: any[]; onOrgCreated: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true); setMsg("");
    try {
      await createOrg(name.trim());
      setMsg("Organization created!");
      setName("");
      onOrgCreated();
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-md space-y-4">
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Existing Organizations ({allOrgs.length})</p>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {allOrgs.map(o => (
            <div key={o.id} className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded text-xs text-gray-700">
              <Building2 size={12} className="text-gray-400 shrink-0" />
              {o.name}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs font-medium text-gray-500 mb-2">New Organization</p>
        <div className="flex items-center gap-2">
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Organization name..."
            className="flex-1 rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-gray-400" />
          <button onClick={handleCreate} disabled={busy || !name.trim()}
            className="flex items-center gap-1 rounded bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Create
          </button>
        </div>
        {msg && <p className={`text-xs mt-1 ${msg === "Organization created!" ? "text-green-600" : "text-red-600"}`}>{msg}</p>}
      </div>
    </div>
  );
}

// ----- Tab 2: Company Profile (Admin) -----
function AdminCompanyProfileTab({ allOrgs }: { allOrgs: any[] }) {
  const [selOrgId, setSelOrgId] = useState("");
  const [orgDetail, setOrgDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [form, setForm] = useState({
    name: "", address: "", city: "", postal_code: "", country: "",
    vat_number: "", tax_id: "", phone: "", website: "", industry: "", description: "",
  });

  useEffect(() => {
    if (!selOrgId) { setOrgDetail(null); return; }
    setLoading(true);
    fetchOrgDetail(selOrgId)
      .then(d => {
        setOrgDetail(d);
        setForm({
          name: d.name || "", address: d.address || "", city: d.city || "",
          postal_code: d.postal_code || "", country: d.country || "",
          vat_number: d.vat_number || "", tax_id: d.tax_id || "",
          phone: d.phone || "", website: d.website || "",
          industry: d.industry || "", description: d.description || "",
        });
      })
      .catch(() => setOrgDetail(null))
      .finally(() => setLoading(false));
  }, [selOrgId]);

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!selOrgId) return;
    setSaving(true); setMsg("");
    try {
      await updateOrg(selOrgId, form);
      setMsg("Company profile updated");
    } catch (e: any) { setMsg(e.message); }
    finally { setSaving(false); }
  }

  const selectedOrg = allOrgs.find(o => o.id === selOrgId);

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <label className="block text-[10px] text-gray-400 mb-1">Organization</label>
        <select value={selOrgId} onChange={e => setSelOrgId(e.target.value)}
          className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs bg-white outline-none">
          <option value="">Select organization...</option>
          {allOrgs.map(o => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>

      {loading && <div className="text-xs text-gray-400 py-4 text-center"><Loader2 size={14} className="animate-spin inline mr-1" />Loading...</div>}

      {!loading && selOrgId && orgDetail && (
        <div className="max-w-xl space-y-4">
          <div className="rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Company Name</label>
                <input type="text" value={form.name} onChange={e => set("name", e.target.value)}
                  className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Description</label>
                <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2}
                  className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400 resize-none" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Phone</label>
                <input type="text" value={form.phone} onChange={e => set("phone", e.target.value)}
                  className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Website</label>
                <input type="text" value={form.website} onChange={e => set("website", e.target.value)}
                  className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400" />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4 space-y-3">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Address</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Street Address</label>
                <input type="text" value={form.address} onChange={e => set("address", e.target.value)}
                  className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">City</label>
                <input type="text" value={form.city} onChange={e => set("city", e.target.value)}
                  className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Postal Code</label>
                <input type="text" value={form.postal_code} onChange={e => set("postal_code", e.target.value)}
                  className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Country</label>
                <input type="text" value={form.country} onChange={e => set("country", e.target.value)}
                  className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400" />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4 space-y-3">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Tax & Registration</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">VAT Number</label>
                <input type="text" value={form.vat_number} onChange={e => set("vat_number", e.target.value)}
                  className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Tax ID / EIN</label>
                <input type="text" value={form.tax_id} onChange={e => set("tax_id", e.target.value)}
                  className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Industry</label>
                <select value={form.industry} onChange={e => set("industry", e.target.value)}
                  className="w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400 bg-white">
                  <option value="">Select...</option>
                  {["Technology", "Finance", "Healthcare", "Manufacturing", "Retail", "Real Estate", "Consulting", "Education", "Legal", "Construction", "Transportation", "Energy", "Hospitality", "Media", "Agriculture", "Other"].map(i => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 rounded bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {msg && <span className={`text-xs ${msg === "Company profile updated" ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
          </div>
        </div>
      )}

      {!loading && selOrgId && !orgDetail && (
        <p className="text-xs text-red-400">Could not load organization details.</p>
      )}
    </div>
  );
}

// ----- Tab 4: Manage Rights -----
function ManageRightsTab({ allUsers, onUserChange }: { allUsers: any[]; onUserChange: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function togglePlatformAdmin(u: any) {
    setBusyId(u.user_id);
    try {
      if (u.is_platform_admin) {
        await demotePlatformAdmin(u.user_id);
      } else {
        await promotePlatformAdmin(u.user_id);
      }
      onUserChange();
    } catch (e: any) { alert(e.message); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-2">All Users ({allUsers.length})</p>
      <div className="space-y-1">
        {allUsers.map(u => (
          <div key={u.user_id} className="flex items-center gap-3 rounded bg-gray-50 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-500 shrink-0">
              {(u.display_name?.[0] || "?").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate">{u.display_name || u.user_id?.slice(0, 8)}</p>
              <p className="text-[10px] text-gray-400">{u.orgs?.length || 0} orgs | {u.orgs?.map((o: any) => o.name).join(", ") || "none"}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${u.is_platform_admin ? "bg-gray-800 text-white" : "bg-gray-200 text-gray-500"}`}>
                {u.is_platform_admin ? "Platform Admin" : "User"}
              </span>
              <button onClick={() => togglePlatformAdmin(u)} disabled={busyId === u.user_id}
                className="text-[10px] text-gray-500 hover:text-black underline disabled:opacity-50">
                {busyId === u.user_id ? <Loader2 size={10} className="animate-spin" /> : u.is_platform_admin ? "Demote" : "Promote"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----- Tab 5: Menu Access (CRUD table) -----
function MenuAccessTab({ allUsers }: { allUsers: any[] }) {
  const [allOrgs, setAllOrgs] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Grant form
  const [grantUserId, setGrantUserId] = useState("");
  const [grantOrgId, setGrantOrgId] = useState("");
  const [grantMenus, setGrantMenus] = useState<string[]>([]);
  const [granting, setGranting] = useState(false);

  // Inline edit
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editMenus, setEditMenus] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Delete
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");

  function buildEntries(users: any[], orgs: any[]) {
    const rows: any[] = [];
    for (const u of users) {
      for (const o of (u.orgs || [])) {
        const org = orgs.find((x: any) => x.id === o.id);
        rows.push({
          key: u.user_id + "|" + o.id,
          user_id: u.user_id,
          display_name: u.display_name || u.email || u.user_id.slice(0, 8),
          email: u.email || "",
          org_id: o.id,
          org_name: org?.name || o.name || o.id.slice(0, 8),
          menus: [] as string[],
          loaded: false,
        });
      }
    }
    rows.sort((a, b) => a.display_name.localeCompare(b.display_name));
    return rows;
  }

  async function loadData() {
    setLoading(true);
    try {
      const [uRes, oRes] = await Promise.all([
        fetchAllUsers().catch(() => ({ items: [] })),
        fetchAllOrgs().catch(() => ({ items: [] })),
      ]);
      const users = uRes?.items || [];
      const orgs = oRes?.items || [];
      setAllOrgs(orgs);

      const rows = buildEntries(users, orgs);

      // Fetch menu permissions for each entry in parallel
      const orgMemberCache: Record<string, any[]> = {};
      await Promise.all(rows.map(async (row) => {
        if (!orgMemberCache[row.org_id]) {
          try {
            const data = await fetchOrgMembers(row.org_id);
            orgMemberCache[row.org_id] = data?.items || [];
          } catch { orgMemberCache[row.org_id] = []; }
        }
        const mem = orgMemberCache[row.org_id].find((m: any) => m.user_id === row.user_id);
        if (mem?.permissions?.menus) {
          row.menus = mem.permissions.menus;
        }
        row.loaded = true;
      }));

      setEntries(rows);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function handleGrant() {
    if (!grantUserId || !grantOrgId) return;
    setGranting(true); setMsg("");
    try {
      await updateMemberPermissions(grantOrgId, grantUserId, { menus: grantMenus });
      setMsg("Menu access saved");
      setGrantUserId(""); setGrantOrgId(""); setGrantMenus([]);
      await loadData();
    } catch (e: any) { setMsg(e.message); }
    finally { setGranting(false); }
  }

  function toggleGrantMenu(key: string) {
    setGrantMenus(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }

  function startEdit(entry: any) {
    setEditingKey(entry.key);
    setEditMenus([...entry.menus]);
  }

  function toggleEditMenu(key: string) {
    setEditMenus(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }

  async function saveEdit() {
    if (!editingKey) return;
    const [uid, oid] = editingKey.split("|");
    setSaving(true); setMsg("");
    try {
      await updateMemberPermissions(oid, uid, { menus: editMenus });
      setMsg("Saved");
      setEditingKey(null);
      await loadData();
    } catch (e: any) { setMsg(e.message); }
    finally { setSaving(false); }
  }

  async function handleClear(key: string) {
    const [uid, oid] = key.split("|");
    setDeletingKey(key); setMsg("");
    try {
      await updateMemberPermissions(oid, uid, { menus: [] });
      setMsg("Menu permissions cleared");
      await loadData();
    } catch (e: any) { setMsg(e.message); }
    finally { setDeletingKey(null); }
  }

  const filtered = entries.filter(r =>
    !search ||
    r.display_name.toLowerCase().includes(search.toLowerCase()) ||
    r.email.toLowerCase().includes(search.toLowerCase()) ||
    r.org_name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return <div className="text-xs text-gray-400 py-12 text-center"><Loader2 size={14} className="animate-spin inline mr-1" />Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-800">Menu Access Control</h2>
        <p className="text-xs text-gray-400 mt-0.5">Grant, edit, or clear menu visibility for each user-company pair</p>
      </div>

      {/* Grant Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Grant Menu Access</h3>
        <div className="flex items-end gap-3 mb-3">
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">User</label>
            <select value={grantUserId} onChange={e => { setGrantUserId(e.target.value); setGrantMenus([]); }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white">
              <option value="">Select user...</option>
              {allUsers.map(u => (
                <option key={u.user_id} value={u.user_id}>{u.display_name || u.email || u.user_id.slice(0, 8)} {u.email ? `(${u.email})` : ""}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Company</label>
            <select value={grantOrgId} onChange={e => setGrantOrgId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white">
              <option value="">Select company...</option>
              {allOrgs.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <button onClick={handleGrant} disabled={granting || !grantUserId || !grantOrgId}
            className="flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors">
            {granting ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Grant
          </button>
        </div>
        {grantUserId && grantOrgId && (
          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-medium text-gray-500 mb-2">Allowed Menus</p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_MENUS.map(m => {
                const enabled = grantMenus.includes(m.key);
                return (
                  <button key={m.key} onClick={() => toggleGrantMenu(m.key)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${enabled ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-400 hover:text-gray-600"}`}>
                    <m.icon size={12} />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {msg && <p className={`text-xs ${msg === "Saved" || msg.startsWith("Menu") ? "text-green-600" : "text-red-600"}`}>{msg}</p>}

      {/* Access Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Configurations ({entries.length})</span>
          <div className="relative flex-1 max-w-xs">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Filter by user or company..."
              className="w-full rounded-lg border border-gray-100 pl-7 pr-2.5 py-1.5 text-xs outline-none focus:border-gray-300" />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-xs text-gray-400 py-10 text-center">
            {entries.length === 0 ? "No user-company pairs yet. Grant access to create entries." : "No results match your filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-400">User</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-400">Company</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-400">Granted Menus</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(row => {
                  const isEditing = editingKey === row.key;
                  const currentMenus = isEditing ? editMenus : row.menus;
                  return (
                    <tr key={row.key} className={`hover:bg-gray-50/50 transition-colors ${isEditing ? "bg-gray-50" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-500 to-gray-700 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                            {row.display_name[0]?.toUpperCase() || "?"}
                          </div>
                          <span className="font-medium text-gray-800">{row.display_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded bg-gray-200 flex items-center justify-center text-[8px] font-bold text-gray-600 shrink-0">
                            {row.org_name[0]?.toUpperCase() || "?"}
                          </div>
                          <span className="text-gray-700">{row.org_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex flex-wrap gap-1">
                            {ALL_MENUS.map(m => {
                              const enabled = editMenus.includes(m.key);
                              return (
                                <button key={m.key} onClick={() => toggleEditMenu(m.key)}
                                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${enabled ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-400"}`}>
                                  {enabled ? <Check size={10} /> : <X size={10} />}
                                  {m.label}
                                </button>
                              );
                            })}
                          </div>
                        ) : currentMenus.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {currentMenus.map((m: string) => {
                              const def = ALL_MENUS.find(x => x.key === m);
                              return (
                                <span key={m} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-medium">
                                  {def ? <def.icon size={10} /> : null}
                                  {def?.label || m}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-gray-300 italic text-[10px]">(all default)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isEditing ? (
                            <>
                              <button onClick={saveEdit} disabled={saving}
                                className="flex items-center gap-1 text-xs rounded px-2 py-1 font-medium bg-black text-white hover:bg-gray-800 disabled:opacity-50">
                                {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                                Save
                              </button>
                              <button onClick={() => setEditingKey(null)}
                                className="flex items-center gap-1 text-xs rounded px-2 py-1 font-medium text-gray-500 hover:bg-gray-100">
                                <X size={10} />
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(row)}
                                className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 px-2 py-1 rounded transition-colors"
                                title="Edit menus">
                                <Edit3 size={12} />
                              </button>
                              <button onClick={() => handleClear(row.key)} disabled={deletingKey === row.key}
                                className="text-red-400 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50"
                                title="Clear menu permissions">
                                {deletingKey === row.key ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ----- Tab 6: Org Access -----
function OrgAccessTab({ allUsers, allOrgs, onRefresh }: { allUsers: any[]; allOrgs: any[]; onRefresh: () => void }) {
  const [selUser, setSelUser] = useState<string>("");
  const [membersMap, setMembersMap] = useState<Record<string, any[]>>({});
  const [busyOrg, setBusyOrg] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const user = allUsers.find(u => u.user_id === selUser);
  const userOrgIds = new Set((user?.orgs || []).map((o: any) => o.id));

  useEffect(() => {
    if (!selUser) return;
    Promise.all(allOrgs.map(async (o) => {
      try {
        const data = await fetchOrgMembers(o.id);
        return { orgId: o.id, members: data?.items || [] };
      } catch { return { orgId: o.id, members: [] }; }
    })).then(results => {
      const map: Record<string, any[]> = {};
      results.forEach(r => { map[r.orgId] = r.members; });
      setMembersMap(map);
    });
  }, [selUser, allOrgs]);

  async function toggleOrgAccess(orgId: string, add: boolean) {
    if (!selUser) return;
    setBusyOrg(orgId); setMsg("");
    try {
      if (add) {
        await addUserToOrg(orgId, selUser, "viewer");
      } else {
        await removeMember(orgId, selUser);
      }
      onRefresh();
      setMsg(add ? "User added" : "User removed");
    } catch (e: any) { setMsg(e.message); }
    finally { setBusyOrg(null); }
  }

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <label className="block text-[10px] text-gray-400 mb-1">User</label>
        <select value={selUser} onChange={e => setSelUser(e.target.value)}
          className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs bg-white outline-none">
          <option value="">Select user...</option>
          {allUsers.map(u => (
            <option key={u.user_id} value={u.user_id}>{u.display_name || u.user_id?.slice(0, 8)}</option>
          ))}
        </select>
      </div>

      {selUser && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">Organization Access for <span className="text-gray-800">{user?.display_name || selUser.slice(0, 8)}</span></p>
            <span className="text-[10px] text-gray-400">{userOrgIds.size} of {allOrgs.length} orgs</span>
          </div>
          {msg && <p className={`text-xs ${msg.startsWith("User") ? "text-green-600" : "text-red-600"}`}>{msg}</p>}
          <div className="space-y-1">
            {allOrgs.map(o => {
              const isMember = userOrgIds.has(o.id);
              const role = (user?.orgs || []).find((uo: any) => uo.id === o.id)?.role;
              return (
                <div key={o.id} className={`flex items-center justify-between rounded px-3 py-2 ${isMember ? "bg-gray-50" : "bg-white border border-gray-100"}`}>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-gray-300 text-white flex items-center justify-center text-[8px] font-bold">{o.name[0]}</div>
                    <div>
                      <p className="text-xs font-medium text-gray-800">{o.name}</p>
                      {role && <p className="text-[10px] text-gray-400">Role: {role}</p>}
                    </div>
                  </div>
                  <button onClick={() => toggleOrgAccess(o.id, !isMember)} disabled={busyOrg === o.id}
                    className={`flex items-center gap-1 text-xs rounded px-2 py-1 font-medium disabled:opacity-50 ${isMember ? "text-red-500 hover:bg-red-50 border border-red-200" : "text-green-600 hover:bg-green-50 border border-green-200"}`}>
                    {busyOrg === o.id ? <Loader2 size={10} className="animate-spin" /> : isMember ? <X size={10} /> : <Plus size={10} />}
                    {isMember ? "Remove" : "Add"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ========== USER ACCESS TAB ========== */
function UserAccessTab() {
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [allOrgs, setAllOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Grant form state
  const [grantUserId, setGrantUserId] = useState("");
  const [grantOrgId, setGrantOrgId] = useState("");
  const [grantRole, setGrantRole] = useState("viewer");
  const [granting, setGranting] = useState(false);

  // Table data (all user-org assignments)
  const [assignments, setAssignments] = useState<any[]>([]);

  // Edit inline
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [deletingRow, setDeletingRow] = useState<string | null>(null);

  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");

  function buildAssignments(users: any[], orgs: any[]) {
    const rows: any[] = [];
    for (const u of users) {
      for (const o of (u.orgs || [])) {
        const org = orgs.find((x: any) => x.id === o.id);
        rows.push({
          key: u.user_id + "|" + o.id,
          user_id: u.user_id,
          display_name: u.display_name || u.email || u.user_id.slice(0, 8),
          email: u.email || "",
          org_id: o.id,
          org_name: org?.name || o.name || o.id.slice(0, 8),
          org_industry: org?.industry || "",
          role: o.role || "viewer",
          is_platform_admin: u.is_platform_admin,
        });
      }
    }
    rows.sort((a, b) => a.display_name.localeCompare(b.display_name));
    return rows;
  }

  async function loadData() {
    setLoading(true);
    try {
      const [uRes, oRes] = await Promise.all([
        fetchAllUsers().catch(() => ({ items: [] })),
        fetchAllOrgs().catch(() => ({ items: [] })),
      ]);
      const users = uRes?.items || [];
      const orgs = oRes?.items || [];
      setAllUsers(users);
      setAllOrgs(orgs);
      setAssignments(buildAssignments(users, orgs));
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function handleGrant() {
    if (!grantUserId || !grantOrgId) return;
    setGranting(true); setMsg("");
    try {
      await addUserToOrg(grantOrgId, grantUserId, grantRole);
      setMsg("Access granted");
      setGrantUserId(""); setGrantOrgId(""); setGrantRole("viewer");
      await loadData();
    } catch (e: any) { setMsg(e.message); }
    finally { setGranting(false); }
  }

  async function handleRoleUpdate(row: any, newRole: string) {
    setSavingRole(row.key); setMsg("");
    try {
      await updateMemberRole(row.org_id, row.user_id, newRole);
      setMsg("Role updated");
      await loadData();
    } catch (e: any) { setMsg(e.message); }
    finally { setSavingRole(null); }
  }

  async function handleRevoke(row: any) {
    setDeletingRow(row.key); setMsg("");
    try {
      await removeMember(row.org_id, row.user_id);
      setMsg("Access revoked");
      await loadData();
    } catch (e: any) { setMsg(e.message); }
    finally { setDeletingRow(null); }
  }

  const filtered = assignments.filter(r =>
    !search ||
    r.display_name.toLowerCase().includes(search.toLowerCase()) ||
    r.email.toLowerCase().includes(search.toLowerCase()) ||
    r.org_name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return <div className="text-xs text-gray-400 py-12 text-center"><Loader2 size={14} className="animate-spin inline mr-1" />Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-800">User Access Management</h2>
        <p className="text-xs text-gray-400 mt-0.5">Grant, update, or revoke company access for users</p>
      </div>

      {/* Grant Access Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Grant Access</h3>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">User</label>
            <select value={grantUserId} onChange={e => setGrantUserId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white">
              <option value="">Select user...</option>
              {allUsers.map(u => (
                <option key={u.user_id} value={u.user_id}>{u.display_name || u.email || u.user_id.slice(0, 8)} {u.email ? `(${u.email})` : ""}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Company</label>
            <select value={grantOrgId} onChange={e => setGrantOrgId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white">
              <option value="">Select company...</option>
              {allOrgs.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div className="w-32">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Role</label>
            <select value={grantRole} onChange={e => setGrantRole(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white">
              <option value="viewer">Viewer</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button onClick={handleGrant} disabled={granting || !grantUserId || !grantOrgId}
            className="flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors">
            {granting ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
            Grant
          </button>
        </div>
        {msg && <p className={`text-xs mt-2 ${msg.includes("Error") || msg.includes("error") ? "text-red-600" : "text-green-600"}`}>{msg}</p>}
      </div>

      {/* Access Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Current Access ({assignments.length})</span>
          <div className="relative flex-1 max-w-xs">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Filter by user or company..."
              className="w-full rounded-lg border border-gray-100 pl-7 pr-2.5 py-1.5 text-xs outline-none focus:border-gray-300" />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-xs text-gray-400 py-10 text-center">
            {assignments.length === 0 ? "No access entries yet. Use the form above to grant access." : "No results match your filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-400">User</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-400">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-400">Company</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-400">Role</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(row => (
                  <tr key={row.key} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-500 to-gray-700 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                          {row.display_name[0]?.toUpperCase() || "?"}
                        </div>
                        <span className="font-medium text-gray-800">{row.display_name}</span>
                        {row.is_platform_admin && <span className="text-[8px] font-semibold bg-gray-800 text-white px-1 py-0.5 rounded">PA</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{row.email || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded bg-gray-200 flex items-center justify-center text-[8px] font-bold text-gray-600 shrink-0">
                          {row.org_name[0]?.toUpperCase() || "?"}
                        </div>
                        <span className="text-gray-700">{row.org_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select value={row.role} onChange={e => handleRoleUpdate(row, e.target.value)}
                        disabled={savingRole === row.key}
                        className="rounded border border-gray-200 px-2 py-1 text-[11px] bg-white outline-none focus:border-gray-400 disabled:opacity-50">
                        <option value="viewer">Viewer</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                      {savingRole === row.key && <Loader2 size={10} className="animate-spin inline ml-1" />}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleRevoke(row)} disabled={deletingRow === row.key}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50">
                        {deletingRow === row.key ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ----- Audit Trail (used by platform admin sidebar) -----
function AuditTab({ user }: { user: any }) {
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditError, setAuditError] = useState("");

  useEffect(() => {
    fetchAuditLog().then((res: any) => {
      setAuditLog(res?.items || []);
      setLoading(false);
    }).catch((e: any) => {
      setAuditError(e.message);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="text-xs text-gray-400 py-4"><Loader2 size={12} className="animate-spin inline mr-1" />Loading audit log...</div>;
  if (auditError) return <div className="text-xs text-red-500 py-4">Error: {auditError}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-800 flex items-center gap-1.5"><ClipboardList size={14} /> Audit Trail</p>
        <span className="text-[10px] text-gray-400">{auditLog.length} entries</span>
      </div>
      {auditLog.length === 0 ? (
        <p className="text-xs text-gray-400">No audit entries yet.</p>
      ) : (
        <div className="space-y-1">
          {auditLog.map((e: any, i: number) => (
            <div key={e.id || i} className="flex items-start gap-2 px-2 py-1.5 bg-gray-50 rounded">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium text-gray-700">{e.action?.replace(/_/g, " ")}</span>
                  <span className="text-[9px] text-gray-400">by {e.user_email || e.user_id?.slice(0, 8)}</span>
                </div>
                {e.details && <p className="text-[10px] text-gray-400 truncate">{typeof e.details === "string" ? e.details : JSON.stringify(e.details)}</p>}
                <p className="text-[9px] text-gray-300 mt-0.5">{e.created_at ? new Date(e.created_at).toLocaleString() : ""}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
