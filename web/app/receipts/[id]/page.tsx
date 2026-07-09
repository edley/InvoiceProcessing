"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, RefreshCw, DollarSign, User, Hash, Calendar, Mail, FileText, Building2, Shield, Edit3, AlertTriangle, CheckCircle, Save } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { getApiHeaders } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function ReceiptDetailPage() {
  const [user, setUser] = useState<any>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  useEffect(() => {
    if (!user || !id) return;
    load();
  }, [user, id]);

  async function load() {
    setLoading(true);
    try {
      const { orgId, userId, accessToken } = getApiHeaders();
      const h: Record<string, string> = { "X-User-Id": userId || "", "X-Org-Id": orgId || "" };
      if (accessToken) h["Authorization"] = `Bearer ${accessToken}`;

      const res = await fetch(`${API}/api/receipts/${id}`, { headers: h });
      const d = await res.json();
      setReceipt(d);
      setForm({
        amount: d.amount ?? "", currency: d.currency ?? "USD",
        payer_name: d.payer_name ?? "", bank_issuer: d.bank_issuer ?? "",
        receipt_number: d.receipt_number ?? "", payment_date: d.payment_date ?? "",
        description: d.description ?? "",
        purchase_currency: d.purchase_currency ?? "",
        transaction_currency: d.transaction_currency ?? "",
        transaction_amount: d.transaction_amount ?? "",
        card_number: d.card_number ?? "", card_type: d.card_type ?? "",
        payee: d.payee ?? "", address: d.address ?? "",
      });
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { orgId, userId, accessToken } = getApiHeaders();
      const h: Record<string, string> = { "Content-Type": "application/json", "X-User-Id": userId || "", "X-Org-Id": orgId || "" };
      if (accessToken) h["Authorization"] = `Bearer ${accessToken}`;

      const res = await fetch(`${API}/api/receipts/${id}`, {
        method: "PATCH",
        headers: h,
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Save failed");
      const d = await res.json();
      setReceipt(d);
      setEditing(false);
    } catch (e: any) { alert(e.message); } finally { setSaving(false); }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading...</div>;
  if (!receipt) return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Not found</div>;

  const f = (key: string) => form[key] ?? "";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-500 hover:text-gray-700"><ArrowLeft size={18} /></Link>
          <h1 className="text-lg font-semibold">Receipt Detail</h1>
        </div>
        <div className="flex items-center gap-2">
          {!editing && receipt.status === "review_needed" && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 bg-orange-50 rounded-lg px-3 py-1.5 border border-orange-200">
              <Edit3 size={14} /> Review & Edit
            </button>
          )}
          <button onClick={load} className="flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600"><RefreshCw size={14} /> Refresh</button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-6 space-y-5">
        {/* Confidence & Status */}
        <div className="flex items-center gap-3 flex-wrap">
          {receipt.confidence_score != null && (
            <span className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-full px-3 py-1.5 ${
              receipt.confidence_score >= 0.85 ? "bg-green-50 text-green-700 border border-green-200" :
              receipt.confidence_score >= 0.5 ? "bg-yellow-50 text-yellow-700 border border-yellow-200" :
              "bg-red-50 text-red-700 border border-red-200"
            }`}>
              <Shield size={14} /> Confidence: {Math.round(receipt.confidence_score * 100)}%
            </span>
          )}
          {receipt.status === "review_needed" && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 bg-orange-50 rounded-full px-3 py-1.5 border border-orange-200">
              <AlertTriangle size={14} /> Review Needed
            </span>
          )}
          {receipt.status === "synced" && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700 bg-green-50 rounded-full px-3 py-1.5 border border-green-200">
              <CheckCircle size={14} /> Synced to ERP
            </span>
          )}
        </div>

        {/* Extracted Data Card */}
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Extracted Data</h2>
            {editing ? (
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 border rounded-lg">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 text-sm text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg disabled:opacity-50">
                  <Save size={14} /> {saving ? "Saving..." : "Save"}
                </button>
              </div>
            ) : null}
          </div>

          {editing ? (
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                { label: "Amount", key: "amount", type: "number" },
                { label: "Currency", key: "currency", type: "text" },
                { label: "Payer Name", key: "payer_name", type: "text" },
                { label: "Bank Issuer", key: "bank_issuer", type: "text" },
                { label: "Receipt #", key: "receipt_number", type: "text" },
                { label: "Payment Date", key: "payment_date", type: "text" },
                { label: "Description", key: "description", type: "text" },
                { label: "Purchase Currency", key: "purchase_currency", type: "text" },
                { label: "Transaction Currency", key: "transaction_currency", type: "text" },
                { label: "Transaction Amount", key: "transaction_amount", type: "number" },
                { label: "Card Number", key: "card_number", type: "text" },
                { label: "Card Type", key: "card_type", type: "text" },
                { label: "Payee", key: "payee", type: "text" },
                { label: "Address", key: "address", type: "text" },
              ].map((field) => (
                <div key={field.key}>
                  <label className="block text-gray-500 mb-1">{field.label}</label>
                  <input
                    type={field.type}
                    value={f(field.key)}
                    onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2"><DollarSign size={16} className="text-green-600 shrink-0" /><div><dt className="text-gray-500">Amount</dt><dd className="font-medium text-lg">{receipt.amount ? `${Number(receipt.amount).toFixed(2)} ${receipt.currency}` : "-"}</dd></div></div>
              <div className="flex items-center gap-2"><User size={16} className="text-blue-600 shrink-0" /><div><dt className="text-gray-500">Payer</dt><dd className="font-medium">{receipt.payer_name || "-"}</dd></div></div>
              <div className="flex items-center gap-2"><Building2 size={16} className="text-purple-600 shrink-0" /><div><dt className="text-gray-500">Bank</dt><dd className="font-medium">{receipt.bank_issuer || "-"}</dd></div></div>
              <div className="flex items-center gap-2"><Hash size={16} className="text-orange-600 shrink-0" /><div><dt className="text-gray-500">Receipt #</dt><dd className="font-medium">{receipt.receipt_number || "-"}</dd></div></div>
              <div className="flex items-center gap-2"><FileText size={16} className="text-gray-600 shrink-0" /><div><dt className="text-gray-500">Description</dt><dd className="font-medium">{receipt.description || "-"}</dd></div></div>
              <div className="flex items-center gap-2"><Calendar size={16} className="text-red-600 shrink-0" /><div><dt className="text-gray-500">Payment Date</dt><dd className="font-medium">{receipt.payment_date || "-"}</dd></div></div>
              {receipt.purchase_currency && <div className="flex items-center gap-2"><DollarSign size={16} className="text-gray-600 shrink-0" /><div><dt className="text-gray-500">Purchase Currency</dt><dd>{receipt.purchase_currency}</dd></div></div>}
              {receipt.transaction_currency && <div className="flex items-center gap-2"><DollarSign size={16} className="text-gray-600 shrink-0" /><div><dt className="text-gray-500">Txn Currency</dt><dd>{receipt.transaction_currency}</dd></div></div>}
              {receipt.transaction_amount != null && <div className="flex items-center gap-2"><DollarSign size={16} className="text-gray-600 shrink-0" /><div><dt className="text-gray-500">Txn Amount</dt><dd>{Number(receipt.transaction_amount).toFixed(2)}</dd></div></div>}
              {receipt.card_number && <div className="flex items-center gap-2"><Building2 size={16} className="text-gray-600 shrink-0" /><div><dt className="text-gray-500">Card</dt><dd>{receipt.card_number}</dd></div></div>}
              {receipt.card_type && <div className="flex items-center gap-2"><Building2 size={16} className="text-gray-600 shrink-0" /><div><dt className="text-gray-500">Card Type</dt><dd>{receipt.card_type}</dd></div></div>}
              {receipt.payee && <div className="flex items-center gap-2"><User size={16} className="text-gray-600 shrink-0" /><div><dt className="text-gray-500">Payee</dt><dd>{receipt.payee}</dd></div></div>}
              {receipt.address && <div className="flex items-center gap-2"><FileText size={16} className="text-gray-600 shrink-0" /><div><dt className="text-gray-500">Address</dt><dd>{receipt.address}</dd></div></div>}
            </dl>
          )}
        </div>

        {/* Raw OCR Text */}
        {receipt.raw_text && (
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><FileText size={16} /> Raw OCR Text</h2>
            <pre className="text-xs text-gray-600 whitespace-pre-wrap max-h-64 overflow-y-auto bg-gray-50 p-3 rounded-lg border">{receipt.raw_text}</pre>
          </div>
        )}
      </main>
    </div>
  );
}
