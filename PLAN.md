# tolmailERP — Invoice & Receipt Processing System

## 1. System Overview

Full-stack system to ingest, classify, extract, and manage financial documents (receipts, invoices, payment proofs, IDs, etc.) from multiple sources:

1. **Ingests** PDFs from web upload (multi-file drag & drop), WhatsApp (Meta Cloud API), and optionally email
2. **Classifies** documents by type (receipt/invoice/payment_proof/id/passport/etc.) — non-financial docs skip extraction
3. **Extracts** structured data via LLM (NVIDIA Llama 3.3 70B or OpenAI) with confidence scoring + regex fallback
4. **Routes** by confidence: auto-save (≥0.85), flag for review (0.5–0.85), fallback to regex (<0.5)
5. **Auto-syncs** extracted data to ERP system
6. **Provides** a single-page 3-tab web UI (Dashboard, Proofs & Receipts, Receipts) with inline editing

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│  Web Upload  │───▶│  FastAPI     │───▶│  Classify    │───▶│  Receipt         │
│  (multi-PDF) │    │  Backend     │    │  doc type    │    │  Pipeline        │
├──────────────┤    │  :8000       │    └──────┬───────┘    │  (OCR → LLM →    │
│  WhatsApp    │───▶│              │           │            │   Regex → ERP)   │
│  Webhook     │    │              │           ├─ receipt   │                  │
├──────────────┤    │              │           ├─ invoice   │  (future)        │
│  Email       │───▶│              │           ├─ id        │                  │
│  (future)    │    │              │           ├─ passport  │  Skip extraction │
└──────────────┘    └──────┬───────┘           └─ other     └──────────────────┘
                           │
                    ┌──────▼──────┐
                    │  Supabase   │
                    │  (DB +      │
                    │   Storage)  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Next.js UI │
                    │  (Vercel)   │
                    │  Dashboard  │
                    │  /Proofs    │
                    │  /Receipts  │
                    └─────────────┘
