"""Engine input and output types. Plain frozen dataclasses, no DB or web imports."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import StrEnum


class Recoverability(StrEnum):
    RECOVERABLE = "recoverable"
    NONRECOVERABLE = "nonrecoverable"
    NEEDS_REVIEW = "needs_review"


class Method(StrEnum):
    PRO_RATA = "pro_rata"
    FIXED_PCT = "fixed_pct"


class CapKind(StrEnum):
    NONCUMULATIVE = "noncumulative"
    CUMULATIVE = "cumulative"  # flagged unsupported in v0.1
    CPI = "cpi"  # flagged unsupported in v0.1


class AdminFeeOrder(StrEnum):
    AFTER_CAP = "after_cap"
    BEFORE_CAP = "before_cap"


class Severity(StrEnum):
    ERROR = "error"  # blocks a tenant result
    WARNING = "warning"  # result computed, needs review
    INFO = "info"


class ExceptionType(StrEnum):
    MISSING_TENANT_AREA = "MISSING_TENANT_AREA"
    MISSING_LEASE_RULE = "MISSING_LEASE_RULE"
    MISSING_DENOMINATOR = "MISSING_DENOMINATOR"
    MISSING_RULE_TERM = "MISSING_RULE_TERM"
    UNMAPPED_GL_ACCOUNT = "UNMAPPED_GL_ACCOUNT"
    UNKNOWN_CATEGORY = "UNKNOWN_CATEGORY"
    MAPPING_NEEDS_REVIEW = "MAPPING_NEEDS_REVIEW"
    DUPLICATE_GL_CANDIDATE = "DUPLICATE_GL_CANDIDATE"
    UNSUPPORTED_RULE = "UNSUPPORTED_RULE"
    MISSING_BILLINGS = "MISSING_BILLINGS"
    SHARES_EXCEED_100 = "SHARES_EXCEED_100"
    TRANSACTION_OUTSIDE_PERIOD = "TRANSACTION_OUTSIDE_PERIOD"
    ROUNDING_DIFFERENCE = "ROUNDING_DIFFERENCE"
    VARIANCE_OVER_THRESHOLD = "VARIANCE_OVER_THRESHOLD"
    INVALID_PERIOD = "INVALID_PERIOD"


@dataclass(frozen=True)
class Period:
    fiscal_year_start: date
    fiscal_year_end: date
    through_date: date  # audit covers fiscal_year_start..through_date (YTD)

    @property
    def ytd_days(self) -> int:
        return (self.through_date - self.fiscal_year_start).days + 1

    @property
    def year_days(self) -> int:
        return (self.fiscal_year_end - self.fiscal_year_start).days + 1


@dataclass(frozen=True)
class Transaction:
    id: str
    gl_account: str
    txn_date: date
    amount: Decimal
    description: str = ""
    source_ref: str = ""  # e.g. "gl_2026.xlsx row 14"


@dataclass(frozen=True)
class Category:
    code: str
    pool: str
    controllable: bool = False
    variable: bool = False  # varies with occupancy, eligible for gross-up


@dataclass(frozen=True)
class Mapping:
    gl_account: str
    category: str
    status: Recoverability


@dataclass(frozen=True)
class GrossUp:
    target_occupancy: Decimal | None  # e.g. Decimal("0.95")
    actual_occupancy: Decimal | None


@dataclass(frozen=True)
class Cap:
    kind: CapKind
    pct: Decimal | None  # e.g. Decimal("0.05")
    prior_year_controllable: Decimal | None  # tenant's prior-year controllable charge for this pool


@dataclass(frozen=True)
class PoolRule:
    pool: str
    method: Method
    denominator_sqft: Decimal | None = None  # lease-defined denominator for pro_rata
    fixed_pct: Decimal | None = None  # e.g. Decimal("0.125")
    excluded_categories: frozenset[str] = frozenset()
    base_year_amount: Decimal | None = None  # full-year base-year pool amount
    gross_up: GrossUp | None = None
    cap: Cap | None = None


@dataclass(frozen=True)
class AdminFee:
    pct: Decimal
    pools: frozenset[str]
    order: AdminFeeOrder | None = None  # required when any fee pool has a cap


@dataclass(frozen=True)
class LeaseRule:
    ref: str
    pools: tuple[PoolRule, ...]
    admin_fee: AdminFee | None = None
    unsupported_terms: tuple[str, ...] = ()  # free-text terms the engine cannot compute


@dataclass(frozen=True)
class Tenant:
    id: str
    name: str
    rentable_area: Decimal | None
    lease_start: date | None
    lease_end: date | None
    rule: LeaseRule | None


@dataclass(frozen=True)
class Billing:
    tenant_id: str
    bill_date: date
    amount: Decimal
    source_ref: str = ""


@dataclass(frozen=True)
class AuditInput:
    period: Period
    transactions: tuple[Transaction, ...]
    categories: tuple[Category, ...]
    mappings: tuple[Mapping, ...]
    tenants: tuple[Tenant, ...]
    billings: tuple[Billing, ...]
    excluded_transaction_ids: frozenset[str] = frozenset()  # reviewer-excluded (e.g. confirmed duplicates)
    variance_threshold: Decimal = Decimal("500.00")


@dataclass
class TraceStep:
    label: str
    formula: str
    result: str | None
    inputs: dict[str, str | None] = field(default_factory=dict)


@dataclass
class AuditException:
    type: ExceptionType
    severity: Severity
    message: str
    tenant_id: str | None = None
    gl_account: str | None = None
    pool: str | None = None
    transaction_ids: tuple[str, ...] = ()
    amount: Decimal | None = None


@dataclass
class PoolLine:
    pool: str
    tenant_pool_amount: Decimal  # pool dollars this tenant participates in, after exclusions/gross-up
    share: Decimal
    amount_unrounded: Decimal
    amount: Decimal  # rounded to cents
    controllable_amount: Decimal
    cap_reduction: Decimal = Decimal("0")


@dataclass
class TenantResult:
    tenant_id: str
    tenant_name: str
    status: str  # "calculated" | "unresolved"
    lines: list[PoolLine] = field(default_factory=list)
    admin_fee: Decimal = Decimal("0")
    total: Decimal | None = None
    billed: Decimal | None = None
    variance: Decimal | None = None  # total - billed. Positive means billed less than provisional share.
    trace: list[TraceStep] = field(default_factory=list)
    unresolved_reasons: list[str] = field(default_factory=list)


@dataclass
class PoolSummary:
    pool: str
    recoverable_total: Decimal
    by_category: dict[str, Decimal]
    allocated_total: Decimal = Decimal("0")
    rounding_difference: Decimal = Decimal("0")


@dataclass
class AuditOutput:
    provisional: bool
    period: Period
    pools: dict[str, PoolSummary]
    tenants: list[TenantResult]
    exceptions: list[AuditException]
    included_transaction_ids: list[str]
    excluded: dict[str, list[str]]  # reason -> transaction ids
