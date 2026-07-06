const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function uploadProof(file: File, tenantId: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("tenant_id", tenantId);

  const res = await fetch(`${API_URL}/api/upload`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function fetchProofs(status?: string, page = 1) {
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  const res = await fetch(`${API_URL}/api/proofs?${params}`);
  if (!res.ok) throw new Error("Failed to fetch proofs");
  return res.json();
}

export async function fetchProof(proofId: string) {
  const res = await fetch(`${API_URL}/api/proofs/${proofId}`);
  if (!res.ok) throw new Error("Failed to fetch proof");
  return res.json();
}

export async function fetchReceipts(status?: string, page = 1) {
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  const res = await fetch(`${API_URL}/api/receipts?${params}`);
  if (!res.ok) throw new Error("Failed to fetch receipts");
  return res.json();
}

export async function fetchReceipt(receiptId: string) {
  const res = await fetch(`${API_URL}/api/receipts/${receiptId}`);
  if (!res.ok) throw new Error("Failed to fetch receipt");
  return res.json();
}

export async function syncProofToErp(proofId: string) {
  const res = await fetch(`${API_URL}/api/proofs/${proofId}/sync`, { method: "POST" });
  if (!res.ok) throw new Error("Sync failed");
  return res.json();
}

export async function updateReceipt(receiptId: string, data: Record<string, any>) {
  const res = await fetch(`${API_URL}/api/receipts/${receiptId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Update failed");
  return res.json();
}

// --- Reconciliation API ---

export async function runReconciliation() {
  const res = await fetch(`${API_URL}/api/reconciliation/run`, { method: "POST" });
  if (!res.ok) throw new Error("Reconciliation failed");
  return res.json();
}

export async function fetchReconciliationStats() {
  const res = await fetch(`${API_URL}/api/reconciliation/stats`);
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function fetchReconciliationResults(params?: { classification?: string; match_type?: string }) {
  const p = new URLSearchParams({ page: "1", page_size: "200" });
  if (params?.classification) p.set("classification", params.classification);
  if (params?.match_type) p.set("match_type", params.match_type);
  const res = await fetch(`${API_URL}/api/reconciliation/results?${p}`);
  if (!res.ok) throw new Error("Failed to fetch results");
  return res.json();
}

export async function overrideReclassification(resultId: string, data: { classification?: string; notes?: string; human_reviewed?: boolean }) {
  const res = await fetch(`${API_URL}/api/reconciliation/results/${resultId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Override failed");
  return res.json();
}

export async function manualMatch(data: { proof_receipt_id: string; accounting_entry_id?: string; notes?: string }) {
  const res = await fetch(`${API_URL}/api/reconciliation/match-manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Manual match failed");
  return res.json();
}

export async function createAccountingEntry(data: Record<string, any>) {
  const res = await fetch(`${API_URL}/api/accounting-entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Create failed");
  return res.json();
}

export async function fetchAccountingEntries() {
  const res = await fetch(`${API_URL}/api/accounting-entries?page=1&page_size=200`);
  if (!res.ok) throw new Error("Failed to fetch entries");
  return res.json();
}

export async function updateAccountingEntry(entryId: string, data: Record<string, any>) {
  const res = await fetch(`${API_URL}/api/accounting-entries/${entryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Update failed");
  return res.json();
}

export async function deleteAccountingEntry(entryId: string) {
  const res = await fetch(`${API_URL}/api/accounting-entries/${entryId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");
  return res.json();
}
