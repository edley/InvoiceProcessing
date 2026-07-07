"use client";

import { useEffect, useState, useRef, useCallback, Fragment } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { uploadProof, updateReceipt, runReconciliation, fetchReconciliationStats, fetchReconciliationResults, fetchReconciliationProgress, overrideReclassification, manualMatch, fetchAccountingEntries, createAccountingEntry, updateAccountingEntry, deleteAccountingEntry, fetchProcessingLogs } from "@/lib/api";
import {
  Upload, FileText, Receipt, LogOut, RefreshCw, DollarSign, User, Hash, Calendar,
  Building2, CheckCircle, AlertCircle, UploadCloud, Edit3, Shield, AlertTriangle,
  ChevronDown, ChevronRight, Save, X, Loader2, Search, ExternalLink, BarChart3, Scale, Flag, Grip,
  Settings, ClipboardList, Menu, Database, Plus, Trash2, Filter, Check, History, Eye, ListChecks, UserCheck, Copy
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TABS = ["Dashboard", "Upload", "Proofs", "Receipts", "Reconciliation", "Forensic", "Entries", "Logs"] as const;
type Tab = typeof TABS[number];

const SIDEBAR_ITEMS: { key: Tab; label: string; icon: any }[] = [
  { key: "Dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "Upload", label: "Upload", icon: UploadCloud },
  { key: "Proofs", label: "Proofs", icon: FileText },
  { key: "Receipts", label: "Receipts", icon: Receipt },
  { key: "Reconciliation", label: "Reconciliation", icon: Scale },
  { key: "Entries", label: "Entries", icon: Database },
  { key: "Forensic", label: "Forensic", icon: Shield },
  { key: "Logs", label: "Processing Log", icon: ClipboardList },
];

const STEP_LABELS: Record<string, string> = {
  uploaded: "Uploading", ocr: "Extracting text", llm_primary: "AI extraction",
  llm_fallback: "AI fallback", regex: "Regex extraction", routing: "Saving result", done: "Complete",
};

export default function HomePage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [filterState, setFilterState] = useState<string>("");
  const [tabKey, setTabKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
      setLoading(false);
    });
  }, [router]);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => { if (e.matches) setMobileMenuOpen(false); };
    handler(mql);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  function handleTabClick(key: Tab) {
    setTab(key);
    setMobileMenuOpen(false);
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading...</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Mobile header bar */}
      <header className="md:hidden flex items-center justify-between px-4 h-14 bg-white/80 backdrop-blur-md border-b border-gray-200/60 sticky top-0 z-20 shadow-sm">
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-1.5 transition-colors">
          <Menu size={20} />
        </button>
        <span className="text-base font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">AI-Tolmai</span>
        <button onClick={() => setShowSettings(true)}
          className="text-gray-400 hover:text-indigo-600 hover:bg-gray-100 rounded-lg p-1.5 transition-colors">
          <Settings size={18} />
        </button>
      </header>

      {/* Mobile drawer overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 h-14 border-b border-gray-100">
              <span className="text-base font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">AI-Tolmai</span>
              <button onClick={() => setMobileMenuOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <nav className="py-2 space-y-0.5 px-2 overflow-y-auto flex-1">
              {SIDEBAR_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = tab === item.key;
                return (
                  <button key={item.key} onClick={() => handleTabClick(item.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-all ${
                      active ? "bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 font-semibold shadow-sm border border-indigo-100/60" : "text-gray-500 hover:text-gray-700 hover:bg-gray-50/80"
                    }`}>
                    <Icon size={17} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="px-2 pb-3 space-y-0.5 border-t border-gray-100 pt-2">
              <button onClick={() => { setShowSettings(true); setMobileMenuOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-50/80">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                  {user.email?.[0]?.toUpperCase() || "U"}
                </div>
                <span className="truncate text-xs text-gray-600">{user.email}</span>
              </button>
              <button onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50/50">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"><LogOut size={17} /></div>
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className={`hidden md:flex ${sidebarOpen ? "w-56" : "w-14"} bg-white/80 backdrop-blur-md border-r border-gray-200/60 flex-col transition-all duration-300 sticky top-0 h-screen shadow-sm`}>
        <div className="flex items-center gap-2 px-4 h-14 border-b border-gray-100 shrink-0">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1.5 transition-colors">
            <Menu size={18} />
          </button>
          {sidebarOpen && (
            <span className="text-base font-bold tracking-tight bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              AI-Tolmai
            </span>
          )}
        </div>
        <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button key={item.key} onClick={() => setTab(item.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-all duration-200 ${
                  active
                    ? "bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 font-semibold shadow-sm border border-indigo-100/60"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50/80"
                }`}>
                <div className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                  active ? "bg-white shadow-sm text-indigo-600" : "text-gray-400"
                }`}>
                  <Icon size={17} />
                </div>
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-gray-100">
          <button onClick={() => setShowSettings(true)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-all duration-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50/80 ${sidebarOpen ? "" : "justify-center"}`}>
            <div className="shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-[10px] font-bold">
              {user.email?.[0]?.toUpperCase() || "U"}
            </div>
            {sidebarOpen && <span className="truncate text-xs text-gray-600 flex-1 text-left">{user.email}</span>}
          </button>
          <button onClick={handleLogout}
            className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-all duration-200 text-gray-400 hover:text-red-600 hover:bg-red-50/50 ${sidebarOpen ? "" : "justify-center"}`}>
            <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"><LogOut size={17} /></div>
            {sidebarOpen && <span className="truncate">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Desktop header + Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="hidden md:flex bg-white/80 backdrop-blur-md px-4 lg:px-6 py-3 border-b border-gray-200/60 items-center justify-between sticky top-0 z-10 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800">{SIDEBAR_ITEMS.find(i => i.key === tab)?.label || tab}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 hidden lg:inline">{user.email}</span>
            <div className="h-4 w-px bg-gray-200 hidden lg:block" />
            <button onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-600 bg-gray-50 hover:bg-indigo-50 rounded-lg px-2.5 py-1.5 transition-colors">
              <Settings size={13} /> <span className="hidden sm:inline">Settings</span>
            </button>
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-600 bg-gray-50 hover:bg-red-50 rounded-lg px-2.5 py-1.5 transition-colors">
              <LogOut size={13} /> <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 mx-auto w-full max-w-6xl px-3 sm:px-4 lg:px-6 py-4 sm:py-6 pb-20 md:pb-6">
          {tab === "Dashboard" && <DashboardTab user={user} onNavigate={(t: Tab, f?: string) => { setFilterState(f || ""); setTabKey(k => k + 1); setTab(t); }} />}
          {tab === "Upload" && <UploadTab user={user} />}
          {tab === "Proofs" && <ProofsTab key={`p-${tabKey}`} initialFilter={filterState} />}
          {tab === "Receipts" && <ReceiptsTab key={`r-${tabKey}`} initialFilter={filterState} user={user} />}
          {tab === "Reconciliation" && <ReconciliationTab key={`rec-${tabKey}`} initialFilter={filterState} />}
          {tab === "Forensic" && <ForensicTab />}
          {tab === "Entries" && <AccountingEntriesTab />}
          {tab === "Logs" && <ProcessingLogTab />}
        </main>
      </div>

      {showSettings && <SettingsModal user={user} onClose={() => setShowSettings(false)} />}

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 bg-white/90 backdrop-blur-md border-t border-gray-200/60 flex items-center justify-around px-1 pb-safe-or-0" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {SIDEBAR_ITEMS.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button key={item.key} onClick={() => setTab(item.key)}
              className={`flex flex-col items-center gap-0.5 py-2 px-2 min-w-0 ${active ? "text-indigo-600" : "text-gray-400"}`}>
              <Icon size={18} />
              <span className="text-[9px] font-medium leading-none truncate max-w-full">{item.label}</span>
            </button>
          );
        })}
        {SIDEBAR_ITEMS.length > 5 && (
          <button onClick={() => setMobileMenuOpen(true)}
            className="flex flex-col items-center gap-0.5 py-2 px-2 text-gray-400">
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
    fetch(`${API}/api/settings`).then(r => r.json()).then(data => {
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
        headers: { "Content-Type": "application/json" },
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

/* ========== ACCOUNTING ENTRIES TAB ========== */
function AccountingEntriesTab() {
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
          <button onClick={startCreate} className="flex items-center gap-1 text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"><Plus size={14} />Add Entry</button>
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
                      <button onClick={() => startEdit(e)} className="text-gray-400 hover:text-blue-600 p-1" title="Select"><Check size={14} /></button>
                      <button onClick={() => startEdit(e)} className="text-gray-400 hover:text-amber-600 p-1" title="Amend"><Edit3 size={14} /></button>
                      {confirmDelete === e.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleDelete(e.id)} className="text-red-600 hover:text-red-800 p-1" title="Confirm Delete"><Check size={14} /></button>
                          <button onClick={() => setConfirmDelete(null)} className="text-gray-400 hover:text-gray-600 p-1" title="Cancel"><X size={14} /></button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(e.id)} className="text-gray-400 hover:text-red-600 p-1" title="Delete"><Trash2 size={14} /></button>
                      )}
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

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

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
          fetch(`${API}/api/logs?proof_id=${id}&page=1&page_size=5`),
          fetch(`${API}/api/proofs/${id}`),
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
    if (!files.length) return;
    setUploading(true);
    setError("");
    setUploadResults([]);
    setUploadIndex(0);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setUploadIndex(i);
      setUploadResults(prev => [...prev, { name: f.name, status: "uploading" }]);
      setProgress(5);
      setCurrentStep("uploaded");
      try {
        const res = await uploadProof(f, user.id);
        await new Promise<void>((resolve) => {
          const pid = res.id;
          const interval = setInterval(async () => {
            try {
              const proofRes = await fetch(`${API}/api/proofs/${pid}`);
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
        setUploadResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: "failed" } : r));
        setError(err.message);
      }
    }
    setFiles([]);
    setUploading(false);
    setProofId(null);
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
          <button onClick={handleUpload}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 shadow-sm hover:shadow-md transition-all">
            <UploadCloud size={16} />
            Upload & Process {files.length > 1 ? `(${files.length} files)` : ""}
          </button>
        </div>
      )}

      {/* Progress indicator */}
      {uploading && currentStep !== "done" && (
        <div className="mt-6 rounded-2xl border bg-white p-6 shadow-lg">
          {/* Animated icon + progress ring */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative shrink-0">
              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="24" fill="none" stroke="#e5e7eb" strokeWidth="4" />
                <circle cx="28" cy="28" r="24" fill="none" stroke="url(#progGrad)" strokeWidth="4"
                  strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 24}`}
                  strokeDashoffset={`${2 * Math.PI * 24 * (1 - progress / 100)}`}
                  className="transition-all duration-700 ease-out" />
                <defs>
                  <linearGradient id="progGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#6366f1" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 size="20" className="text-indigo-500 animate-spin" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-700">
                Processing {uploadIndex + 1} of {files.length}
              </p>
              <p className="text-xs text-indigo-600 font-medium mt-0.5">
                {STEP_LABELS_LOCAL[currentStep] || "Processing..."}
              </p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-indigo-600">{Math.round(progress)}%</div>
              <div className="text-[10px] text-gray-400">complete</div>
            </div>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-1">
            {["uploaded","ocr","llm_primary","routing"].map((s, i) => {
              const isActive = currentStep === s;
              const isDone = ["uploaded","ocr","llm_primary","routing"].indexOf(currentStep) > i;
              return (
                <div key={s} className="flex-1 flex items-center gap-1">
                  <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all ${
                    isDone ? "bg-indigo-500 text-white" :
                    isActive ? "bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300" :
                    "bg-gray-100 text-gray-400"
                  }`}>
                    {isDone ? <Check size={12} /> : i + 1}
                  </div>
                  {i < 3 && <div className={`flex-1 h-0.5 rounded ${isDone ? "bg-indigo-400" : "bg-gray-200"}`} />}
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
function DashboardTab({ user, onNavigate }: { user: any; onNavigate: (tab: Tab, filter?: string) => void }) {
  const [ds, setDs] = useState<any>(null);
  const [docTypeStats, setDocTypeStats] = useState<Record<string, number>>({});
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [forensicSummary, setForensicSummary] = useState<any>(null);

  useEffect(() => { loadStats(); }, [dateFrom, dateTo]);

  function dateParams() {
    const p = new URLSearchParams({ page: "1", page_size: "1" });
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    return p.toString();
  }

  async function loadStats() {
    try {
      const [dashData, fs, ...dtRes] = await Promise.all([
        fetch(`${API}/api/dashboard/stats`).then(r => r.json()),
        fetch(`${API}/api/forensic/summary`).then(r => r.json()).catch(() => null),
        ...["receipt","invoice","payment_proof","id","passport","driving_license","birth_certificate","other","unclassified"].map(
          dt => fetch(`${API}/api/proofs?document_type=${dt}&${dateParams()}`).then(r => r.json())
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

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Dashboard</h2>

      {/* Date filter */}
      <div className="flex items-center gap-3">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none" />
        <span className="text-xs text-gray-400">—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); }}
            className="text-xs text-gray-500 hover:text-red-600 px-2 py-1.5 border rounded-lg">Clear</button>
        )}
      </div>

      {/* Top stat cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Proofs", value: p.total, icon: FileText, color: "text-blue-600 bg-blue-50", tab: "Proofs" as Tab, filter: "" },
          { label: "Total Receipts", value: r.total, icon: Receipt, color: "text-purple-600 bg-purple-50", tab: "Receipts" as Tab, filter: "" },
          { label: "Needs Review", value: r.needing_review, icon: AlertTriangle, color: "text-orange-600 bg-orange-50", tab: "Receipts" as Tab, filter: "review_needed" },
          { label: "Pending Human", value: hi.total_pending, icon: UserCheck, color: "text-red-600 bg-red-50", tab: "Receipts" as Tab, filter: "review_needed" },
        ].map((s) => (
          <button key={s.label} onClick={() => s.tab && onNavigate(s.tab, s.filter)}
            className="rounded-xl border bg-white p-5 shadow-sm flex items-center gap-4 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all text-left">
            <div className={`rounded-lg p-3 ${s.color}`}><s.icon size={24} /></div>
            <div><div className="text-2xl font-bold">{s.value}</div><div className="text-xs text-gray-500">{s.label}</div></div>
          </button>
        ))}
      </div>

      {/* Progress & Fraud Summary */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Completion progress */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><CheckCircle size={15} className="text-green-500" /> Completion</h3>
            <span className="text-xs text-gray-400">{p.total} proofs</span>
          </div>
          <ProgressBar value={p.completed_pct} label="Processed" color="bg-green-500" />
          <ProgressBar value={r.reviewed_pct} label="Reviewed" color="bg-purple-500" />
        </div>

        {/* Fraud Detection */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Shield size={15} className="text-red-500" /> Fraud Detection</h3>
            <span className="text-xs text-gray-400">{rec.total} matched</span>
          </div>
          {rec.total > 0 ? (
            <div className="space-y-1.5">
              {[
                { key: "correct", label: "Correct", color: "bg-green-500", count: rec.by_classification?.correct || 0 },
                { key: "minor_mistake", label: "Minor Mistakes", color: "bg-yellow-400", count: rec.by_classification?.minor_mistake || 0 },
                { key: "potential_fraud", label: "Potential Fraud", color: "bg-orange-500", count: rec.by_classification?.potential_fraud || 0 },
                { key: "forensic_required", label: "Forensic Required", color: "bg-red-500", count: rec.by_classification?.forensic_required || 0 },
                { key: "fraud_detected", label: "Fraud Detected", color: "bg-red-700", count: rec.by_classification?.fraud_detected || 0 },
              ].map(({ key, label, color, count }) => (
                count > 0 && (
                  <button key={key} onClick={() => onNavigate("Reconciliation", key)}
                    className="w-full flex items-center gap-2 text-xs cursor-pointer hover:opacity-80">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
                    <span className="flex-1 text-gray-600">{label}</span>
                    <span className="font-medium text-gray-800">{count}</span>
                    <div className="text-[10px] text-gray-400 w-8 text-right">{Math.round(count / rec.total * 100)}%</div>
                  </button>
                )
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Run reconciliation to see results</p>
          )}
        </div>
      </div>

      {/* Audit Coverage */}
      {r.total > 0 && (
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><History size={15} className="text-indigo-500" /> Audit Trail Coverage</h3>
            <span className="text-xs text-gray-400">{r.total} receipts</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${audit.coverage_pct}%` }} />
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500">
                <span>{audit.receipts_with_audit} with audit trail</span>
                <span>{audit.receipts_without_audit} without</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-2xl font-bold text-indigo-600">{audit.coverage_pct}%</div>
              <div className="text-[10px] text-gray-400">coverage</div>
            </div>
          </div>
        </div>
      )}

      {/* Human in the Loop — Intervention Required */}
      {hi.total_pending > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/40 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="rounded-lg p-2 bg-red-100 text-red-600"><UserCheck size={18} /></div>
            <div>
              <h3 className="text-sm font-semibold text-red-800">Human Intervention Required</h3>
              <p className="text-xs text-red-600">{hi.total_pending} items need your attention</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Receipts to Review", value: hi.receipts_needing_review, icon: Eye, tab: "Receipts" as Tab, filter: "review_needed", color: "bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200" },
              { label: "Potential Fraud", value: hi.potential_fraud, icon: Flag, tab: "Reconciliation" as Tab, filter: "potential_fraud", color: "bg-red-100 text-red-700 border-red-200 hover:bg-red-200" },
              { label: "Forensic Required", value: hi.forensic_required, icon: Search, tab: "Reconciliation" as Tab, filter: "forensic_required", color: "bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-200" },
            ].filter(c => c.value > 0).map(c => (
              <button key={c.label} onClick={() => onNavigate(c.tab, c.filter)}
                className={`rounded-xl border p-4 text-left cursor-pointer transition-all hover:shadow-sm ${c.color} bg-opacity-50`}>
                <div className="flex items-center gap-2 mb-1">
                  <c.icon size={16} />
                  <span className="text-xs font-semibold">{c.label}</span>
                </div>
                <div className="text-2xl font-bold">{c.value}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Forensic Summary Card */}
      {fs.total_flags > 0 && (
        <div className="rounded-xl border bg-gradient-to-r from-indigo-50 to-violet-50 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg p-2 bg-indigo-100 text-indigo-600"><Shield size={18} /></div>
              <div>
                <h3 className="text-sm font-semibold text-indigo-900">Forensic Analysis</h3>
                <p className="text-xs text-indigo-600">{fs.total_flags} total flags</p>
              </div>
            </div>
            <button onClick={() => onNavigate("Forensic" as Tab)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-white px-3 py-1.5 rounded-lg border border-indigo-200 hover:bg-indigo-50 transition-all">
              View Details →
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { label: "Benford", value: fs.by_type?.benford || 0, color: "text-blue-600" },
              { label: "Duplicates", value: fs.by_type?.duplicate || 0, color: "text-orange-600" },
              { label: "Anomalies", value: fs.by_type?.anomaly || 0, color: "text-red-600" },
            ].filter(s => s.value > 0).map(s => (
              <div key={s.label} className="bg-white/80 rounded-lg p-3 text-center border border-indigo-100">
                <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
          {fs.high_risk > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
              <AlertTriangle size={12} />
              <span>{fs.high_risk} high-risk flag{fs.high_risk > 1 ? "s" : ""} require immediate attention</span>
            </div>
          )}
        </div>
      )}

      {/* Document type distribution */}
      {Object.keys(docTypeStats).length > 0 && (
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Document Types</h3>
            <span className="text-xs text-gray-400">{Object.values(docTypeStats).reduce((a, b) => a + b, 0)} total</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(docTypeStats).map(([dt, count]) => (
              <button key={dt} onClick={() => onNavigate("Proofs", dt)}
                className={`rounded-full px-3 py-1 text-xs font-medium cursor-pointer hover:shadow-sm transition-all ${
                  ["receipt","invoice","payment_proof"].includes(dt)
                    ? "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                    : "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100"
                }`}>
                {dt.replace(/_/g, " ")}: {count}
              </button>
            ))}
          </div>
        </div>
      )}
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

/* ========== FORENSIC TAB ========== */
function ForensicTab() {
  const [benford, setBenford] = useState<any>(null);
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
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
      const [sum, ben, dupRes, anomRes] = await Promise.all([
        fetch(`${API}/api/forensic/summary`).then(r => r.json()),
        fetch(`${API}/api/forensic/benford`).then(r => r.json()),
        fetch(`${API}/api/forensic/duplicates?page=1&page_size=50`).then(r => r.json()),
        fetch(`${API}/api/forensic/anomalies?page=1&page_size=50`).then(r => r.json()),
      ]);
      setSummary(sum);
      setBenford(ben);
      setDuplicates(dupRes.items || []);
      setDupTotal(dupRes.total_groups || 0);
      setAnomalies(anomRes.items || []);
      setAnomTotal(anomRes.total || 0);
    } catch (_) {}
    setLoading(false);
  }

  function loadRuns() {
    fetch(`${API}/api/forensic/runs?page=1&page_size=5`).then(r => r.json()).then(d => {
      setRuns(d.items || []);
    }).catch(() => {});
  }

  function startPolling() {
    pollRef.current = setInterval(async () => {
      try {
        const p = await fetch(`${API}/api/forensic/progress`).then(r => r.json());
        setProgress(p);
        if (p.status === "completed" || p.status === "failed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setRunning(false);
          loadData();
          loadRuns();
        }
      } catch (_) {}
    }, 1000);
  }

  async function handleRun() {
    setRunning(true);
    setProgress({ status: "running", progress: 0, current_step: "Starting...", message: "" });
    try {
      await fetch(`${API}/api/forensic/run`, { method: "POST" });
      startPolling();
    } catch (e: any) {
      setRunning(false);
      setProgress({ status: "failed", progress: 0, current_step: "Failed to start", message: e.message });
    }
  }

  function loadMoreAnomalies(page: number) {
    setAnomPage(page);
    fetch(`${API}/api/forensic/anomalies?page=${page}&page_size=50`).then(r => r.json()).then(d => {
      setAnomalies(d.items || []);
      setAnomTotal(d.total || 0);
    }).catch(() => {});
  }

  function loadMoreDuplicates(page: number) {
    setDupPage(page);
    fetch(`${API}/api/forensic/duplicates?page=${page}&page_size=50`).then(r => r.json()).then(d => {
      setDuplicates(d.items || []);
      setDupTotal(d.total_groups || 0);
    }).catch(() => {});
  }

  const isRunning = running || progress.status === "running";

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Shield size={22} className="text-indigo-600" />
            Forensic Analysis
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Benford's Law &middot; Duplicate Detection &middot; Anomaly Scoring</p>
        </div>
        <button onClick={handleRun} disabled={isRunning}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-5 py-2.5 text-sm font-medium hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all">
          {isRunning ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Running...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Run Full Analysis
            </>
          )}
        </button>
      </div>

      {/* Animated Progress Bar */}
      {isRunning && (
        <div className="mb-6 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 p-5 shadow-sm">
          <div className="flex items-center gap-4 mb-3">
            <div className="relative">
              <svg className="w-10 h-10 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#e0e7ff" strokeWidth="3" />
                <circle cx="12" cy="12" r="10" stroke="#6366f1" strokeWidth="3"
                  strokeDasharray={`${2 * Math.PI * 10}`}
                  strokeDashoffset={`${2 * Math.PI * 10 * (1 - progress.progress / 100)}`}
                  strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-semibold text-indigo-900">{progress.current_step || "Initializing..."}</span>
                <span className="text-xs font-medium text-indigo-600">{progress.progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-indigo-200 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
                  style={{ width: `${Math.min(progress.progress, 100)}%` }} />
              </div>
              {progress.message && (
                <p className="text-xs text-gray-500 mt-1.5 truncate">{progress.message}</p>
              )}
            </div>
          </div>
          {/* Gear icons */}
          <div className="flex items-center justify-center gap-6 text-indigo-400">
            {["Benford's Law", "Duplicates", "Anomalies"].map((step, i) => {
              const stepProgress = progress.progress || 0;
              const active = stepProgress > i * 30 && stepProgress <= (i + 1) * 30;
              const done = stepProgress > (i + 1) * 30;
              return (
                <div key={step} className={`flex items-center gap-1.5 text-xs transition-all ${done ? "text-green-600" : active ? "text-indigo-600 font-semibold scale-105" : "text-gray-400"}`}>
                  <svg className={`w-4 h-4 ${active ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  {done ? <CheckCircle size={14} /> : null}
                  {step}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {summary && !isRunning && (
        <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
          {[
            { label: "Total Flags", value: summary.total_flags, color: "text-indigo-600 bg-indigo-50", icon: Shield },
            { label: "Benford Flags", value: summary.by_type?.benford || 0, color: "text-blue-600 bg-blue-50", icon: BarChart3 },
            { label: "Duplicate Groups", value: summary.by_type?.duplicate || 0, color: "text-orange-600 bg-orange-50", icon: Copy },
            { label: "High Risk", value: summary.high_risk, color: "text-red-600 bg-red-50", icon: AlertTriangle },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border bg-white p-5 shadow-sm flex items-center gap-4">
              <div className={`rounded-lg p-3 ${s.color}`}><s.icon size={24} /></div>
              <div><div className="text-2xl font-bold">{s.value}</div><div className="text-xs text-gray-500">{s.label}</div></div>
            </div>
          ))}
        </div>
      )}

      {/* Section Tabs */}
      {!isRunning && summary && summary.total_flags > 0 && (
        <div className="mb-4 flex gap-1.5 flex-wrap">
          {[
            { key: "benford", label: "Benford's Law", count: summary.by_type?.benford || 0 },
            { key: "duplicates", label: "Duplicates", count: summary.by_type?.duplicate || 0 },
            { key: "anomalies", label: "Anomalies", count: summary.by_type?.anomaly || 0 },
          ].map((s) => (
            <button key={s.key} onClick={() => setActiveSection(s.key)}
              className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
                activeSection === s.key ? "bg-indigo-600 text-white shadow-sm" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}>
              {s.label} {s.count > 0 && <span className="ml-1 opacity-70">({s.count})</span>}
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !isRunning && summary?.total_flags === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
          <Shield size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-600 mb-1">No forensic flags yet</p>
          <p className="text-xs text-gray-400 mb-4">Run a forensic analysis to detect anomalies, duplicates, and Benford's Law violations</p>
          <button onClick={handleRun} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-indigo-700 shadow-sm transition-all">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Run Analysis
          </button>
        </div>
      )}

      {/* Benford's Law */}
      {!loading && activeSection === "benford" && benford?.items?.length > 0 && (
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">Benford's Law — First Digit Distribution</h3>
            {benford.items[0]?.details && (
              <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${
                Math.abs((benford.items[0]?.details?.deviation_pct || 0)) > 50 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
              }`}>
                Deviation: {benford.items[0]?.details?.deviation_pct?.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="space-y-2">
            {[1,2,3,4,5,6,7,8,9].map(d => {
              const expected = 100 * Math.log10(1 + 1/d);
              const obsItems = benford.items.filter((i: any) => i.details?.digit === d);
              const observed = obsItems.length > 0 ? obsItems[0].details?.observed_pct || 0 : expected;
              const isFlagged = obsItems.length > 0;
              const deviation = observed - expected;
              return (
                <div key={d} className={`rounded-lg p-3 ${isFlagged ? "bg-red-50/50 border border-red-100" : "bg-gray-50"}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-700 w-4">d={d}</span>
                      <span className="text-[10px] text-gray-400">Benford: {expected.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">Observed: <strong className={isFlagged ? "text-red-600" : "text-gray-700"}>{observed.toFixed(1)}%</strong></span>
                      {isFlagged && <span className="text-[10px] font-medium text-red-600">{deviation > 0 ? "+" : ""}{deviation.toFixed(1)}%</span>}
                    </div>
                  </div>
                  <div className="h-4 rounded-full bg-gray-100 overflow-hidden relative">
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
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Duplicate Payment Groups</h3>
            <span className="text-xs text-gray-400">{dupTotal} groups</span>
          </div>
          <div className="divide-y">
            {duplicates.map((g: any) => (
              <div key={g.group_id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <div className="rounded-full bg-orange-100 text-orange-700 px-2.5 py-0.5 text-[10px] font-medium">
                    {g.size} receipts
                  </div>
                  <span className="text-xs text-gray-400 font-mono">{(g.group_id || "").slice(0, 8)}</span>
                </div>
                <div className="space-y-2">
                  {g.members?.map((m: any) => (
                    <div key={m.id} className="flex items-center gap-3 text-xs bg-gray-50 rounded-lg p-2.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                      <span className="font-medium text-gray-700 w-20 truncate">{m.receipt?.receipt_number || "—"}</span>
                      <span className="text-gray-600 w-24 truncate">{m.receipt?.payer_name || "—"}</span>
                      <span className="font-semibold text-gray-800 w-20">
                        {m.receipt?.amount != null ? Number(m.receipt.amount).toLocaleString() : "—"}
                      </span>
                      <span className="text-gray-400">{m.receipt?.payment_date || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {dupTotal > 50 && (
            <div className="flex items-center justify-center gap-2 p-3 border-t">
              <button disabled={dupPage <= 1} onClick={() => loadMoreDuplicates(dupPage - 1)}
                className="text-xs px-3 py-1.5 border rounded-lg hover:bg-gray-50 disabled:opacity-30">Previous</button>
              <span className="text-xs text-gray-400">Page {dupPage} of {Math.ceil(dupTotal / 50)}</span>
              <button disabled={dupPage >= Math.ceil(dupTotal / 50)} onClick={() => loadMoreDuplicates(dupPage + 1)}
                className="text-xs px-3 py-1.5 border rounded-lg hover:bg-gray-50 disabled:opacity-30">Next</button>
            </div>
          )}
        </div>
      )}

      {/* Anomalies */}
      {!loading && activeSection === "anomalies" && anomalies.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Anomaly Scored Receipts</h3>
            <span className="text-xs text-gray-400">{anomTotal} flags</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-gray-500 font-medium">
                  <th className="px-4 py-3">Risk</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Receipt #</th>
                  <th className="px-4 py-3">Payer</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Flag</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((a: any) => {
                  const score = a.score || 0;
                  const riskColor = score >= 0.8 ? "bg-red-100 text-red-700" : score >= 0.5 ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-700";
                  return (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${score >= 0.8 ? "bg-red-500" : score >= 0.5 ? "bg-orange-500" : "bg-yellow-500"}`} />
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${riskColor}`}>
                            {score >= 0.8 ? "High" : score >= 0.5 ? "Medium" : "Low"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-gray-100">
                            <div className={`h-full rounded-full ${score >= 0.8 ? "bg-red-500" : score >= 0.5 ? "bg-orange-500" : "bg-yellow-500"}`}
                              style={{ width: `${score * 100}%` }} />
                          </div>
                          <span className="text-gray-600 w-8">{(score * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{a.receipt?.receipt_number || "—"}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[120px] truncate">{a.receipt?.payer_name || "—"}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">
                        {a.receipt?.amount != null ? Number(a.receipt.amount).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{a.receipt?.payment_date || "—"}</td>
                      <td className="px-4 py-3 max-w-[200px] truncate text-gray-500" title={a.flag}>{a.flag || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {anomTotal > 50 && (
            <div className="flex items-center justify-center gap-2 p-3 border-t">
              <button disabled={anomPage <= 1} onClick={() => loadMoreAnomalies(anomPage - 1)}
                className="text-xs px-3 py-1.5 border rounded-lg hover:bg-gray-50 disabled:opacity-30">Previous</button>
              <span className="text-xs text-gray-400">Page {anomPage} of {Math.ceil(anomTotal / 50)}</span>
              <button disabled={anomPage >= Math.ceil(anomTotal / 50)} onClick={() => loadMoreAnomalies(anomPage + 1)}
                className="text-xs px-3 py-1.5 border rounded-lg hover:bg-gray-50 disabled:opacity-30">Next</button>
            </div>
          )}
        </div>
      )}

      {/* Recent Runs */}
      {runs.length > 0 && !isRunning && (
        <div className="mt-6 rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Analysis Runs</h3>
          <div className="space-y-2">
            {runs.map((r: any) => (
              <div key={r.id} className="flex items-center gap-3 text-xs bg-gray-50 rounded-lg p-3">
                <div className={`w-2 h-2 rounded-full ${r.status === "completed" ? "bg-green-500" : r.status === "failed" ? "bg-red-500" : "bg-yellow-500"}`} />
                <span className="text-gray-500 capitalize">{r.status}</span>
                <span className="text-gray-400">
                  {r.results?.total_flags != null ? `${r.results.total_flags} flags · ` : ""}
                </span>
                <span className="text-gray-400">
                  {r.results?.total_receipts != null ? `${r.results.total_receipts} receipts · ` : ""}
                </span>
                <span className="text-gray-400 ml-auto">
                  {r.completed_at ? new Date(r.completed_at).toLocaleString() : r.started_at ? new Date(r.started_at).toLocaleString() : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && !isRunning && (
        <div className="text-center py-12 text-sm text-gray-500">
          <Loader2 size={20} className="animate-spin inline mr-2" />
          Loading forensic data...
        </div>
      )}
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
      const res = await fetch(`${API}/api/proofs?${p}`);
      const d = await res.json();
      setProofs(d.items || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  async function toggleExpand(proofId: string) {
    if (expandedId === proofId) { setExpandedId(null); return; }
    setExpandedId(proofId);
    if (!receipts[proofId]) {
      try {
        const res = await fetch(`${API}/api/receipts?page=1&page_size=100`);
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
      const res = await fetch(`${API}/api/receipts?${p}`);
      const d = await res.json();
      setReceipts(d.items || []);
    } catch (e) { console.error("loadReceipts error:", e); } finally { setLoading(false); }
  }

  async function loadAudit(receiptId: string) {
    setAuditLoading(true);
    setAuditReceiptId(receiptId);
    try {
      const res = await fetch(`${API}/api/receipts/${receiptId}/audit`);
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
                      <button onClick={() => startEdit(r)} className="text-gray-400 hover:text-blue-600 p-1" title="Select"><Check size={14} /></button>
                      <button onClick={() => startEdit(r)} className="text-gray-400 hover:text-amber-600 p-1" title="Amend"><Edit3 size={14} /></button>
                      <button onClick={() => loadAudit(r.id)} className="text-gray-400 hover:text-indigo-600 p-1" title="Audit Trail"><History size={14} /></button>
                      {confirmDelete === r.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => {
                            updateReceipt(r.id, { status: "failed" }, user?.id).then(() => { setConfirmDelete(null); loadReceipts(); });
                          }} className="text-red-600 hover:text-red-800 p-1" title="Confirm"><Check size={14} /></button>
                          <button onClick={() => setConfirmDelete(null)} className="text-gray-400 hover:text-gray-600 p-1" title="Cancel"><X size={14} /></button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(r.id)} className="text-gray-400 hover:text-red-600 p-1" title="Delete"><Trash2 size={14} /></button>
                      )}
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
  const [classFilter, setClassFilter] = useState(initialFilter || "");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [allEntries, setAllEntries] = useState<any[]>([]);
  const [progress, setProgress] = useState<any>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => { loadData(); }, [classFilter]);

  async function loadData() {
    setLoading(true);
    try {
      const [statsRes, resultsRes, accRes] = await Promise.all([
        fetchReconciliationStats(),
        fetchReconciliationResults(classFilter ? { classification: classFilter } : undefined),
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
        const pr = await fetch(`${API}/api/receipts?${p}`);
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

      {/* Classification filters */}
      <div className="mb-4 flex gap-2 flex-wrap items-center">
        {CLASS_FILTERS.map((c) => (
          <button key={c} onClick={() => setClassFilter(c)}
            className={`rounded-full px-3 py-1 text-xs ${classFilter === c ? "bg-blue-600 text-white" : "bg-white border text-gray-600 hover:bg-gray-50"}`}>
            {c ? c.replace(/_/g, " ") : "All"}
          </button>
        ))}
        <span className="text-xs text-gray-400 ml-auto">{results.length} results</span>
      </div>

      {/* Table */}
      {loading ? <div className="text-center py-8 text-sm text-gray-500"><Loader2 size={16} className="animate-spin inline mr-2" />Loading...</div>
      : results.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 p-8 text-center">
          <Scale size={32} className="mx-auto text-blue-300 mb-3" />
          <h3 className="text-lg font-semibold text-blue-800 mb-1">No reconciliation results yet</h3>
          <p className="text-sm text-blue-600 mb-4">Upload proofs and add accounting entries, then run reconciliation to cross-reference them.</p>
          <div className="flex items-center justify-center gap-2 text-xs text-blue-500">
            <span className="inline-flex items-center gap-1"><FileText size={12} /> {stats.total ?? 0} existing results</span>
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
                <th className="px-3 py-2.5 whitespace-nowrap">Classification</th>
                <th className="px-3 py-2.5 whitespace-nowrap w-10 text-center">Expand</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const isOpen = expandedId === r.id;
                const proof = r.proof_receipt_id ? proofsById[r.proof_receipt_id] : null;
                const entry = r.accounting_entry_id ? entriesById[r.accounting_entry_id] : null;
                const isUnmatched = r.match_type === "unmatched_proof" || r.match_type === "unmatched_entry";
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
                      <td className="px-3 py-2.5 whitespace-nowrap">{classBadge(r.classification)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-center text-gray-400">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50">
                        <td colSpan={9} className="px-5 py-4 border-b space-y-4">
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
