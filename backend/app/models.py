import uuid
from datetime import datetime
from sqlalchemy import Column, String, BigInteger, DateTime, Text, JSON
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class PaymentProof(Base):
    __tablename__ = "payment_proofs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    file_path = Column(Text, nullable=False)
    file_name = Column(Text, nullable=False)
    file_size = Column(BigInteger, nullable=True)
    mime_type = Column(Text, default="application/pdf")
    source = Column(Text, default="web_upload")
    status = Column(Text, default="pending")
    extracted_data = Column(JSON, nullable=True)
    erp_status = Column(Text, default="pending")
    erp_receipt_id = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ProcessingLog(Base):
    __tablename__ = "processing_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proof_id = Column(UUID(as_uuid=True), nullable=False)
    stage = Column(Text, nullable=False)
    status = Column(Text, nullable=False)
    message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
