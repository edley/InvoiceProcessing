"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { uploadProof, updateReceipt, runReconciliation, fetchReconciliationStats, fetchReconciliationResults, overrideReclassification, manualMatch, fetchAccountingEntries } from "@/lib/api";
import {
  Upload, FileText, Receipt, LogOut, RefreshCw, DollarSign, User, Hash, Calendar,
  Building2, CheckCircle, AlertCircle, UploadCloud, Edit3, Shield, AlertTriangle,
  ChevronDown, ChevronRight, Save, X, Loader2, Search, ExternalLink, BarChart3, Scale, Flag, Grip
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TABS = ["Dashboard", "Proofs", "Receipts", "Reconciliation"] as const;
type Tab = typeof TABS[number];

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
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
      setLoading(false);
    });
  }, [router]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading...</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight">tolmaiERP</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{user.email}</span>
          <button onClick={handleLogout} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 transition-colors">
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </header>

      <div className="border-b bg-white px-6 flex sticky top-[49px] z-10">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t === "Dashboard" && <BarChart3 size={14} className="inline mr-1.5" />}
            {t === "Proofs" && <FileText size={14} className="inline mr-1.5" />}
            {t === "Receipts" && <Receipt size={14} className="inline mr-1.5" />}
            {t === "Reconciliation" && <Scale size={14} className="inline mr-1.5" />}
            {t}
          </button>
        ))}
      </div>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {tab === "Dashboard" && <DashboardTab user={user} onNavigate={(t: Tab, f?: string) => { setFilterState(f || ""); setTabKey(k => k + 1); setTab(t); }} />}
        {tab === "Proofs" && <ProofsTab key={`p-${tabKey}`} initialFilter={filterState} />}
        {tab === "Receipts" && <ReceiptsTab key={`r-${tabKey}`} initialFilter={filterState} />}
        {tab === "Reconciliation" && <ReconciliationTab />}
      </main>
    </div>
  );
}

