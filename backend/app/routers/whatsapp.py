import uuid
import threading
from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import PlainTextResponse, JSONResponse
from app.config import settings
from app.supabase_client import supabase
from app.services.whatsapp_client import whatsapp_client
from app.services.receipt_processor import process_proof

router = APIRouter()


@router.get("/whatsapp/webhook")
def verify_webhook(
    mode: str = Query(None, alias="hub.mode"),
    token: str = Query(None, alias="hub.verify_token"),
    challenge: str = Query(None, alias="hub.challenge"),
):
    if mode == "subscribe" and token == settings.whatsapp_webhook_verify_token:
        return PlainTextResponse(challenge)
    raise HTTPException(status_code=403, detail="Verification failed")


@router.post("/whatsapp/webhook")
async def handle_webhook(body: dict):
    try:
        entry = body.get("entry", [])
        for e in entry:
            changes = e.get("changes", [])
            for change in changes:
                value = change.get("value", {})
                messages = value.get("messages", [])
                metadata = value.get("metadata", {})
                for msg in messages:
                    msg_from = msg.get("from")
                    msg_id = msg.get("id")
                    msg_type = msg.get("type")

                    if msg_type == "document":
                        doc = msg.get("document", {})
                        mime = doc.get("mime_type", "")
                        if mime != "application/pdf":
                            whatsapp_client.send_message(
                                msg_from,
                                "Only PDF files are supported. Please send a payment confirmation PDF.",
                            )
                            continue

                        media_id = doc.get("id")
                        filename = doc.get("filename", f"whatsapp_{uuid.uuid4().hex[:8]}.pdf")

                        threading.Thread(
                            target=process_whatsapp_pdf,
                            args=(media_id, filename, msg_from, msg_id),
                            daemon=True,
                        ).start()

                    elif msg_type == "text":
                        whatsapp_client.send_message(
                            msg_from,
                            "Send a payment confirmation PDF to extract receipt data automatically.",
                        )
    except Exception as e:
        pass

    return JSONResponse({"status": "ok"})


def process_whatsapp_pdf(media_id: str, filename: str, sender: str, msg_id: str):
    try:
        pdf_bytes = whatsapp_client.download_media(media_id)
    except Exception as e:
        return

    proof_id = str(uuid.uuid4())
    file_path = f"whatsapp/{proof_id}.pdf"

    try:
        supabase.storage.from_(settings.supabase_bucket).upload(file_path, pdf_bytes)
    except Exception:
        supabase.storage.from_(settings.supabase_bucket).update(file_path, pdf_bytes)

    supabase.table("payment_proofs").insert({
        "id": proof_id,
        "file_path": file_path,
        "file_name": filename,
        "file_size": len(pdf_bytes),
        "mime_type": "application/pdf",
        "source": "whatsapp",
        "status": "pending",
    }).execute()

    try:
        result = process_proof(proof_id)
        confidence = result.get("confidence", 0)
        status = result.get("status", "failed")
        extracted = result.get("extracted", {})

        if status == "completed":
            amount = extracted.get("amount", "N/A")
            currency = extracted.get("currency", "")
            payer = extracted.get("payer_name", "Unknown")
            msg = (
                f"Receipt extracted:\n"
                f"Amount: {currency} {amount}\n"
                f"Payer: {payer}\n"
                f"Confidence: {int(confidence * 100)}%\n"
                f"View at: https://{settings.cors_origins.split(',')[0].replace('http://', '').replace('https://', '')}/receipts/{result.get('receipt_id', '')}"
            )
            whatsapp_client.send_message(sender, msg)
        elif status == "review_needed":
            msg = (
                f"Receipt extracted (needs review):\n"
                f"Amount: {extracted.get('currency', '')} {extracted.get('amount', 'N/A')}\n"
                f"Payer: {extracted.get('payer_name', 'Unknown')}\n"
                f"Confidence: {int(confidence * 100)}%\n"
                f"Please verify: https://ai-tolmai.vercel.app/receipts/{result.get('receipt_id', '')}"
            )
            whatsapp_client.send_message(sender, msg)
        else:
            whatsapp_client.send_message(
                sender, "Could not extract receipt data. Please upload via the web dashboard."
            )
    except Exception as e:
        supabase.table("payment_proofs").update({
            "status": "failed",
            "error_message": str(e),
        }).eq("id", proof_id).execute()
        whatsapp_client.send_message(
            sender, "An error occurred while processing. Please try uploading via the web dashboard."
        )