```

---

## 2. Current State — What's Built

### Backend (FastAPI)

| Component | File | Status |
|-----------|------|--------|
| PDF upload (single + multi-file) | `routers/upload.py` | ✅ Done |
| Proofs CRUD + date filtering + logs | `routers/proofs.py` | ✅ Done |
| Receipts CRUD + PATCH with auto-review | `routers/receipts.py` | ✅ Done |
| WhatsApp webhook (GET verify + POST receive) | `routers/whatsapp.py` | ✅ Done |
| Document classifier (LLM-based) | `services/document_classifier.py` | ✅ Done |
| Receipt processor (OCR → LLM → Regex → ERP) | `services/receipt_processor.py` | ✅ Done |
| LLM extractor (NVIDIA + OpenAI provider) | `services/llm_extractor.py` | ✅ Done |
| WhatsApp client (media download + send message) | `services/whatsapp_client.py` | ✅ Done |
| Auto-ERP sync in process_proof | `services/receipt_processor.py` | ✅ Done |
| Config / settings | `config.py` | ✅ Done |
| Supabase client | `supabase_client.py` | ✅ Done |
| App entry (FastAPI with CORS) | `main.py` | ✅ Done |

### Web App (Next.js 14, App Router)

| Feature | File | Status |
|---------|------|--------|
| Supabase Auth (email/password login) | `app/login/page.tsx` | ✅ Done |
| Single-page 3-tab app | `app/page.tsx` | ✅ Done |
| Dashboard tab — stat cards + date filter + multi-file upload | `app/page.tsx` | ✅ Done |
| Proofs tab — accordion rows + inline edit + doc type filter | `app/page.tsx` | ✅ Done |
| Receipts tab — full list + inline edit + search | `app/page.tsx` | ✅ Done |
| Receipt detail page (standalone) | `app/receipts/[id]/page.tsx` | ✅ Done |
| API client helpers | `lib/api.ts` | ✅ Done |
| Sticking stat cards → navigate to tab with filter | `app/page.tsx` | ✅ Done |
| Document type breakdown + filter on Dashboard | `app/page.tsx` | ✅ Done |
| Confidence badges (green/yellow/red) | `app/page.tsx` | ✅ Done |

### Database (Supabase / PostgreSQL)

| Table | Purpose | Status |
|-------|---------|--------|
| `payment_proofs` | Raw upload metadata, status, document_type, ERP info | ✅ Done |
| `proof_of_payment_receipt` | Extracted receipt data (13 fields + confidence) | ✅ Done |
| `processing_log` | Audit trail: OCR, LLM, classification, routing decisions | ✅ Done |

### Migrations

| File | Purpose |
|------|---------|
| `001-006` | Initial schema, status values |
| `007_add_reviewed_status.sql` | Adds `reviewed`/`ready_to_process` statuses |
| `008_add_receipt_fields.sql` | Adds purchase_currency, transaction_currency, transaction_amount, card_number, card_type, payee, address |
| `009_add_document_type.sql` | Adds document_type + document_type_confidence to payment_proofs |

---

## 3. Receipt Extraction Pipeline

```
Upload PDF
   │
   ├─→ Supabase Storage
   ├─→ payment_proofs insert (status: pending)
   └─→ Background thread: process_proof()
         │
         ├─ 1. OCR (pdfplumber) → raw text
         ├─ 2. Classify document type (LLM)
         │     ├─ receipt / invoice / payment_proof → continue
         │     ├─ id / passport / driving_license / birth_certificate / other → skip extraction, mark completed
         │     └─ unclassified → skip extraction
         │
         ├─ 3. LLM primary extraction (NVIDIA Llama 3.3 70B or OpenAI GPT-4o-mini)
         │     Fields: amount, currency, payer_name, bank_issuer, receipt_number,
         │     payment_date, description, purchase_currency, transaction_currency,
         │     transaction_amount, card_number, card_type, payee, address, confidence
         │
         ├─ 4. Confidence routing:
         │     ├─ ≥ 0.85 → auto-save (completed/extracted)
         │     ├─ 0.5–0.85 → flag for review (review_needed/review_needed)
         │     └─ < 0.5 → LLM fallback → still failing → regex fallback
         │
         ├─ 5. Insert proof_of_payment_receipt
         ├─ 6. Update payment_proofs.status + extracted_data + processing_method
         └─ 7. Auto-ERP sync: erp_status=synced, erp_receipt_id=ERP-{proof_id}
```

### LLM Provider Support

| Provider | Cost | Model | Config |
|----------|------|-------|--------|
| **NVIDIA** (default) | Free | `meta/llama-3.3-70b-instruct` | `LLM_PROVIDER=nvidia` |
| **OpenAI** | Paid | `gpt-4o-mini` | `LLM_PROVIDER=openai` |

Both use OpenAI-compatible client — only `base_url` and `model` differ.

### Document Types

| Type | Pipeline |
|------|----------|
| `receipt` | Full extraction |
| `invoice` | Full extraction |
| `payment_proof` | Full extraction |
| `id` | Skip — store only |
| `passport` | Skip — store only |
| `driving_license` | Skip — store only |
| `birth_certificate` | Skip — store only |
| `other` | Skip — store only |
| `unclassified` | Skip — store only |

---

## 4. Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python 3.11+ (FastAPI) |
| **Web App** | Next.js 14 (App Router) + Tailwind CSS |
| **Database** | Supabase (PostgreSQL + Storage + Auth) |
| **Auth** | Supabase Auth (email/password) |
| **OCR** | pdfplumber (text extraction from PDFs) |
| **LLM Extraction** | NVIDIA Llama 3.3 70B (free) or OpenAI GPT-4o-mini |
| **WhatsApp API** | Meta Cloud API (Graph API v22.0) |
| **Tunneling (dev)** | ngrok |
| **Icons** | lucide-react |

---

## 5. Supabase Schema

### `payment_proofs`

```sql
CREATE TABLE payment_proofs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path         TEXT NOT NULL,
  file_name         TEXT NOT NULL,
  file_size         BIGINT,
  mime_type         TEXT DEFAULT 'application/pdf',
  source            TEXT DEFAULT 'web_upload',
  status            TEXT DEFAULT 'pending',
  extracted_data    JSONB,
  processing_method TEXT,
  document_type     TEXT DEFAULT 'unclassified',
  document_type_confidence DOUBLE PRECISION,
  erp_status        TEXT DEFAULT 'pending',
  erp_receipt_id    TEXT,
  error_message     TEXT,
  tenant_id         TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### `proof_of_payment_receipt`

