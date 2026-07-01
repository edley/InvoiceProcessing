"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { fetchReceipts } from "@/lib/api";
import { ArrowLeft, RefreshCw, ExternalLink, DollarSign, User, Hash, Calendar, Building2, FileText } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

interface Receipt {
  id: string;
  receipt_number: string;
  amount: number;
  currency: string;
  payer_name: string;
  payer_email: string;
  payment_date: string;
  bank_issuer: string;
  description: string;
  status: string;
  created_at: string;
}

export default function ReceiptsPage() {
  const [user, setUser] = useState<any>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return; }
      setUser(session.user);
    });
  }, [router]);

  useEffect(() => {
    if (!user) return;
    loadReceipts();
  }, [user, statusFilter]);

  async function loadReceipts() {
    setLoading(true);
    try {
      const data = await fetchReceipts(statusFilter || undefined);
      setReceipts(data.items);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-gray-700"><ArrowLeft size={20} /></Link>
          <h1 className="text-xl font-semibold">Payment Receipts</h1>
        </div>
        <button onClick={loadReceipts} className="flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600">
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-4 flex gap-2">
          {["", "extracted", "synced", "failed"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-4 py-1 text-sm ${
                statusFilter === s ? "bg-blue-600 text-white" : "bg-white border text-gray-600 hover:bg-gray-50"
              }`}
            >
              {s || "All"}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : receipts.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No receipts found. Upload a payment proof first.</div>
        ) : (
          <div className="space-y-4">
            {receipts.map((r) => (
              <div key={r.id} className="rounded-lg border bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-4 text-sm">
                      {r.receipt_number && (
                        <span className="flex items-center gap-1 text-gray-600">
                          <Hash size={14} /> {r.receipt_number}
                        </span>
                      )}
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.status === "extracted" ? "bg-yellow-100 text-yellow-800" :
                        r.status === "synced" ? "bg-green-100 text-green-800" :
                        "bg-red-100 text-red-800"
                      }`}>
                        {r.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                      {r.amount && (
                        <span className="flex items-center gap-1 font-semibold text-lg">
                          <DollarSign size={16} className="text-green-600" />
                          {r.amount.toFixed(2)} {r.currency}
                        </span>
                      )}
                      {r.payer_name && (
                        <span className="flex items-center gap-1 text-gray-600">
                          <User size={14} /> {r.payer_name}
                        </span>
                      )}
                      {r.bank_issuer && (
                        <span className="flex items-center gap-1 text-gray-600">
                          <Building2 size={14} /> {r.bank_issuer}
                        </span>
                      )}
                      {r.description && (
                        <span className="flex items-center gap-1 text-gray-600">
                          <FileText size={14} /> {r.description}
                        </span>
                      )}
                      {r.payment_date && (
                        <span className="flex items-center gap-1 text-gray-600">
                          <Calendar size={14} /> {r.payment_date}
                        </span>
                      )}
                    </div>
                  </div>
                  <Link href={`/receipts/${r.id}`} className="text-blue-600 hover:text-blue-800 ml-4">
                    <ExternalLink size={16} />
                  </Link>
                </div>
                <div className="mt-2 text-xs text-gray-400">{formatDate(r.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
