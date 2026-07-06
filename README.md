# WhatsApp Payment Proof Processor

Ingest payment proof PDFs from web upload or WhatsApp, classify document types, extract structured data via LLM (NVIDIA/OpenAI), reconcile against accounting entries, and maintain a full audit trail.

## Architecture

- **Backend**: Python FastAPI — upload, OCR (pdfplumber), document classification, LLM extraction, receipt matching, reconciliation
- **Web App**: Next.js 14 (App Router) + Tailwind CSS + lucide-react — single-page responsive app with bottom nav on mobile
- **Database**: Supabase (PostgreSQL + Storage + Auth) accessed via REST client
- **LLM**: NVIDIA Llama 3.3 70B (free) or OpenAI GPT-4o-mini — configurable per-provider in UI settings

## Features

- **Multi-file Upload** — Drag & drop PDFs with sequential processing, progress ring + step indicators
- **WhatsApp Integration** — Meta Cloud API webhook for inbound PDFs with confirmation replies
- **Document Classification** — LLM-based doc type detection (receipt/invoice/payment_proof/id/passport/etc); non-financial docs skip extraction
- **LLM Extraction** — 15 fields extracted (amount, currency, payer, bank, receipt number, date, description, card info, payee, address) with confidence scoring
- **Confidence Routing** — Auto-save (≥0.85), flag for review (0.5–0.85), fallback to regex (<0.5)
- **Reconciliation** — Cross-check extracted receipts against accounting entries with automatic matching, diff highlighting, fraud classification (correct/minor/potential/forensic)
- **Accounting Entries** — Full CRUD for manual entry or bulk import; linked to reconciliation results
- **Audit Trail** — Every field modification on receipts logged with old/new value, who, and timestamp
- **Field-level Confidence** — Per-field confidence stored as JSONB for granular review
- **Responsive UI** — Bottom nav on mobile, bottom sheet modals, scrollable tables, sidebar nav on desktop
- **Settings** — In-app LLM provider/API key/model configuration saved to database; falls back to env vars

## Tabs

| Tab | Description |
|-----|-------------|
| Dashboard | Stat cards (total docs, completed, pending, failed), date range filter, doc type distribution |
| Proofs | Upload list with expand/collapse, status + doc type badges, date filter, inline edit |
| Receipts | Extracted data table, inline edit, amend/delete icons, audit trail modal, date filter |
| Reconciliation | Match results table, expand/collapse with side-by-side diff, classification badges |
| Entries | Accounting entries CRUD with table view, date filter |
| Logs | Processing log with stage filter buttons, expandable details |

## Getting Started

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate    # Windows
pip install -r requirements.txt
cp .env.example .env      # Fill in your Supabase credentials
uvicorn app.main:app --reload --port 8000
```

### Web App

```bash
cd web
npm install
cp .env.example .env.local
npm run dev               # :3000
```

### Database Migrations

Run SQL files in `backend/migrations/` sequentially in Supabase SQL Editor.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+, FastAPI |
| Web App | Next.js 14 (App Router), Tailwind CSS |
| Database | Supabase (PostgreSQL + Storage + Auth) |
| Auth | Supabase Auth (email/password) |
| OCR | pdfplumber |
| LLM | NVIDIA Llama 3.3 70B (free) or OpenAI GPT-4o-mini |
| WhatsApp | Meta Cloud API (Graph API v22.0) |
| Icons | lucide-react |

## Environment

Key env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`).

LLM provider config can be set in-app via Settings modal or in `backend/.env` as fallback.