```sql
CREATE TABLE proof_of_payment_receipt (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id           UUID REFERENCES payment_proofs(id),
  receipt_number     TEXT,
  amount             DOUBLE PRECISION,
  currency           TEXT DEFAULT 'USD',
  payer_name         TEXT,
  bank_issuer        TEXT,
  description        TEXT,
  payment_date       TEXT,
  purchase_currency  TEXT,
  transaction_currency TEXT,
  transaction_amount DOUBLE PRECISION,
  card_number        TEXT,
  card_type          TEXT,
  payee              TEXT,
  address            TEXT,
  notes              TEXT,
  status             TEXT DEFAULT 'extracted',
  confidence_score   DOUBLE PRECISION,
  raw_text           TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
```

### `processing_log`

```sql
CREATE TABLE processing_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id   UUID REFERENCES payment_proofs(id),
  stage      TEXT,
  status     TEXT,
  message    TEXT,
  details    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Status Values

**payment_proofs.status**: `pending` | `processing` | `completed` | `review_needed` | `failed` | `ready_to_process`

**proof_of_payment_receipt.status**: `extracted` | `review_needed` | `reviewed` | `synced` | `failed` | `completed`

---

## 6. Project Structure

```
tolmaiERP/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                  # FastAPI entry, CORS, router registration
│   │   ├── config.py                # Pydantic settings from .env
│   │   ├── supabase_client.py       # Supabase client singleton
│   │   ├── routers/
│   │   │   ├── upload.py            # POST /api/upload (single + multi-file)
│   │   │   ├── proofs.py            # GET /api/proofs, GET /api/proofs/{id}, GET /api/logs
│   │   │   ├── receipts.py          # GET /api/receipts, PATCH /api/receipts/{id}
│   │   │   └── whatsapp.py          # GET/POST /api/whatsapp/webhook
│   │   └── services/
│   │       ├── document_classifier.py   # LLM-based doc type classification
│   │       ├── receipt_processor.py     # Main pipeline: OCR → classify → LLM → regex → ERP
│   │       ├── llm_extractor.py         # LLM extraction (NVIDIA/OpenAI provider)
│   │       └── whatsapp_client.py       # Meta Cloud API media download + message send
│   ├── migrations/
│   │   ├── 001-006_*.sql
│   │   ├── 007_add_reviewed_status.sql
│   │   ├── 008_add_receipt_fields.sql
│   │   └── 009_add_document_type.sql
│   ├── .env
│   ├── requirements.txt
│   └── Dockerfile
├── web/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # Single-page 3-tab app (Dashboard/Proofs/Receipts)
│   │   ├── login/
│   │   │   └── page.tsx
│   │   └── receipts/
│   │       └── [id]/
│   │           └── page.tsx          # Standalone receipt detail
│   └── lib/
│       ├── supabase.ts               # Supabase browser client
│       └── api.ts                    # API helper functions
├── PLAN.md
└── README.md
```

---

## 7. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **LLM Provider** | NVIDIA (free) or OpenAI | NVIDIA Llama 3.3 70B is free, returns higher confidence (0.97 vs 0.3) |
| **UI Architecture** | Single-page 3-tab | No route navigation confusion, state management via useState + key props |
| **Upload Flow** | Async with polling | Background thread processes PDF, frontend polls `/api/logs` every 2s |
| **WhatsApp API** | Meta Cloud API | Official, free for inbound + 24h replies, no ToS risk |
| **DB Access** | Supabase REST only | Avoids SQLAlchemy/psycopg2 dependency, simpler deployment |
| **ERP Sync** | Auto in process_proof | Updates ERp status directly at end of processing pipeline |
| **Document Classification** | LLM before extraction | Prevents wasted LLM calls on non-financial documents |
| **Multi-file Upload** | Sequential per-file processing | Each file gets its own background thread with DB context |

---

## 8. Implementation Phases

### Phase 1 — Foundation ✅
- [x] Initialize Python backend (FastAPI)
- [x] Initialize Next.js 14 web app with Tailwind
- [x] Configure Supabase project (DB + Storage + Auth)
- [x] Set up Supabase schema + SQL migrations
- [x] Initialize Git repo + push to GitHub

### Phase 2 — Core Backend ✅
- [x] Supabase client + config
- [x] PDF upload API (single + multi-file)
- [x] PDF OCR service (pdfplumber)
- [x] LLM extraction (NVIDIA + OpenAI provider support)
- [x] Hybrid extraction pipeline (LLM → LLM fallback → Regex)
- [x] Confidence scoring + routing
- [x] processing_log audit trail
- [x] Auto-ERP sync

### Phase 3 — Web UI ✅
- [x] Supabase Auth (email/password login)
- [x] Single-page 3-tab app (Dashboard / Proofs / Receipts)
- [x] Dashboard: stat cards, date filter, multi-file drag & drop upload
- [x] Proofs: accordion rows, status + document type badges, filterable
- [x] Receipts: full list, inline edit, search, status filters
- [x] Receipt detail page (standalone)
- [x] Confidence badges (green / yellow / red)
- [x] Clickable stat cards → navigate to tab with filter
- [x] Document type breakdown + filter

### Phase 4 — Document Classification ✅
- [x] LLM-based document type classifier
- [x] Classify before extraction — skip non-financial docs
- [x] document_type + document_type_confidence on payment_proofs
- [x] Document type badge + dropdown filter in Proofs tab
- [x] Document type stats on Dashboard

### Phase 5 — WhatsApp Integration ✅ (built, needs prod deployment)
- [x] Whatsapp client (media download + send message)
- [x] Webhook GET (verification) + POST (inbound messages)
- [x] Inbound PDF processing via same pipeline
- [x] Confirmation reply messages
- [ ] Configure Meta Developer Portal webhook URL
- [ ] Deploy backend with live WhatsApp webhook

### Phase 6 — ERP Integration ✅
- [x] Auto-ERP sync in process_proof
- [x] erp_status + erp_receipt_id on payment_proofs
- [ ] ERP database connection (ERP_DB_URL)

### Phase 7 — Invoice Pipeline (future)
- [ ] Invoice LLM prompt + extraction
- [ ] `invoices` + `invoice_line_items` tables
- [ ] Invoice-specific frontend tab
- [ ] Invoice ERP mapper

### Phase 8 — Deployment (next)
- [ ] Run SQL migrations in Supabase Editor
- [ ] Deploy backend to Railway / Render
- [ ] Deploy frontend to Vercel
- [ ] Custom domain
- [ ] Sentry monitoring

---

## 9. Environment Variables

### Backend (`backend/.env`)

```
SUPABASE_URL=https://pwcvdhuuyaspwlxljsib.supabase.co
SUPABASE_SERVICE_KEY=...
SUPABASE_ANON_KEY=...
SUPABASE_BUCKET=payment-proofs
DATABASE_URL=postgresql://postgres:postgres@...

