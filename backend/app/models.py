"""SQLAlchemy models. Every tenant-owned table carries organization_id for isolation."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON, Boolean, Date, DateTime, ForeignKey, Integer, LargeBinary, Numeric, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

Money = Numeric(14, 2)
Share = Numeric(12, 8)
Area = Numeric(14, 2)


class Base(DeclarativeBase):
    pass


class Timestamps:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OrgOwned(Timestamps):
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True)


class Organization(Timestamps, Base):
    __tablename__ = "organizations"
    name: Mapped[str] = mapped_column(String(200))


class User(OrgOwned, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(300))


class Property(OrgOwned, Base):
    __tablename__ = "properties"
    name: Mapped[str] = mapped_column(String(200))
    property_type: Mapped[str] = mapped_column(String(50), default="retail")
    address: Mapped[str] = mapped_column(String(400), default="")
    total_rsf: Mapped[Decimal | None] = mapped_column(Area, nullable=True)
    fiscal_year_end_month: Mapped[int] = mapped_column(Integer, default=12)
    reconciliation_status: Mapped[str] = mapped_column(String(30), default="not_started")


class ReportingPeriod(OrgOwned, Base):
    __tablename__ = "reporting_periods"
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(50))
    fiscal_year_start: Mapped[date] = mapped_column(Date)
    fiscal_year_end: Mapped[date] = mapped_column(Date)
    through_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(30), default="open")


class LeaseRule(OrgOwned, Base):
    __tablename__ = "lease_rules"
    __table_args__ = (UniqueConstraint("property_id", "ref"),)
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    ref: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | approved
    admin_fee_pct: Mapped[Decimal | None] = mapped_column(Share, nullable=True)
    admin_fee_pools: Mapped[list] = mapped_column(JSON, default=list)
    admin_fee_order: Mapped[str | None] = mapped_column(String(20), nullable=True)
    unsupported_terms: Mapped[list] = mapped_column(JSON, default=list)
    source_ref: Mapped[str] = mapped_column(String(400), default="")  # e.g. "Lease p.12 s.6.2"
    notes: Mapped[str] = mapped_column(Text, default="")
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AllocationRule(OrgOwned, Base):
    """One pool a lease rule participates in, with its method and adjustments."""
    __tablename__ = "allocation_rules"
    __table_args__ = (UniqueConstraint("lease_rule_id", "pool"),)
    lease_rule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lease_rules.id", ondelete="CASCADE"), index=True)
    pool: Mapped[str] = mapped_column(String(50))
    method: Mapped[str] = mapped_column(String(20))  # pro_rata | fixed_pct
    denominator_sqft: Mapped[Decimal | None] = mapped_column(Area, nullable=True)
    fixed_pct: Mapped[Decimal | None] = mapped_column(Share, nullable=True)
    excluded_categories: Mapped[list] = mapped_column(JSON, default=list)
    base_year_amount: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    gross_up_target: Mapped[Decimal | None] = mapped_column(Share, nullable=True)
    gross_up_actual: Mapped[Decimal | None] = mapped_column(Share, nullable=True)
    gross_up_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    cap_kind: Mapped[str | None] = mapped_column(String(20), nullable=True)
    cap_pct: Mapped[Decimal | None] = mapped_column(Share, nullable=True)
    cap_prior_year: Mapped[Decimal | None] = mapped_column(Money, nullable=True)


class Tenant(OrgOwned, Base):
    __tablename__ = "tenants"
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    suite: Mapped[str] = mapped_column(String(50), default="")
    rentable_area: Mapped[Decimal | None] = mapped_column(Area, nullable=True)
    lease_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    lease_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    allocation_method: Mapped[str] = mapped_column(String(20), default="pro_rata")
    lease_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("lease_rules.id", ondelete="SET NULL"), nullable=True)


class Lease(OrgOwned, Base):
    """Lease document record. Stores the original file reference, never a rewritten copy."""
    __tablename__ = "leases"
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    lease_ref: Mapped[str] = mapped_column(String(100), default="")
    source_file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("source_files.id"), nullable=True)


class ExpenseCategory(OrgOwned, Base):
    __tablename__ = "expense_categories"
    __table_args__ = (UniqueConstraint("property_id", "code"),)
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(200))
    pool: Mapped[str] = mapped_column(String(50))
    controllable: Mapped[bool] = mapped_column(Boolean, default=False)
    variable: Mapped[bool] = mapped_column(Boolean, default=False)


class SourceFile(OrgOwned, Base):
    """Original uploaded bytes. Immutable. Never overwritten."""
    __tablename__ = "source_files"
    filename: Mapped[str] = mapped_column(String(300))
    content_type: Mapped[str] = mapped_column(String(100))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    content: Mapped[bytes] = mapped_column(LargeBinary)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class ImportBatch(OrgOwned, Base):
    __tablename__ = "import_batches"
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # gl | billings
    status: Mapped[str] = mapped_column(String(20), default="uploaded")  # uploaded | committed
    source_file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_files.id"))
    column_map: Mapped[dict] = mapped_column(JSON, default=dict)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    accepted_count: Mapped[int] = mapped_column(Integer, default=0)
    rejected_rows: Mapped[list] = mapped_column(JSON, default=list)  # [{row, errors, values}]
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class GLTransaction(OrgOwned, Base):
    __tablename__ = "gl_transactions"
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    import_batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_batches.id", ondelete="CASCADE"), index=True)
    source_row: Mapped[int] = mapped_column(Integer)
    gl_account: Mapped[str] = mapped_column(String(50), index=True)
    account_name: Mapped[str] = mapped_column(String(200), default="")
    txn_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Money)
    vendor: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(String(500), default="")
    excluded_by_review: Mapped[bool] = mapped_column(Boolean, default=False)


class ExpenseMapping(OrgOwned, Base):
    __tablename__ = "expense_mappings"
    __table_args__ = (UniqueConstraint("property_id", "gl_account"),)
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    gl_account: Mapped[str] = mapped_column(String(50))
    category_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="needs_review")
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    explanation: Mapped[str] = mapped_column(Text, default="")
    source_ref: Mapped[str] = mapped_column(String(400), default="")


class CamBilling(OrgOwned, Base):
    __tablename__ = "cam_billings"
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    import_batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_batches.id", ondelete="CASCADE"))
    source_row: Mapped[int] = mapped_column(Integer)
    bill_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Money)
    description: Mapped[str] = mapped_column(String(300), default="")


class AuditRun(OrgOwned, Base):
    __tablename__ = "audit_runs"
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    period_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reporting_periods.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(20), default="completed")
    provisional: Mapped[bool] = mapped_column(Boolean, default=True)
    input_hash: Mapped[str] = mapped_column(String(64))
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class AuditResult(OrgOwned, Base):
    __tablename__ = "audit_results"
    audit_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_runs.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(20))
    total: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    admin_fee: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    billed: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    variance: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    lines: Mapped[list] = mapped_column(JSON, default=list)
    unresolved_reasons: Mapped[list] = mapped_column(JSON, default=list)


class CalculationTrace(OrgOwned, Base):
    __tablename__ = "calculation_traces"
    audit_result_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_results.id", ondelete="CASCADE"), index=True)
    steps: Mapped[list] = mapped_column(JSON, default=list)


class AuditExceptionRow(OrgOwned, Base):
    __tablename__ = "exceptions"
    audit_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_runs.id", ondelete="CASCADE"), index=True)
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(50))
    severity: Mapped[str] = mapped_column(String(10))
    message: Mapped[str] = mapped_column(Text)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    gl_account: Mapped[str | None] = mapped_column(String(50), nullable=True)
    pool: Mapped[str | None] = mapped_column(String(50), nullable=True)
    transaction_ids: Mapped[list] = mapped_column(JSON, default=list)
    amount: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | resolved | accepted
    resolution_note: Mapped[str] = mapped_column(Text, default="")


class ReviewDecision(OrgOwned, Base):
    __tablename__ = "review_decisions"
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), index=True)
    target_type: Mapped[str] = mapped_column(String(50))  # expense_mapping | lease_rule | exception | gl_transaction
    target_id: Mapped[str] = mapped_column(String(100))
    decision: Mapped[str] = mapped_column(String(50))
    note: Mapped[str] = mapped_column(Text, default="")
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class AuditLog(OrgOwned, Base):
    """Append-only change log."""
    __tablename__ = "audit_log"
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(50))
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[str] = mapped_column(String(100))
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
