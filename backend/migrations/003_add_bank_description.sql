-- Add bank_issuer and description columns to proof_of_payment_receipt
ALTER TABLE proof_of_payment_receipt
ADD COLUMN bank_issuer TEXT,
ADD COLUMN description TEXT;