OPENAI_API_KEY=sk-...                    # Optional — for OpenAI provider
LLM_PROVIDER=nvidia                       # nvidia or openai
LLM_MODEL=gpt-4o-mini                     # OpenAI model
NVIDIA_API_KEY=nvapi-...                  # NVIDIA API key (free)
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=meta/llama-3.3-70b-instruct
LLM_CONFIDENCE_THRESHOLD_AUTO=0.85
LLM_CONFIDENCE_THRESHOLD_REVIEW=0.5

ERP_DB_URL=
ERP_RECEIPT_TABLE=receipts

WHATSAPP_ENABLED=false
WHATSAPP_PHONE_NUMBER_ID=1194934513702775
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_WEBHOOK_VERIFY_TOKEN=tolmaierp-verify-2026
WHATSAPP_API_VERSION=v22.0

CORS_ORIGINS=http://localhost:3000
```

### Web (`web/.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=https://pwcvdhuuyaspwlxljsib.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## 10. Local Development

```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd web
npm install
npm run dev          # :3000

# WhatsApp webhook (expose backend)
ngrok http 8000
```

---

## 11. Relevant Files

| File | Purpose |
|------|---------|
| `backend/app/services/document_classifier.py` | LLM document type classifier |
| `backend/app/services/receipt_processor.py` | Main extraction pipeline |
| `backend/app/services/llm_extractor.py` | LLM extraction (NVIDIA/OpenAI) |
| `backend/app/services/whatsapp_client.py` | Meta Cloud API client |
| `backend/app/routers/upload.py` | Web upload endpoint |
| `backend/app/routers/proofs.py` | Proofs CRUD + logs + doc_type filter |
| `backend/app/routers/receipts.py` | Receipts CRUD with all 13 fields |
| `backend/app/routers/whatsapp.py` | WhatsApp webhook |
| `backend/app/config.py` | All env var settings |
| `web/app/page.tsx` | Single-page 3-tab app |
| `web/app/receipts/[id]/page.tsx` | Standalone receipt detail |
| `web/lib/api.ts` | API client helpers |

