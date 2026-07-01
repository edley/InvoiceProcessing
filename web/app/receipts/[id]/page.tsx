"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useParams } from "next/navigation";
import { fetchReceipt } from "@/lib/api";
import { ArrowLeft, RefreshCw, DollarSign, User, Hash, Calendar, Mail, FileText, Building2 } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

export default function ReceiptDetailPage() {
  const [user, setUser] = useState<any>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const params = useParams();
  const receiptId = params.id as string;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  useEffect(() => {
    if (!user || !receiptId) return;
    loadReceipt();
  }, [user, receiptId]);

  async function loadReceipt() {
    setLoading(true);
    try {
      const data = await fetchReceipt(receiptId);
      setReceipt(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
  if (!receipt) return <div className="flex min-h-screen items-center justify-center">Not found</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/receipts" className="text-gray-500 hover:text-gray-700"><ArrowLeft size={20} /></Link>
          <h1 className="text-xl font-semibold">Receipt Details</h1>
        </div>
        <button onClick={loadReceipt} className="flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600">
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Extracted Data</h2>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <DollarSign size={16} className="text-green-600" />
              <div><dt className="text-gray-500">Amount</dt><dd className="font-medium text-lg">{receipt.amount ? `${receipt.amount.toFixed(2)} ${receipt.currency}` : "-"}</dd></div>
            </div>
            <div className="flex items-center gap-2">
              <User size={16} className="text-blue-600" />
              <div><dt className="text-gray-500">Payer</dt><dd className="font-medium">{receipt.payer_name || "-"}</dd></div>
            </div>
            <div className="flex items-center gap-2">
              <Hash size={16} className="text-purple-600" />
              <div><dt className="text-gray-500">Receipt #</dt><dd className="font-medium">{receipt.receipt_number || "-"}</dd></div>
            </div>
            <div className="flex items-center gap-2">
              <Mail size={16} className="text-orange-600" />
              <div><dt className="text-gray-500">Email</dt><dd className="font-medium">{receipt.payer_email || "-"}</dd></div>
            </div>
            <div className="flex items-center gap-2">
              <Building2 size={16} className="text-red-600" />
              <div><dt className="text-gray-500">Bank</dt><dd className="font-medium">{receipt.bank_issuer || "-"}</dd></div>
            </div>
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-gray-600" />
              <div><dt className="text-gray-500">Description</dt><dd className="font-medium">{receipt.description || "-"}</dd></div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-red-600" />
              <div><dt className="text-gray-500">Payment Date</dt><dd className="font-medium">{receipt.payment_date || "-"}</dd></div>
            </div>
            <div>
              <dt className="text-gray-500">Status</dt>
              <dd>
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  receipt.status === "extracted" ? "bg-yellow-100 text-yellow-800" :
                  receipt.status === "synced" ? "bg-green-100 text-green-800" :
                  "bg-red-100 text-red-800"
                }`}>
                  {receipt.status}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        {receipt.raw_text && (
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FileText size={16} /> Raw OCR Text
            </h2>
            <pre className="text-xs text-gray-600 whitespace-pre-wrap max-h-64 overflow-y-auto bg-gray-50 p-3 rounded">
              {receipt.raw_text}
            </pre>
          </div>
        )}
      </main>
    </div>
  );
}
