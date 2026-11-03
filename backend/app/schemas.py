"""API schemas. Decimal fields serialize as strings, so money never becomes a float in JSON."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginIn(BaseModel):
    email: str
    password: str


class MeOut(BaseModel):
    user_id: uuid.UUID
    org_id: uuid.UUID
    email: str
    name: str


class PropertyIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    property_type: Literal["retail", "office", "industrial", "mixed", "other"] = "retail"
    address: str = ""
    total_rsf: Decimal | None = Field(default=None, ge=0)
    fiscal_year_end_month: int = Field(default=12, ge=1, le=12)
    reconciliation_status: Literal["not_started", "data_collection", "in_review", "ready", "final"] = "not_started"


class PropertyOut(ORM, PropertyIn):
    id: uuid.UUID
    created_at: datetime


class PeriodIn(BaseModel):
    label: str
    fiscal_year_start: date
    fiscal_year_end: date
    through_date: date


class PeriodOut(ORM, PeriodIn):
    id: uuid.UUID
    property_id: uuid.UUID
    status: str


class TenantIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    suite: str = ""
    rentable_area: Decimal | None = Field(default=None, ge=0)
    lease_start: date | None = None
    lease_end: date | None = None
    allocation_method: Literal["pro_rata", "fixed_pct"] = "pro_rata"
    lease_rule_id: uuid.UUID | None = None


class TenantOut(ORM, TenantIn):
    id: uuid.UUID
    property_id: uuid.UUID


class CategoryIn(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str
    pool: str = Field(min_length=1, max_length=50)
    controllable: bool = False
    variable: bool = False


class CategoryOut(ORM, CategoryIn):
    id: uuid.UUID


class AllocationRuleIn(BaseModel):
    pool: str
    method: Literal["pro_rata", "fixed_pct"]
    denominator_sqft: Decimal | None = None
    fixed_pct: Decimal | None = Field(default=None, ge=0, le=1)
    excluded_categories: list[str] = []
    base_year_amount: Decimal | None = None
    gross_up_enabled: bool = False
    gross_up_target: Decimal | None = Field(default=None, gt=0, le=1)
    gross_up_actual: Decimal | None = Field(default=None, gt=0, le=1)
    cap_kind: Literal["noncumulative", "cumulative", "cpi"] | None = None
    cap_pct: Decimal | None = Field(default=None, ge=0)
    cap_prior_year: Decimal | None = None


class AllocationRuleOut(ORM, AllocationRuleIn):
    id: uuid.UUID


class LeaseRuleIn(BaseModel):
    ref: str = Field(min_length=1, max_length=100)
    admin_fee_pct: Decimal | None = Field(default=None, ge=0, le=1)
    admin_fee_pools: list[str] = []
    admin_fee_order: Literal["after_cap", "before_cap"] | None = None
    unsupported_terms: list[str] = []
    source_ref: str = ""
    notes: str = ""
    pools: list[AllocationRuleIn] = []


class LeaseRuleOut(ORM):
    id: uuid.UUID
    property_id: uuid.UUID
    ref: str
    status: str
    admin_fee_pct: Decimal | None
    admin_fee_pools: list[str]
    admin_fee_order: str | None
    unsupported_terms: list[str]
    source_ref: str
    notes: str
    approved_at: datetime | None
    pools: list[AllocationRuleOut] = []


class MappingIn(BaseModel):
    category_code: str | None = None
    status: Literal["recoverable", "nonrecoverable", "needs_review"]
    explanation: str = ""
    source_ref: str = ""

    @field_validator("explanation")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


class GLAccountOut(BaseModel):
    gl_account: str
    account_name: str
    transaction_count: int
    total: Decimal
    mapping_id: uuid.UUID | None
    category_code: str | None
    status: str
    explanation: str
    source_ref: str
    reviewer: str | None
    reviewed_at: datetime | None


class GLTransactionOut(ORM):
    id: uuid.UUID
    gl_account: str
    account_name: str
    txn_date: date
    amount: Decimal
    vendor: str
    description: str
    source_row: int
    import_batch_id: uuid.UUID
    excluded_by_review: bool


class ImportOut(ORM):
    id: uuid.UUID
    kind: str
    status: str
    row_count: int
    accepted_count: int
    rejected_rows: list
    column_map: dict
    created_at: datetime
    filename: str = ""


class ImportPreview(BaseModel):
    batch: ImportOut
    columns: list[str]
    rows: list[dict]
    required_fields: list[str]
    optional_fields: list[str]
    suggested_map: dict[str, str]
    warnings: list[str]


class CommitIn(BaseModel):
    column_map: dict[str, str]  # field -> source column


class CommitOut(BaseModel):
    batch: ImportOut
    warnings: list[str]


class ReviewIn(BaseModel):
    note: str = Field(min_length=1)


class ExceptionPatch(BaseModel):
    status: Literal["open", "resolved", "accepted"]
    note: str = Field(min_length=1)


class AuditRunIn(BaseModel):
    period_id: uuid.UUID
    variance_threshold: Decimal = Decimal("500.00")