---

---

## 12. Reconciliation — Cross-Check Extracted Receipts Against Accounting System

### 12.1 Overview

Compare extracted receipt data (`proof_of_payment_receipt`) against accounting system entries (`accounting_receipts`) to detect discrepancies, potential fraud, and data-entry errors.

```
┌──────────────────────────┐     ┌──────────────────────────┐
│  proof_of_payment_receipt│     │  accounting_receipts     │
│  (extracted from PDF)    │     │  (entered by accountant) │
├──────────────────────────┤     ├──────────────────────────┤
│  amount: 125.00 EUR      │     │  amount: 125.00 EUR      │
│  payer: ACME GmbH        │     │  vendor: ACME GmbH       │
│  date: 2026-04-12        │     │  date: 2026-04-12        │
│  receipt_no: INV-165     │     │  ref_number: INV-165     │
│  confidence: 0.7         │     │  status: posted          │
└──────────┬───────────────┘     └──────────┬───────────────┘
           │                                │
           └──────────┬─────────────────────┘
                      ▼
          ┌──────────────────────────┐
          │  reconciliation_results  │
          ├──────────────────────────┤
          │  match_type: matched     │
          │  amount_diff: 0.00       │
          │  date_diff: 0            │
          │  classification: correct │
          │  matching_score: 0.98    │
          └──────────────────────────┘
```

### 12.2 New Tables

#### `accounting_receipts` — Accounting system entries

