from app.services.whatsapp_client import whatsapp_client

numbers = ["310611000862", "31611000862"]
for num in numbers:
    result = whatsapp_client.send_message(num, "Test from AI-Tolmai. Send a PDF to auto-extract receipt data.")
    if result.get("error"):
        print(f"{num}: Error {result.get('status')} - {result.get('body', result.get('message', ''))}")
    else:
        msg_id = result.get("messages", [{}])[0].get("id", "?")
        print(f"{num}: OK - {msg_id}")
