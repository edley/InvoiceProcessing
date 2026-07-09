"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { uploadProof, getApiHeaders } from "@/lib/api";
import { Upload, CheckCircle, AlertCircle, ArrowLeft, Shield, AlertTriangle, Receipt, DollarSign, User, Building2, Hash, Loader2 } from "lucide-react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const STEPS = [
  { key: "uploaded", label: "Uploading", pct: 10 },
  { key: "ocr", label: "Extracting text", pct: 30 },
  { key: "llm_primary", label: "AI extraction", pct: 60 },
  { key: "llm_fallback", label: "AI fallback", pct: 60 },
  { key: "regex", label: "Regex extraction", pct: 60 },
  { key: "routing", label: "Saving result", pct: 85 },
  { key: "done", label: "Complete", pct: 100 },
];

export default function UploadPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const pollRef = useRef<any>(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
      setLoading(false);
    });
  }, [router]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type === "application/pdf") setFile(f);
    else setError("Only PDF files are accepted");
  }, []);

  function apiHeaders(): Record<string, string> {
    const { orgId, userId, accessToken } = getApiHeaders();
    const h: Record<string, string> = {};
    if (orgId) h["X-Org-Id"] = orgId;
    if (userId) h["X-User-Id"] = userId;
    if (accessToken) h["Authorization"] = `Bearer ${accessToken}`;
    return h;
  }

  function startPolling(proofId: string) {
    setCurrentStep("uploaded");
    setProgress(10);

    pollRef.current = setInterval(async () => {
      try {
        const [logsRes, proofRes] = await Promise.all([
          fetch(`${API}/api/logs?proof_id=${proofId}&page=1&page_size=5`, { headers: apiHeaders() }),
          fetch(`${API}/api/proofs/${proofId}`, { headers: apiHeaders() }),
        ]);
        if (!logsRes.ok || !proofRes.ok) return;
        const logs = (await logsRes.json()).items || [];
        const proof = await proofRes.json();

        const stages = logs.map((l: any) => l.stage);
        let step = "uploaded";

        if (stages.includes("ocr")) step = "ocr";
        if (stages.includes("llm_primary") || stages.includes("llm_fallback") || stages.includes("regex")) step = "llm_primary";
        if (stages.includes("routing")) step = "routing";

        const found = STEPS.find((s) => s.key === step);
        if (found) { setCurrentStep(found.key); setProgress(found.pct); }

        if (proof.status === "completed" || proof.status === "review_needed" || proof.status === "failed") {
          clearInterval(pollRef.current!);
          setProgress(100);
          setCurrentStep("done");

          const receiptRes = await fetch(`${API}/api/receipts?page=1&page_size=50`, { headers: apiHeaders() });
          const receipts = (await receiptRes.json()).items || [];
          const match = receipts.find((r: any) => r.proof_id === proofId);

          setResult({
            id: proofId,
            status: proof.status,
            receipt: match || null,
            confidence: proof.extracted_data?.confidence ?? null,
            error: proof.error_message,
          });
        }
      } catch (_) {}
    }, 2500);
  }

  async function handleUpload() {
    if (!file || !user) return;
    setUploading(true);
    setError("");
    setProgress(5);
    try {
      const res = await uploadProof(file);
      startPolling(res.id);
    } catch (err: any) {
      setError(err.message);
      setUploading(false);
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
  if (!user) return null;

  const hasResult = result && (result.status === "completed" || result.status === "review_needed" || result.status === "failed");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-gray-500 hover:text-gray-700"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-semibold">Upload Payment Proof</h1>
      </header>

      <main className="mx-auto max-w-lg px-6 py-12">
        {hasResult ? (
          <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
            {result.receipt ? (
              <>
                <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />
                <h2 className="text-lg font-semibold mb-1">Upload & Extracted</h2>
                <p className="text-xs text-gray-400 mb-4">ID: {result.id}</p>
                {result.receipt.amount && (
                  <div className="inline-flex items-center gap-2 text-2xl font-bold text-gray-800 mb-3">
                    <DollarSign size={22} className="text-green-600" />
                    {Number(result.receipt.amount).toFixed(2)} {result.receipt.currency}
                  </div>
                )}
                <div className="flex flex-wrap justify-center gap-2 mb-4">
                  {result.receipt.payer_name && <span className="text-sm text-gray-600 flex items-center gap-1"><User size={14} /> {result.receipt.payer_name}</span>}
                  {result.receipt.bank_issuer && <span className="text-sm text-gray-600 flex items-center gap-1"><Building2 size={14} /> {result.receipt.bank_issuer}</span>}
                  {result.receipt.receipt_number && <span className="text-sm text-gray-600 flex items-center gap-1"><Hash size={14} /> {result.receipt.receipt_number}</span>}
                </div>
                {result.confidence != null && (
                  <div className="flex justify-center mb-4">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-3 py-1 ${
                      result.confidence >= 0.85 ? "bg-green-50 text-green-700 border border-green-200" :
                      result.confidence >= 0.5 ? "bg-yellow-50 text-yellow-700 border border-yellow-200" :
                      "bg-red-50 text-red-700 border border-red-200"
                    }`}>
                      <Shield size={12} /> Confidence: {Math.round(result.confidence * 100)}%
                    </span>
                  </div>
                )}
                <Link href="/" className="inline-block text-blue-600 hover:underline text-sm">Back to Dashboard</Link>
              </>
            ) : (
              <>
                {result.status === "failed" ? <AlertCircle size={48} className="mx-auto text-red-500 mb-4" /> : <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />}
                <h2 className="text-lg font-semibold mb-2">{result.status === "failed" ? "Processing Failed" : "Upload Successful"}</h2>
                <p className="text-sm text-gray-500 mb-4">ID: {result.id}</p>
                {result.error && <p className="text-sm text-orange-600 mb-4">{result.error}</p>}
                <Link href="/" className="text-blue-600 hover:underline text-sm">Back to Dashboard</Link>
              </>
            )}
          </div>
        ) : uploading ? (
          <div className="rounded-xl border bg-white p-10 shadow-sm">
            <div className="flex flex-col items-center gap-6">
              <Loader2 size={40} className="animate-spin text-blue-600" />
              <div className="w-full space-y-3">
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">
                    {STEPS.find((s) => s.key === currentStep)?.label || "Processing..."}
                  </span>
                  <span className="text-gray-400 font-medium">{progress}%</span>
                </div>
                <div className="flex flex-wrap gap-1.5 justify-center mt-2">
                  {STEPS.filter((s) => s.key !== "done").map((s) => {
                    const done = STEPS.indexOf(s) <= STEPS.findIndex((x) => x.key === currentStep);
                    return (
                      <span key={s.key} className={`text-xs px-2 py-0.5 rounded-full border ${
                        done ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-50 text-gray-400 border-gray-200"
                      }`}>
                        {done ? "✓" : "○"} {s.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              className={`rounded-lg border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${
                dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400"
              }`}
            >
              <Upload size={40} className="mx-auto text-gray-400 mb-4" />
              <p className="text-sm text-gray-600 mb-2">Drag & drop a PDF here</p>
              <p className="text-xs text-gray-400">or</p>
              <label className="mt-2 inline-block cursor-pointer rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                Browse Files
                <input type="file" accept=".pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>
              {file && <p className="mt-4 text-sm text-gray-700">Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>}
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded bg-red-50 p-3 text-sm text-red-600">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="w-full rounded bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? "Processing..." : "Upload & Process"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