```sql
CREATE TABLE accounting_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number  TEXT,
  amount          DOUBLE PRECISION NOT NULL,
  currency        TEXT DEFAULT 'USD',
  payer_name      TEXT,
  payment_date    TEXT,
  description     TEXT,
  vendor          TEXT,
  vendor_vat      TEXT,
  po_number       TEXT,
  cost_center     TEXT,
  account_code    TEXT,
  status          TEXT DEFAULT 'posted',     -- 'posted' | 'pending' | 'void'
  notes           TEXT,
  created_by      UUID,                       -- who entered it
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### `reconciliation_results` — Match results between the two tables

```sql
CREATE TABLE reconciliation_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_receipt_id    UUID REFERENCES proof_of_payment_receipt(id),
  accounting_entry_id UUID REFERENCES accounting_receipts(id),
  
  -- Matching info
  match_type          TEXT NOT NULL DEFAULT 'auto',   -- 'auto' | 'manual' | 'unmatched_proof' | 'unmatched_entry'
  matching_score      DOUBLE PRECISION,                -- 0.0 to 1.0
  
  -- Comparison results
  amount_diff         DOUBLE PRECISION,               -- proof.amount - accounting.amount (signed)
  amount_diff_pct     DOUBLE PRECISION,               -- percentage difference
  date_diff_days      INTEGER,                         -- days between proof.payment_date and accounting.payment_date
  matched_fields      JSONB,                           -- {"amount": true, "date": true, "payer_name": false, ...}
  
  -- Classification
  classification      TEXT NOT NULL DEFAULT 'pending', 
  -- 'correct' | 'minor_mistake' | 'potential_fraud' | 'forensic_required' | 'fraud_detected'
  
  classification_rules JSONB,                          -- which rules triggered
  human_reviewed      BOOLEAN DEFAULT FALSE,
  reviewed_by         UUID,
  reviewed_at         TIMESTAMPTZ,
  notes               TEXT,
  
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(proof_receipt_id, accounting_entry_id)
);
```

### 12.3 Classification Rules

| Classification | Condition | Action |
|---|---|---|
| `correct` | Amount match exact (±0.5% tolerance) AND date within ±3 days AND payer/vendor matches | Auto |
| `minor_mistake` | Amount diff < 5% OR date diff < 30 days (single field mismatch) | Auto |
| `potential_fraud` | Amount diff 5-20% OR date diff > 30 days OR same receipt submitted twice | Auto |
| `forensic_required` | Amount diff > 20% OR proof has no matching accounting entry OR accounting entry has no proof | Auto |
| `fraud_detected` | Manually escalated from `forensic_required` or `potential_fraud` after human review | Manual only |

### 12.4 Matching Strategy

The matcher pairs rows from `proof_of_payment_receipt` with `accounting_receipts`:

```
For each proof_receipt:
  1. Try exact receipt_number match (case-insensitive)
     → if found, matching_score = 0.95+ → auto-match

  2. Try fuzzy match by (amount + date + payer_name):
     - amount: within ±0.5%
     - date: within ±3 days
     - payer_name: fuzzy string similarity > 0.8
     → matching_score = weighted average
     → if score > 0.7 → auto-match
     → if score 0.4-0.7 → flag for manual matching

  3. No match found → unmatched_proof

For each accounting_entry with no match → unmatched_entry
```

### 12.5 API Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/accounting-entries` | List all accounting entries (with date range, status filter) |
| `POST /api/accounting-entries` | Create a single entry (manual input) |
| `POST /api/accounting-entries/bulk` | Bulk import (CSV/JSON) |
| `PATCH /api/accounting-entries/{id}` | Edit an entry |
| `DELETE /api/accounting-entries/{id}` | Delete an entry |
| `POST /api/reconciliation/run` | Trigger matching run |
| `GET /api/reconciliation/results` | List results (filtered by classification, date) |
| `PATCH /api/reconciliation/results/{id}` | Manual override of classification, notes |
| `POST /api/reconciliation/match-manual` | Manually link a proof to an accounting entry |

### 12.6 UI — New "Reconciliation" Tab