/* ========== DASHBOARD TAB ========== */
function DashboardTab({ user, onNavigate }: { user: any; onNavigate: (tab: Tab, filter?: string) => void }) {
  const [stats, setStats] = useState({ proofs: 0, receipts: 0, review: 0, ready: 0 });
  const [docTypeStats, setDocTypeStats] = useState<Record<string, number>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [proofId, setProofId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [uploadResults, setUploadResults] = useState<{name: string; status: string}[]>([]);
  const [uploadIndex, setUploadIndex] = useState(0);
  const pollRef = useRef<any>(null);

  useEffect(() => {
    loadStats();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [dateFrom, dateTo]);

  function dateParams() {
    const p = new URLSearchParams({ page: "1", page_size: "1" });
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    return p.toString();
  }

  async function loadStats() {
    try {
      const [pr, rr, rv, rd, ...dtRes] = await Promise.all([
        fetch(`${API}/api/proofs?${dateParams()}`).then(r => r.json()),
        fetch(`${API}/api/receipts?${dateParams()}`).then(r => r.json()),
        fetch(`${API}/api/receipts?status=review_needed&${dateParams()}`).then(r => r.json()),
        fetch(`${API}/api/proofs?status=ready_to_process&${dateParams()}`).then(r => r.json()),
        ...["receipt","invoice","payment_proof","id","passport","driving_license","birth_certificate","other","unclassified"].map(
          dt => fetch(`${API}/api/proofs?document_type=${dt}&${dateParams()}`).then(r => r.json())
        ),
      ]);
      setStats({ proofs: pr.total || 0, receipts: rr.total || 0, review: rv.total || 0, ready: rd.total || 0 });
      const dtLabels = ["receipt","invoice","payment_proof","id","passport","driving_license","birth_certificate","other","unclassified"];
      const dtMap: Record<string, number> = {};
      dtRes.forEach((d, i) => { if (d.total > 0) dtMap[dtLabels[i]] = d.total; });
      setDocTypeStats(dtMap);
    } catch (_) {}
  }

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
          loadStats();
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
    loadStats();
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Dashboard</h2>
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Total Proofs", value: stats.proofs, icon: FileText, color: "text-blue-600 bg-blue-50", tab: "Proofs" as Tab, filter: "" },
          { label: "Total Receipts", value: stats.receipts, icon: Receipt, color: "text-purple-600 bg-purple-50", tab: "Receipts" as Tab, filter: "" },
          { label: "Needs Review", value: stats.review, icon: AlertTriangle, color: "text-orange-600 bg-orange-50", tab: "Receipts" as Tab, filter: "review_needed" },
          { label: "Ready to Process", value: stats.ready, icon: CheckCircle, color: "text-green-600 bg-green-50", tab: "Proofs" as Tab, filter: "ready_to_process" },
        ].map((s) => (
          <button key={s.label} onClick={() => onNavigate(s.tab, s.filter)}
            className="rounded-xl border bg-white p-5 shadow-sm flex items-center gap-4 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all text-left">
            <div className={`rounded-lg p-3 ${s.color}`}><s.icon size={24} /></div>
            <div><div className="text-2xl font-bold">{s.value}</div><div className="text-xs text-gray-500">{s.label}</div></div>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none" title="From date" />
        <span className="text-xs text-gray-400">—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none" title="To date" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); }}
            className="text-xs text-gray-500 hover:text-red-600 px-2 py-1.5 border rounded-lg">Clear</button>
        )}
      </div>

      {Object.keys(docTypeStats).length > 0 && (
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Document Types</h3>
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

      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><UploadCloud size={16} /> Upload Payment Proof</h3>
        {proofId && currentStep !== "done" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3"><Loader2 size={20} className="animate-spin text-blue-600" /><span className="text-sm text-gray-600">{STEP_LABELS[currentStep] || "Processing..."}</span></div>
            <div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-blue-600 h-2 rounded-full transition-all duration-500 ease-out" style={{ width: `${progress}%` }} /></div>
          </div>
        ) : (
          <div className="space-y-4">
            <div onDrop={(e) => { e.preventDefault(); setDragOver(false); setFiles(Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf")); if (Array.from(e.dataTransfer.files).some(f => f.type !== "application/pdf")) setError("Non-PDF files ignored"); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
              className={`rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400"}`}>
              <Upload size={32} className="mx-auto text-gray-400 mb-3" />
              <p className="text-sm text-gray-600 mb-1">Drag & drop PDFs here</p>
              <p className="text-xs text-gray-400 mb-3">or</p>
              <label className="inline-block cursor-pointer rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                Browse Files
                <input type="file" accept=".pdf" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
              </label>
              {files.length > 0 && (
                <div className="mt-3 space-y-1">
                  {files.map((f, i) => (
                    <p key={i} className="text-sm text-gray-700">{f.name} ({(f.size / 1024).toFixed(1)} KB)</p>
                  ))}
                </div>
              )}
            </div>
            {uploadResults.length > 0 && (
              <div className="space-y-1.5">
                {uploadResults.map((r, i) => (
                  <div key={i} className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
                    r.status === "done" ? "bg-green-50 text-green-700" :
                    r.status === "failed" ? "bg-red-50 text-red-600" :
                    r.status === "uploading" && i === uploadIndex ? "bg-blue-50 text-blue-700" :
                    "bg-gray-50 text-gray-500"
                  }`}>
                    {r.status === "done" ? <CheckCircle size={14} /> : r.status === "failed" ? <AlertCircle size={14} /> : <Loader2 size={14} className="animate-spin" />}
                    {r.name}
                  </div>
                ))}
              </div>
            )}
            {error && <div className="flex items-center gap-2 rounded bg-red-50 p-3 text-sm text-red-600"><AlertCircle size={16} /> {error}</div>}
            {uploading && (
              <div className="flex items-center gap-3"><Loader2 size={20} className="animate-spin text-blue-600" /><span className="text-sm text-gray-600">Processing {uploadIndex + 1} of {files.length}...</span></div>
            )}
            <button onClick={handleUpload} disabled={!files.length || uploading}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {uploading ? `Uploading ${uploadIndex + 1}/${files.length}...` : files.length > 0 ? `Upload ${files.length} PDF${files.length > 1 ? "s" : ""}` : "Upload & Process"}
            </button>
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
      const p = new URLSearchParams({ page: "1", page_size: "50" });
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
        const res = await fetch(`${API}/api/receipts?page=1&page_size=50`);
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
    pending: "bg-yellow-100 text-yellow-800", processing: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800", review_needed: "bg-orange-100 text-orange-800",
    failed: "bg-red-100 text-red-800", ready_to_process: "bg-emerald-100 text-emerald-800",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Proofs & Receipts</h2>
        <button onClick={loadProofs} className="text-sm text-gray-500 hover:text-blue-600"><RefreshCw size={14} className="inline mr-1" /> Refresh</button>
      </div>
      <div className="mb-4 flex gap-2 flex-wrap items-center">
        {["", "pending", "completed", "review_needed", "ready_to_process", "failed"].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs ${filter === s ? "bg-blue-600 text-white" : "bg-white border text-gray-600 hover:bg-gray-50"}`}>
            {s ? s.replace(/_/g, " ") : "All"}
          </button>
        ))}
      </div>
      <div className="mb-4 flex gap-2 flex-wrap items-center">
        <select value={docTypeFilter} onChange={e => setDocTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none bg-white">
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
        <div className="ml-auto flex items-center gap-2">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none" title="From date" />
          <span className="text-xs text-gray-400">—</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none" title="To date" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-xs text-gray-500 hover:text-red-600 px-2 py-1.5">Clear</button>
          )}
        </div>
      </div>
      {loading ? <div className="text-center py-8 text-sm text-gray-500">Loading...</div>
      : proofs.length === 0 ? <div className="text-center py-8 text-sm text-gray-500">No proofs found.</div>
      : <div className="space-y-2">
          {proofs.map((p) => {
            const isOpen = expandedId === p.id;
            const receipt = receipts[p.id];
            return (
              <div key={p.id} className={`rounded-xl border bg-white shadow-sm overflow-hidden ${isOpen ? "ring-1 ring-blue-200" : ""}`}>
                <button onClick={() => toggleExpand(p.id)} className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 text-left transition-colors">
                  <div className="shrink-0 text-gray-400">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{p.file_name}</div>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                      <span>{p.created_at ? new Date(p.created_at).toLocaleString() : ""}</span>
                      {p.processing_method && <span>· {p.processing_method.replace(/_/g, " ")}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      ["receipt","invoice","payment_proof"].includes(p.document_type)
                        ? "bg-blue-100 text-blue-800"
                        : p.document_type && p.document_type !== "unclassified"
                        ? "bg-gray-100 text-gray-600"
                        : "bg-gray-50 text-gray-400"
                    }`}>
                      {p.document_type ? p.document_type.replace(/_/g, " ") : "unclassified"}
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[p.status] || "bg-gray-100 text-gray-600"}`}>
                      {p.status?.replace(/_/g, " ")}
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${p.erp_status === "synced" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                      {p.erp_status}
                    </span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t bg-gray-50 px-5 py-4">
                    {receipt ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Receipt size={14} /> Receipt</h4>
                          {receipt.status === "review_needed" && editing !== receipt.id && (
                            <button onClick={() => { setEditing(receipt.id); setForm({
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
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { label: "Amount", key: "amount" },
                              { label: "Currency", key: "currency" },
                              { label: "Payer Name", key: "payer_name" },
                              { label: "Bank Issuer", key: "bank_issuer" },
                              { label: "Receipt #", key: "receipt_number" },
                              { label: "Payment Date", key: "payment_date" },
                              { label: "Description", key: "description" },
                              { label: "Purchase Currency", key: "purchase_currency" },
                              { label: "Transaction Currency", key: "transaction_currency" },
                              { label: "Transaction Amount", key: "transaction_amount" },
                              { label: "Card Number", key: "card_number" },
                              { label: "Card Type", key: "card_type" },
                              { label: "Payee", key: "payee" },
                              { label: "Address", key: "address" },
                            ].map((f) => (
                              <div key={f.key}>
                                <label className="block text-xs text-gray-500 mb-0.5">{f.label}</label>
                                <input type="text" value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                                  className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none" />
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
                          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                            {receipt.amount != null && <span className="flex items-center gap-1 font-semibold"><DollarSign size={14} className="text-green-600" /> {Number(receipt.amount).toFixed(2)} {receipt.currency}</span>}
                            {receipt.payer_name && <span className="flex items-center gap-1 text-gray-600"><User size={13} /> {receipt.payer_name}</span>}
                            {receipt.bank_issuer && <span className="flex items-center gap-1 text-gray-600"><Building2 size={13} /> {receipt.bank_issuer}</span>}
                            {receipt.receipt_number && <span className="flex items-center gap-1 text-gray-600"><Hash size={13} /> {receipt.receipt_number}</span>}
                            {receipt.payment_date && <span className="flex items-center gap-1 text-gray-600"><Calendar size={13} /> {receipt.payment_date}</span>}
                            {receipt.description && <span className="flex items-center gap-1 text-gray-600 truncate max-w-[200px]"><FileText size={13} /> {receipt.description}</span>}
                            {receipt.purchase_currency && <span className="flex items-center gap-1 text-gray-600"><DollarSign size={13} /> Purchase: {receipt.purchase_currency}</span>}
                            {receipt.transaction_currency && <span className="flex items-center gap-1 text-gray-600"><DollarSign size={13} /> Txn: {receipt.transaction_currency}</span>}
                            {receipt.transaction_amount != null && <span className="flex items-center gap-1 text-gray-600"><DollarSign size={13} /> Txn Amt: {Number(receipt.transaction_amount).toFixed(2)}</span>}
                            {receipt.card_number && <span className="flex items-center gap-1 text-gray-600"><Building2 size={13} /> {receipt.card_number}</span>}
                            {receipt.card_type && <span className="flex items-center gap-1 text-gray-600"><Building2 size={13} /> {receipt.card_type}</span>}
                            {receipt.payee && <span className="flex items-center gap-1 text-gray-600"><User size={13} /> Payee: {receipt.payee}</span>}
                            {receipt.address && <span className="flex items-center gap-1 text-gray-600 truncate max-w-[200px]" title={receipt.address}><FileText size={13} /> {receipt.address}</span>}
                            {receipt.confidence_score != null && (
                              <span className={`flex items-center gap-1 text-xs font-medium ${receipt.confidence_score >= 0.85 ? "text-green-600" : receipt.confidence_score >= 0.5 ? "text-yellow-600" : "text-red-600"}`}>
                                <Shield size={12} /> {Math.round(receipt.confidence_score * 100)}%
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-sm text-gray-400">
                        <FileText size={24} className="mx-auto mb-2 opacity-50" />
                        <p>No receipt extracted yet</p>
                        <p className="text-xs">The PDF may still be processing or extraction failed</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      }
    </div>
  );
}

/* ========== RECEIPTS TAB ========== */
function ReceiptsTab({ initialFilter = "" }: { initialFilter?: string }) {
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(initialFilter);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => { loadReceipts(); }, [filter]);

  async function loadReceipts() {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: "1", page_size: "50" });
      if (filter) p.set("status", filter);
      const res = await fetch(`${API}/api/receipts?${p}`);
      const d = await res.json();
      setReceipts(d.items || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

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
      const updated = await updateReceipt(receiptId, payload);
      setReceipts(prev => prev.map(r => r.id === receiptId ? updated : r));
      setEditingId(null);
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  }

  const filtered = search ? receipts.filter(r =>
    Object.values(r).some(v => String(v ?? "").toLowerCase().includes(search.toLowerCase()))
  ) : receipts;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Receipts</h2>
        <button onClick={loadReceipts} className="text-sm text-gray-500 hover:text-blue-600"><RefreshCw size={14} className="inline mr-1" /> Refresh</button>
      </div>
      <div className="mb-4 flex gap-2 flex-wrap items-center">
        {["", "extracted", "review_needed", "reviewed", "synced", "failed"].map((s) => (
          <button key={s} onClick={() => { setFilter(s); setEditingId(null); }}
            className={`rounded-full px-3 py-1 text-xs ${filter === s ? "bg-blue-600 text-white" : "bg-white border text-gray-600 hover:bg-gray-50"}`}>
            {s ? s.replace(/_/g, " ") : "All"}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-gray-300 pl-7 pr-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none w-40" />
        </div>
      </div>
      {loading ? <div className="text-center py-8 text-sm text-gray-500">Loading...</div>
      : filtered.length === 0 ? <div className="text-center py-8 text-sm text-gray-500">No receipts found.</div>
      : <div className="space-y-3">
          {filtered.map((r) => {
            const isEditing = editingId === r.id;
            const needsReview = r.status === "review_needed";
            return (
              <div key={r.id} className={`rounded-xl border bg-white p-5 shadow-sm transition-all ${needsReview ? "border-orange-300 ring-1 ring-orange-100" : ""}`}>
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-gray-700">Edit Receipt</h4>
                      <div className="flex gap-2">
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 px-3 py-1.5 border rounded-lg hover:bg-gray-50">Cancel</button>
                        <button onClick={() => handleSave(r.id, r)} disabled={saving}
                          className="flex items-center gap-1 text-xs text-white bg-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                          {saving ? "Saving..." : needsReview ? "Save & Mark Reviewed" : "Save"}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: "Amount", key: "amount" }, { label: "Currency", key: "currency" },
                        { label: "Payer Name", key: "payer_name" }, { label: "Bank Issuer", key: "bank_issuer" },
                        { label: "Receipt #", key: "receipt_number" }, { label: "Payment Date", key: "payment_date" },
                        { label: "Description", key: "description", span: true },
                        { label: "Purchase Currency", key: "purchase_currency" },
                        { label: "Transaction Currency", key: "transaction_currency" },
                        { label: "Transaction Amount", key: "transaction_amount" },
                        { label: "Card Number", key: "card_number" }, { label: "Card Type", key: "card_type" },
                        { label: "Payee", key: "payee" }, { label: "Address", key: "address" },
                      ].map((f) => (
                        <div key={f.key} className={f.span ? "col-span-full" : ""}>
                          <label className="block text-xs text-gray-500 mb-0.5">{f.label}</label>
                          <input type="text" value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                            className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {r.receipt_number && <span className="flex items-center gap-1 text-xs font-medium text-gray-700 bg-gray-100 rounded-full px-2 py-0.5"><Hash size={11} /> {r.receipt_number}</span>}
                        {confidenceBadge(r.confidence_score)}
                        {r.status === "review_needed" && <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 bg-orange-50 rounded-full px-2 py-0.5 border border-orange-200"><AlertTriangle size={11} /> Review Needed</span>}
                        {r.status === "reviewed" && <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 border border-emerald-200"><CheckCircle size={11} /> Reviewed</span>}
                        {r.status === "synced" && <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 rounded-full px-2 py-0.5"><CheckCircle size={11} /> Synced</span>}
                        {r.status === "extracted" && <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 rounded-full px-2 py-0.5"><Shield size={11} /> Extracted</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                        {r.amount != null && <span className="flex items-center gap-1 font-semibold text-base"><DollarSign size={15} className="text-green-600" /> {Number(r.amount).toFixed(2)} <span className="font-normal text-gray-500">{r.currency}</span></span>}
                        {r.payer_name && <span className="flex items-center gap-1 text-gray-600"><User size={13} /> {r.payer_name}</span>}
                        {r.bank_issuer && <span className="flex items-center gap-1 text-gray-600"><Building2 size={13} /> {r.bank_issuer}</span>}
                        {r.description && <span className="flex items-center gap-1 text-gray-600 truncate max-w-[220px]" title={r.description}><FileText size={13} /> {r.description}</span>}
                        {r.payment_date && <span className="flex items-center gap-1 text-gray-600"><Calendar size={13} /> {r.payment_date}</span>}
                        {r.purchase_currency && <span className="flex items-center gap-1 text-gray-600"><DollarSign size={13} /> Purchase: {r.purchase_currency}</span>}
                        {r.transaction_currency && <span className="flex items-center gap-1 text-gray-600"><DollarSign size={13} /> Txn: {r.transaction_currency}</span>}
                        {r.transaction_amount != null && <span className="flex items-center gap-1 text-gray-600"><DollarSign size={13} /> Txn Amt: {Number(r.transaction_amount).toFixed(2)}</span>}
                        {r.card_number && <span className="flex items-center gap-1 text-gray-600"><Building2 size={13} /> {r.card_number}</span>}
                        {r.card_type && <span className="flex items-center gap-1 text-gray-600"><Building2 size={13} /> {r.card_type}</span>}
                        {r.payee && <span className="flex items-center gap-1 text-gray-600"><User size={13} /> Payee: {r.payee}</span>}
                        {r.address && <span className="flex items-center gap-1 text-gray-600 truncate max-w-[220px]" title={r.address}><FileText size={13} /> {r.address}</span>}
                      </div>
                      {r.payment_proofs && (
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <ExternalLink size={10} /> Source: {r.payment_proofs.file_name}
                        </span>
                      )}
                      <div className="text-[11px] text-gray-400">{r.created_at ? new Date(r.created_at).toLocaleString() : ""}</div>
                    </div>
                    <div className="shrink-0 flex gap-1">
                      {(needsReview || filter === "review_needed") && (
                        <button onClick={() => startEdit(r)} className="rounded-lg p-2 bg-orange-50 text-orange-600 hover:bg-orange-100 transition-colors" title="Review & Edit">
                          <Edit3 size={16} />
                        </button>
                      )}
                      {!needsReview && (
                        <button onClick={() => startEdit(r)} className="rounded-lg p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Edit">
                          <Edit3 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      }
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

function ReconciliationTab() {
  const [results, setResults] = useState<any[]>([]);
  const [proofsById, setProofsById] = useState<Record<string, any>>({});
  const [entriesById, setEntriesById] = useState<Record<string, any>>({});
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [classFilter, setClassFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [allEntries, setAllEntries] = useState<any[]>([]);

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
      setResults(resultsRes.items || []);
      setAllEntries(accRes.items || []);

      const eMap: Record<string, any> = {};
      (accRes.items || []).forEach((e: any) => { eMap[e.id] = e; });
      setEntriesById(eMap);

      const proofIds = Array.from(new Set((resultsRes.items || []).map((r: any) => r.proof_receipt_id).filter(Boolean)));
      if (proofIds.length > 0) {
        const pMap: Record<string, any> = {};
        const p = new URLSearchParams({ page: "1", page_size: "200" });
        const pr = await fetch(`${API}/api/receipts?${p}`);
        const pd = await pr.json();
        (pd.items || []).forEach((r: any) => { pMap[r.id] = r; });
        setProofsById(pMap);
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  async function handleRun() {
    setRunning(true);
    try {
      await runReconciliation();
      await loadData();
    } catch (e: any) { alert(e.message); } finally { setRunning(false); }
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
    return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border ${color}`}>{label}</span>;
  }

  const CLASS_FILTERS = ["", "correct", "minor_mistake", "potential_fraud", "forensic_required", "fraud_detected"];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Reconciliation</h2>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="text-sm text-gray-500 hover:text-blue-600"><RefreshCw size={14} className="inline mr-1" /> Refresh</button>
          <button onClick={handleRun} disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {running ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />}
            {running ? "Running..." : "Run Reconciliation"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 mb-5 sm:grid-cols-6">
        {[
          { label: "Total", key: "total", color: "bg-gray-50 text-gray-700" },
          { label: "Correct", key: "correct", color: "bg-green-50 text-green-700" },
          { label: "Minor", key: "minor_mistake", color: "bg-yellow-50 text-yellow-700" },
          { label: "Potential Fraud", key: "potential_fraud", color: "bg-orange-50 text-orange-700" },
          { label: "Forensic", key: "forensic_required", color: "bg-red-50 text-red-700" },
          { label: "Fraud", key: "fraud_detected", color: "bg-red-100 text-red-800" },
        ].map((s) => (
          <div key={s.key} className={`rounded-lg border p-3 ${s.color}`}>
            <div className="text-xs opacity-70">{s.label}</div>
            <div className="text-xl font-bold">{stats[s.key] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex gap-2 flex-wrap items-center">
        {CLASS_FILTERS.map((c) => (
          <button key={c} onClick={() => setClassFilter(c)}
            className={`rounded-full px-3 py-1 text-xs ${classFilter === c ? "bg-blue-600 text-white" : "bg-white border text-gray-600 hover:bg-gray-50"}`}>
            {c ? c.replace(/_/g, " ") : "All"}
          </button>
        ))}
      </div>

      {loading ? <div className="text-center py-8 text-sm text-gray-500">Loading...</div>
      : results.length === 0 ? <div className="text-center py-8 text-sm text-gray-500">No results. Run reconciliation first.</div>
      : <div className="space-y-2">
          {results.map((r) => {
            const isOpen = expandedId === r.id;
            const proof = r.proof_receipt_id ? proofsById[r.proof_receipt_id] : null;
            const entry = r.accounting_entry_id ? entriesById[r.accounting_entry_id] : null;
            const isUnmatched = r.match_type === "unmatched_proof" || r.match_type === "unmatched_entry";
            return (
              <div key={r.id} className={`rounded-xl border bg-white shadow-sm overflow-hidden ${CLASS_COLORS[r.classification]?.replace("bg-", "ring-1 ring-").replace("border-", "").replace("100", "200").replace("200", "300") || ""}`}>
                <button onClick={() => setExpandedId(isOpen ? null : r.id)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 text-left transition-colors">
                  <div className="shrink-0 text-gray-400">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</div>
                  <div className="flex-1 min-w-0 grid grid-cols-5 gap-3 text-sm">
                    {isUnmatched ? (
                      <>
                        <span className="text-xs text-gray-400 col-span-2">{r.match_type === "unmatched_proof" ? "Proof has no accounting match" : "Accounting entry has no proof"}</span>
                        <span className="text-xs text-gray-400">{r.match_type.replace(/_/g, " ")}</span>
                      </>
                    ) : (
                      <>
                        <span className="truncate font-medium">{proof?.receipt_number || proof?.payer_name || "Proof"}</span>
                        <span className="truncate">{proof?.amount != null ? `${Number(proof.amount).toFixed(2)} ${proof.currency || ""}` : "—"}</span>
                        <span className="truncate">{entry?.receipt_number || entry?.vendor || "Entry"}</span>
                        <span className="truncate">{entry?.amount != null ? `${Number(entry.amount).toFixed(2)} ${entry.currency || ""}` : "—"}</span>
                        <span className="truncate">{r.amount_diff != null ? `${r.amount_diff >= 0 ? "+" : ""}${Number(r.amount_diff).toFixed(2)}` : "—"}</span>
                      </>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {r.matching_score != null && r.matching_score > 0 && (
                      <span className="text-xs text-gray-400">{(r.matching_score * 100).toFixed(0)}%</span>
                    )}
                    {classBadge(r.classification)}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t bg-gray-50 px-5 py-4 space-y-4">
                    {isUnmatched ? (
                      <div className="space-y-3">
                        <p className="text-sm text-gray-600">{r.match_type === "unmatched_proof" ? "This receipt has no matching entry in the accounting system." : "This accounting entry has no supporting proof document."}</p>
                        {r.match_type === "unmatched_proof" ? (
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
                        ) : (
                          <p className="text-xs text-gray-400">No action needed — the proof document for this entry was not uploaded.</p>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><Receipt size={14} /> Extracted from PDF</h4>
                          <div className="space-y-2 text-sm">
                            {["amount", "currency", "payer_name", "payment_date", "receipt_number", "description"].map((f) => {
                              const pv = proof?.[f];
                              const ev = entry?.[f];
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      }
    </div>
  );
}

function confidenceBadge(score: number | null) {
  if (score == null) return null;
  if (score >= 0.85) return <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 rounded-full px-2 py-0.5 border border-green-200"><Shield size={11} /> {Math.round(score * 100)}%</span>;
  if (score >= 0.5) return <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 bg-yellow-50 rounded-full px-2 py-0.5 border border-yellow-200"><AlertTriangle size={11} /> {Math.round(score * 100)}%</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 rounded-full px-2 py-0.5 border border-red-200"><AlertCircle size={11} /> {Math.round(score * 100)}%</span>;
}