A 4th tab in the single-page app:

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard | Proofs | Receipts | Reconciliation (new)       │
└─────────────────────────────────────────────────────────────┘
```

**Header:**
- Summary cards: Total Matched, Correct, Minor Mistakes, Potential Fraud, Forensic Required
- "Run Reconciliation" button
- Classification filter chips (All / Correct / Minor / Potential Fraud / Forensic / Fraud)

**Results Table:**
| Status | Proof # | Amount | Accounting # | Amount | Diff | Date Diff | Match Score | Actions |
|--------|---------|--------|--------------|--------|------|-----------|-------------|---------|
| ✅ Correct | INV-165 | 125.00 | INV-165 | 125.00 | 0.00 | 0 | 0.98 | — |
| ⚠️ Minor | REC-22 | 50.00 | REC-22 | 49.95 | 0.05 | 1 | 0.85 | Review |
| 🚩 Potential | PAY-7 | 1000.00 | PAY-7 | 850.00 | 150.00 | 45 | 0.55 | Investigate |
| 🔍 Forensic | — | 500.00 | — | — | — | — | — | Match manually |

**Row expansion** (click to expand):
- Shows both proof fields and accounting fields side by side
- Highlighted differences in red
- Notes field + classification override dropdown for human reviewers
- "Mark as Reviewed" button

**Manual Match Dialog:**
- For unmatched items, let the user select a proof and an accounting entry to link them
- Or flag as "genuinely unmatched" (e.g., proof is a personal payment, accounting entry is a journal adjustment)

### 12.7 Implementation Phases

#### Phase R1 — Database & API Foundation
- [ ] Create `accounting_receipts` table (migration 010)
- [ ] Create `reconciliation_results` table (migration 010)
- [ ] Create `routers/accounting.py` — CRUD for accounting entries
- [ ] Create `routers/reconciliation.py` — run matching, get results, manual override
- [ ] Create `services/receipt_matcher.py` — matching algorithm

#### Phase R2 — Reconciliation Engine
- [ ] Implement matching logic (receipt_number → fuzzy → unmatched)
- [ ] Implement classification rules auto-assignment
- [ ] Test with sample data
- [ ] API: manual match/link endpoint

#### Phase R3 — UI
- [ ] Add Reconciliation tab to page.tsx
- [ ] Summary cards + filter chips
- [ ] Results table with row expansion
- [ ] Side-by-side field comparison with diff highlighting
- [ ] Manual match dialog for unmatched items
- [ ] Classification override + notes

#### Phase R4 — Bulk Import & Polish
- [ ] CSV/Excel bulk import for accounting entries
- [ ] Export reconciliation results (CSV)
- [ ] Add reconciliation stats to Dashboard
- [ ] Audit log for classification changes (who changed what, when)

### 12.8 Data Flow (Detailed)

```
1. Accountant enters transactions → accounting_receipts table
   (via UI form or CSV bulk import)

2. User clicks "Run Reconciliation"
   ↓
3. receipt_matcher.py runs:
   a. Fetch all proof_of_payment_receipt rows with status in
      (extracted, reviewed, synced, completed)
   b. Fetch all accounting_receipts with status = posted
   c. For each proof, find best match in accounting entries
      (receipt_number → fuzzy amount+date+payer)
   d. For each match pair, compute:
      - amount_diff, amount_diff_pct, date_diff_days
      - matched_fields map
      - matching_score
   e. Apply classification rules → assign classification
   f. Insert/update reconciliation_results

4. User opens Reconciliation tab → sees results grouped by
   classification

5. For potential_fraud / forensic_required:
   a. Expand row → see both records side by side
   b. Review differences (highlighted)
   c. Override classification if needed (e.g., correct after
      investigation, or escalate to fraud_detected)
   d. Add notes

6. For unmatched_proof:
   a. Try to find the manual match via dropdown of all accounting entries
   b. If genuinely unmatched (e.g., cash payment with no ledger entry),
      mark as "manual" match with a null accounting_entry_id + notes

7. For unmatched_entry:
   a. Similar manual matching or flag as "no supporting document"
```

### 12.9 Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Match algorithm** | Server-side, on-demand | Accounting entries change infrequently; on-demand run avoids real-time sync complexity |
| **Manual matching** | Required for low-confidence pairs | LLM extraction may miss receipt_number; human judgment needed |
| **Classification** | Auto-assigned, human-overridable | Reduces manual work while keeping final say with the accountant |
| **`fraud_detected`** | Manual escalation only | Avoids false positives from automated systems |
| **Bulk import** | CSV via API + UI | Most accounting systems can export CSV; Excel import also possible via xlsx |

---

## 13. Next Steps

### Immediate (before reconciliation)
- [ ] Run `007`, `008`, `009` migrations in Supabase SQL Editor
- [ ] Deploy backend to Railway

### Phase R1 — Reconciliation DB & API
- [ ] Create `accounting_receipts` + `reconciliation_results` tables
- [ ] CRUD for accounting entries
- [ ] Receipt matching engine

### Phase R2 — Reconciliation UI
- [ ] Reconciliation tab in page.tsx
- [ ] Results table + diff view + manual matching

### Phase R3 — Polish & Deploy
- [ ] WhatsApp webhook live
- [ ] Invoice pipeline
- [ ] Sentry monitoring
