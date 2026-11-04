"""Node registry. Each node declares its ports and configuration fields and implements run().

Nodes are pure with respect to Veyra's financial records: they read property data through
organization-scoped queries and never write ledger, billing, mapping or audit rows. That is what
makes a retried run safe: it can only produce new run artifacts, never duplicate financial data.
Financial math is delegated to the existing calculation engine (veyra_engine) and the existing
snapshot builder, so the workflow engine holds no allocation logic of its own.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from veyra_engine import ENGINE_VERSION, run_audit

from .. import models as M
from ..services.audit import snapshot_hash
from ..services.imports import parse_date
from ..services.snapshot import build_snapshot, input_from_snapshot
from .expr import RowError, compile_expression
from .table import (
    MAX_ISSUES_PER_STEP,
    NodeError,
    Table,
    fmt_decimal,
    issue,
    read_spreadsheet,
    to_csv_bytes,
    to_decimal,
    to_xlsx_bytes,
)


@dataclass(frozen=True)
class Port:
    name: str
    label: str
    required: bool = True
    multi: bool = False  # accepts several incoming edges (export nodes)


@dataclass(frozen=True)
class ConfigField:
    key: str
    label: str
    # text | number | bool | select | column | columns | mapping | conditions | property | period
    # | expression | textarea
    type: str
    required: bool = False
    default: Any = None
    options: tuple[tuple[str, str], ...] = ()
    help: str = ""
    show_if: tuple[str, str] | None = None  # (field key, value)


@dataclass
class Artifact:
    name: str
    content_type: str
    content: bytes


@dataclass
class NodeResult:
    outputs: dict[str, Table] = field(default_factory=dict)
    issues: list[dict[str, Any]] = field(default_factory=list)
    artifacts: list[Artifact] = field(default_factory=list)
    logs: list[str] = field(default_factory=list)


@dataclass
class Context:
    """What a node may see. Built by the engine for each step."""

    db: Session
    org_id: uuid.UUID
    node_key: str
    label: str
    workflow_name: str
    version_number: int
    run_id: uuid.UUID
    input_files: dict[str, uuid.UUID]
    ancestor_issues: Callable[[], list[dict[str, Any]]]
    provenance: Callable[[], list[str]]

    def property(self, raw: Any) -> M.Property:
        try:
            pid = uuid.UUID(str(raw))
        except ValueError as exc:
            raise NodeError("Choose a property.") from exc
        prop = self.db.get(M.Property, pid)
        if prop is None or prop.organization_id != self.org_id:
            raise NodeError("The selected property was not found in your organization.")
        return prop


Inputs = dict[str, Any]  # port -> Table, or list[tuple[str, Table]] for multi ports
RunFn = Callable[[Context, Inputs, dict[str, Any]], NodeResult]


@dataclass(frozen=True)
class NodeSpec:
    type: str
    label: str
    category: str  # input | transform | financial | output | control
    description: str
    inputs: tuple[Port, ...]
    outputs: tuple[str, ...]
    fields: tuple[ConfigField, ...]
    run: RunFn
    validate: Callable[[dict[str, Any]], list[str]] | None = None

    def public(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "label": self.label,
            "category": self.category,
            "description": self.description,
            "inputs": [
                {"name": p.name, "label": p.label, "required": p.required, "multi": p.multi} for p in self.inputs
            ],
            "outputs": list(self.outputs),
            "fields": [
                {
                    "key": f.key,
                    "label": f.label,
                    "type": f.type,
                    "required": f.required,
                    "default": f.default,
                    "options": [{"value": v, "label": lbl} for v, lbl in f.options],
                    "help": f.help,
                    "show_if": list(f.show_if) if f.show_if else None,
                }
                for f in self.fields
            ],
        }

    def config_errors(self, config: dict[str, Any]) -> list[str]:
        errs = []
        for f in self.fields:
            if f.show_if and str(config.get(f.show_if[0], "")) != f.show_if[1]:
                continue
            v = config.get(f.key, f.default)
            if f.required and (v is None or v == "" or v == [] or v == {}):
                errs.append(f"{f.label} is required.")
            if f.type == "select" and v not in (None, "") and f.options and v not in [o[0] for o in f.options]:
                errs.append(f"{f.label}: {v!r} is not an allowed value.")
            if f.type == "number" and v not in (None, "") and to_decimal(str(v)) is None:
                errs.append(f"{f.label} must be a number.")
        if self.validate:
            errs.extend(self.validate(config))
        return errs


REGISTRY: dict[str, NodeSpec] = {}


def register(spec: NodeSpec) -> NodeSpec:
    REGISTRY[spec.type] = spec
    return spec


def cfg(config: dict[str, Any], spec_fields: tuple[ConfigField, ...], key: str) -> Any:
    for f in spec_fields:
        if f.key == key:
            v = config.get(key)
            return f.default if v is None or v == "" else v
    return config.get(key)


def _list(v: Any) -> list[str]:
    if v is None or v == "":
        return []
    if isinstance(v, str):
        return [x.strip() for x in v.split(",") if x.strip()]
    return [str(x).strip() for x in v if str(x).strip()]


def _cap(issues: list[dict[str, Any]], logs: list[str]) -> list[dict[str, Any]]:
    if len(issues) > MAX_ISSUES_PER_STEP:
        logs.append(f"{len(issues):,} issues found. The first {MAX_ISSUES_PER_STEP:,} are stored.")
        return issues[:MAX_ISSUES_PER_STEP]
    return issues


def _threshold(c: dict[str, Any]) -> Decimal:
    """Variance threshold; 0 is a valid value, only blank means the 500.00 default."""
    raw = c.get("variance_threshold")
    d = None if raw is None or str(raw).strip() == "" else to_decimal(str(raw))
    if d is None:
        return Decimal("500")
    if d < 0:
        raise NodeError("The variance threshold cannot be negative.")
    return d


PROPERTY_FIELD = ConfigField("property_id", "Property", "property", required=True, help="Organization data only.")


# ===================================================================================== Inputs


def _run_upload(ctx: Context, _inp: Inputs, c: dict[str, Any]) -> NodeResult:
    fid = ctx.input_files.get(ctx.node_key)
    if not fid:
        raise NodeError(f"No file was provided for {ctx.label!r}. Upload a CSV or XLSX file when you run the workflow.")
    sf = ctx.db.get(M.SourceFile, fid)
    if sf is None or sf.organization_id != ctx.org_id:
        raise NodeError("The uploaded file was not found.")
    header_row = int(to_decimal(str(cfg(c, UPLOAD_FIELDS, "header_row"))) or 1)
    t = read_spreadsheet(sf.filename, sf.content, sheet=str(c.get("sheet") or ""), header_row=max(header_row, 1))
    expected = _list(c.get("expected_columns"))
    if expected:
        t.require(*expected, node=ctx.label)
    return NodeResult(
        outputs={"out": t},
        logs=[
            f"Read {sf.filename} ({sf.size_bytes:,} bytes, sha256 {sf.sha256[:12]}). {len(t):,} rows, "
            f"{len(t.columns)} columns."
        ],
    )


UPLOAD_FIELDS = (
    ConfigField(
        "input_label", "Input name", "text", default="Spreadsheet", help="Shown when the workflow asks for files."
    ),
    ConfigField("sheet", "Worksheet", "text", help="Blank uses the first sheet. CSV files have one sheet."),
    ConfigField("header_row", "Header row", "number", default=1),
    ConfigField("expected_columns", "Required columns", "columns", help="Stop the run if any are missing."),
)
register(
    NodeSpec(
        "spreadsheet_upload",
        "Spreadsheet upload",
        "input",
        "Read a CSV or XLSX file supplied when the workflow runs. The original file is stored unchanged.",
        (),
        ("out",),
        UPLOAD_FIELDS,
        _run_upload,
    )
)


def _run_property_data(ctx: Context, _inp: Inputs, c: dict[str, Any]) -> NodeResult:
    prop = ctx.property(c.get("property_id"))
    ds = c.get("dataset") or "gl"
    db, org = ctx.db, ctx.org_id

    def q(model: Any) -> Any:
        return select(model).where(model.organization_id == org, model.property_id == prop.id)

    if ds == "gl":
        t = Table(
            ["gl_account", "account_name", "txn_date", "amount", "vendor", "description"], source=f"{prop.name} GL"
        )
        for g in db.scalars(q(M.GLTransaction).order_by(M.GLTransaction.txn_date, M.GLTransaction.source_row)):
            t.append(
                {
                    "gl_account": g.gl_account,
                    "account_name": g.account_name,
                    "txn_date": g.txn_date.isoformat(),
                    "amount": fmt_decimal(g.amount),
                    "vendor": g.vendor,
                    "description": g.description,
                },
                g.source_row,
            )
    elif ds == "tenants":
        rules = {r.id: r.ref for r in db.scalars(q(M.LeaseRule))}
        t = Table(
            ["suite", "tenant", "rentable_area", "lease_start", "lease_end", "rule_ref"], source=f"{prop.name} tenants"
        )
        for x in db.scalars(q(M.Tenant).order_by(M.Tenant.suite, M.Tenant.name)):
            t.append(
                {
                    "suite": x.suite,
                    "tenant": x.name,
                    "rentable_area": "" if x.rentable_area is None else fmt_decimal(x.rentable_area),
                    "lease_start": x.lease_start.isoformat() if x.lease_start else "",
                    "lease_end": x.lease_end.isoformat() if x.lease_end else "",
                    "rule_ref": rules.get(x.lease_rule_id, "") if x.lease_rule_id else "",
                },
                None,
            )
    elif ds == "billings":
        tenants = {x.id: x for x in db.scalars(q(M.Tenant))}
        t = Table(["suite", "tenant", "bill_date", "amount", "description"], source=f"{prop.name} billings")
        for b in db.scalars(q(M.CamBilling).order_by(M.CamBilling.bill_date, M.CamBilling.source_row)):
            tn = tenants.get(b.tenant_id)
            t.append(
                {
                    "suite": tn.suite if tn else "",
                    "tenant": tn.name if tn else "",
                    "bill_date": b.bill_date.isoformat(),
                    "amount": fmt_decimal(b.amount),
                    "description": b.description,
                },
                b.source_row,
            )
    elif ds == "expense_mappings":
        t = Table(["gl_account", "category", "mapping_status", "explanation"], source=f"{prop.name} expense mappings")
        for m in db.scalars(q(M.ExpenseMapping).order_by(M.ExpenseMapping.gl_account)):
            t.append(
                {
                    "gl_account": m.gl_account,
                    "category": m.category_code or "",
                    "mapping_status": m.status,
                    "explanation": m.explanation,
                },
                None,
            )
    elif ds == "lease_rules":
        t = Table(
            ["rule_ref", "status", "pool", "method", "denominator_sqft", "fixed_pct", "unsupported_terms"],
            source=f"{prop.name} lease rules",
        )
        rules = {r.id: r for r in db.scalars(q(M.LeaseRule).order_by(M.LeaseRule.ref))}
        allocs: dict[uuid.UUID, list[M.AllocationRule]] = defaultdict(list)
        if rules:
            for a in db.scalars(select(M.AllocationRule).where(M.AllocationRule.lease_rule_id.in_(list(rules)))):
                allocs[a.lease_rule_id].append(a)
        for r in rules.values():
            for a in sorted(allocs[r.id], key=lambda a: a.pool) or [None]:
                t.append(
                    {
                        "rule_ref": r.ref,
                        "status": r.status,
                        "pool": a.pool if a else "",
                        "method": a.method if a else "",
                        "denominator_sqft": ""
                        if not a or a.denominator_sqft is None
                        else fmt_decimal(a.denominator_sqft),
                        "fixed_pct": "" if not a or a.fixed_pct is None else str(a.fixed_pct.normalize()),
                        "unsupported_terms": "; ".join(r.unsupported_terms or []),
                    },
                    None,
                )
    else:
        raise NodeError(f"Unknown dataset {ds!r}.")
    return NodeResult(outputs={"out": t}, logs=[f"Loaded {len(t):,} {ds.replace('_', ' ')} rows from {prop.name}."])


DATASETS = (
    ("gl", "General ledger transactions"),
    ("tenants", "Tenant roster"),
    ("billings", "CAM billings"),
    ("expense_mappings", "Expense mappings"),
    ("lease_rules", "Lease rules (one row per pool)"),
)
register(
    NodeSpec(
        "property_data",
        "Existing property data",
        "input",
        "Load committed data for a property in your organization. Read only.",
        (),
        ("out",),
        (PROPERTY_FIELD, ConfigField("dataset", "Dataset", "select", required=True, default="gl", options=DATASETS)),
        _run_property_data,
    )
)


# ============================================================================== Transformations

SYNONYMS: dict[str, list[str]] = {
    "gl_account": ["gl account", "account", "account number", "acct", "gl", "account #", "account code"],
    "account_name": ["account name", "account description", "gl name"],
    "txn_date": ["date", "transaction date", "post date", "posting date", "txn date"],
    "bill_date": ["bill date", "date", "invoice date", "charge date"],
    "amount": ["amount", "net amount", "debit", "charge amount", "billed"],
    "vendor": ["vendor", "payee", "vendor name"],
    "description": ["description", "memo", "memo/description", "details"],
    "tenant": ["tenant", "tenant name", "lessee"],
    "suite": ["suite", "unit", "space"],
    "rule_ref": ["rule ref", "rule_ref", "lease rule", "rule"],
    "category": ["category", "category code", "expense category"],
    "mapping_status": ["status", "mapping status", "recoverability"],
}


def _auto_source(target: str, columns: list[str], taken: set[str]) -> str | None:
    lower = {c.lower().strip(): c for c in columns}
    for cand in [target.lower(), target.replace("_", " ").lower(), *SYNONYMS.get(target, [])]:
        if cand in lower and lower[cand] not in taken:
            return lower[cand]
    return None


def _mapping(c: dict[str, Any]) -> list[dict[str, Any]]:
    m = c.get("mapping") or []
    return [x for x in m if isinstance(x, dict) and str(x.get("target", "")).strip()]


def _validate_mapper(c: dict[str, Any]) -> list[str]:
    m = _mapping(c)
    if not m:
        return ["Add at least one column mapping."]
    targets = [str(x["target"]).strip() for x in m]
    dupes = sorted({t for t in targets if targets.count(t) > 1})
    return [f"Output column {d!r} is mapped twice." for d in dupes]


def _run_mapper(ctx: Context, inp: Inputs, c: dict[str, Any]) -> NodeResult:
    t: Table = inp["in"]
    res = NodeResult()
    chosen: dict[str, str | None] = {}
    taken: set[str] = set()
    for m in _mapping(c):
        target = str(m["target"]).strip()
        src = str(m.get("source") or "").strip()
        if src:
            if src not in t.columns:
                if m.get("required", True):
                    t.require(src, node=ctx.label)
                res.issues.append(
                    issue("warning", "COLUMN_MISSING", f"Source column {src!r} for {target!r} is missing; left blank.")
                )
                chosen[target] = None
                continue
        else:
            found = _auto_source(target, t.columns, taken)
            if found is None:
                if m.get("required", True):
                    raise NodeError(
                        f"No column found for {target!r}. Pick the source column in {ctx.label}. Available: "
                        f"{', '.join(t.columns)}."
                    )
                res.issues.append(
                    issue("info", "COLUMN_NOT_FOUND", f"No column found for optional {target!r}; left blank.")
                )
                chosen[target] = None
                continue
            src = found
        chosen[target] = src
        taken.add(src)
    res.logs.append("Mapping: " + ", ".join(f"{k} <- {v or '(blank)'}" for k, v in chosen.items()))
    extra = [col for col in t.columns if col not in taken] if c.get("keep_unmapped") else []
    out = t.copy_shape([*chosen.keys(), *[e for e in extra if e not in chosen]])
    for row, src_row in zip(t.rows, t.source_rows, strict=True):
        new = {k: (row.get(v, "") if v else "") for k, v in chosen.items()}
        for e in extra:
            if e not in new:
                new[e] = row.get(e, "")
        out.append(new, src_row)
    res.outputs["out"] = out
    return res


register(
    NodeSpec(
        "column_mapper",
        "Column mapper",
        "transform",
        "Rename and select columns. Blank sources are matched automatically by common header names.",
        (Port("in", "Rows"),),
        ("out",),
        (
            ConfigField(
                "mapping", "Mappings", "mapping", required=True, help="Output column, source column, required."
            ),
            ConfigField("keep_unmapped", "Keep other columns", "bool", default=False),
        ),
        _run_mapper,
        _validate_mapper,
    )
)


def _excel_serial(v: str) -> date | None:
    d = to_decimal(v)
    if d is not None and d == d.to_integral_value() and 20000 <= d <= 80000:
        return date(1899, 12, 30) + timedelta(days=int(d))
    return None


def _norm_date(v: str) -> date:
    s = v.strip()
    if " " in s and len(s) > 10:
        s = s.split(" ")[0]
    serial = _excel_serial(s)
    if serial:
        return serial
    for sep in ("-", "/"):
        parts = s.split(sep)
        if len(parts) == 3 and len(parts[0]) <= 2 and len(parts[2]) == 4:  # M/D/YYYY with single digits
            s = f"{int(parts[0]):02d}/{int(parts[1]):02d}/{parts[2]}" if all(p.isdigit() for p in parts) else s
    return parse_date(s.replace("-", "/") if s.count("-") == 2 and len(s.split("-")[0]) <= 2 else s)


def _norm_code(v: str) -> str:
    s = v.strip()
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    return s.upper()


def _run_cleaner(ctx: Context, inp: Inputs, c: dict[str, Any]) -> NodeResult:
    t: Table = inp["in"]
    dates, amounts, codes = _list(c.get("date_columns")), _list(c.get("amount_columns")), _list(c.get("code_columns"))
    required, warn_blank = _list(c.get("required_columns")), _list(c.get("warn_blank_columns"))
    t.require(*dates, *amounts, *codes, *required, *warn_blank, node=ctx.label)
    trim = c.get("trim", True) is not False
    reject = c.get("reject_invalid", True) is not False
    places = int(to_decimal(str(c.get("decimal_places") or 2)) or 2)
    res = NodeResult()
    out, rejected = t.copy_shape(), t.copy_shape([*t.columns, "error"])
    changed = 0
    for row, src in zip(t.rows, t.source_rows, strict=True):
        new = {k: (v.strip() if trim else v) for k, v in row.items()}
        errs: list[str] = []
        for col in codes:
            new[col] = _norm_code(new.get(col, ""))
        for col in required:
            if new.get(col, "").strip() == "":
                errs.append(f"{col} is blank")
                res.issues.append(issue("error", "REQUIRED_BLANK", f"{col} is blank.", src, col))
        for col in dates:
            v = new.get(col, "")
            if v == "":
                continue
            try:
                new[col] = _norm_date(v).isoformat()
            except (ValueError, IndexError):
                errs.append(f"{col} {v!r} is not a date")
                res.issues.append(issue("error", "INVALID_DATE", f"{col} {v!r} is not a recognized date.", src, col, v))
        for col in amounts:
            v = new.get(col, "")
            if v == "":
                continue
            d = to_decimal(v)
            if d is None:
                errs.append(f"{col} {v!r} is not a number")
                res.issues.append(issue("error", "INVALID_AMOUNT", f"{col} {v!r} is not a number.", src, col, v))
            elif d != d.quantize(Decimal(1).scaleb(-places)):
                errs.append(f"{col} {v!r} has more than {places} decimal places")
                res.issues.append(
                    issue(
                        "error", "AMOUNT_PRECISION", f"{col} {v!r} has more than {places} decimal places.", src, col, v
                    )
                )
            else:
                new[col] = fmt_decimal(d, places)
        for col in warn_blank:
            if new.get(col, "").strip() == "":
                res.issues.append(issue("warning", "BLANK_VALUE", f"{col} is blank.", src, col))
        if new != row:
            changed += 1
        if errs and reject:
            rejected.append({**new, "error": "; ".join(errs)}, src)
        else:
            out.append(new, src)
    res.outputs = {"out": out, "rejected": rejected}
    res.logs.append(f"{len(out):,} rows passed, {len(rejected):,} rejected, {changed:,} normalized.")
    res.issues = _cap(res.issues, res.logs)
    return res


register(
    NodeSpec(
        "data_cleaner",
        "Data cleaner",
        "transform",
        "Trim text, normalize dates to YYYY-MM-DD and amounts to exact decimals, and flag blank or invalid values.",
        (Port("in", "Rows"),),
        ("out", "rejected"),
        (
            ConfigField("trim", "Trim whitespace", "bool", default=True),
            ConfigField("date_columns", "Date columns", "columns"),
            ConfigField("amount_columns", "Amount columns", "columns"),
            ConfigField("decimal_places", "Amount decimal places", "number", default=2),
            ConfigField(
                "code_columns", "Code columns", "columns", help="Account codes: trimmed, uppercased, 6100.0 -> 6100."
            ),
            ConfigField("required_columns", "Required columns", "columns"),
            ConfigField("warn_blank_columns", "Warn when blank", "columns"),
            ConfigField("reject_invalid", "Send invalid rows to the rejected output", "bool", default=True),
        ),
        _run_cleaner,
    )
)


OPS = (
    ("equals", "equals"),
    ("not_equals", "does not equal"),
    ("contains", "contains"),
    ("not_contains", "does not contain"),
    ("starts_with", "starts with"),
    ("gt", ">"),
    ("gte", ">="),
    ("lt", "<"),
    ("lte", "<="),
    ("is_blank", "is blank"),
    ("not_blank", "is not blank"),
)
_OP_KEYS = {o[0] for o in OPS}


def _conditions(c: dict[str, Any]) -> list[dict[str, Any]]:
    return [x for x in (c.get("conditions") or []) if isinstance(x, dict) and x.get("column")]


def _validate_filter(c: dict[str, Any]) -> list[str]:
    conds = _conditions(c)
    if not conds:
        return ["Add at least one condition."]
    errs = []
    for x in conds:
        if x.get("op") not in _OP_KEYS:
            errs.append(f"Unknown operator {x.get('op')!r}.")
        if x.get("type", "text") not in ("text", "number", "date"):
            errs.append(f"Unknown value type {x.get('type')!r}.")
        if (
            x.get("op") in ("gt", "gte", "lt", "lte")
            and x.get("type", "text") == "number"
            and to_decimal(str(x.get("value", ""))) is None
        ):
            errs.append(f"{x['column']}: {x.get('value')!r} is not a number.")
    return errs


def _compare(op: str, kind: str, a: str, b: str) -> bool:
    if op == "is_blank":
        return a.strip() == ""
    if op == "not_blank":
        return a.strip() != ""
    if kind == "number":
        x, y = to_decimal(a), to_decimal(b)
        if x is None or y is None:
            raise ValueError("not a number")
        cmp = (x > y) - (x < y)
    elif kind == "date":
        cmp = (lambda x, y: (x > y) - (x < y))(_norm_date(a), _norm_date(b))
    else:
        al, bl = a.strip().lower(), b.strip().lower()
        if op == "contains":
            return bl in al
        if op == "not_contains":
            return bl not in al
        if op == "starts_with":
            return al.startswith(bl)
        cmp = (al > bl) - (al < bl)
    return {
        "equals": cmp == 0,
        "not_equals": cmp != 0,
        "gt": cmp > 0,
        "gte": cmp >= 0,
        "lt": cmp < 0,
        "lte": cmp <= 0,
    }.get(op, False)


def _run_filter(ctx: Context, inp: Inputs, c: dict[str, Any]) -> NodeResult:
    t: Table = inp["in"]
    conds = _conditions(c)
    t.require(*[x["column"] for x in conds], node=ctx.label)
    any_mode = c.get("match") == "any"
    res = NodeResult()
    out, excluded = t.copy_shape(), t.copy_shape()
    for row, src in zip(t.rows, t.source_rows, strict=True):
        results = []
        for x in conds:
            try:
                results.append(
                    _compare(x["op"], x.get("type", "text"), row.get(x["column"], ""), str(x.get("value", "")))
                )
            except (ValueError, IndexError):
                results.append(False)
                res.issues.append(
                    issue(
                        "warning",
                        "FILTER_UNPARSEABLE",
                        f"{x['column']} could not be compared as a {x.get('type')}.",
                        src,
                        x["column"],
                        row.get(x["column"], ""),
                    )
                )
        keep = any(results) if any_mode else all(results)
        (out if keep else excluded).append(row, src)
    res.outputs = {"out": out, "excluded": excluded}
    res.logs.append(f"Kept {len(out):,} of {len(t):,} rows.")
    res.issues = _cap(res.issues, res.logs)
    return res


register(
    NodeSpec(
        "filter_rows",
        "Filter rows",
        "transform",
        "Keep rows that match text, number or date conditions. Excluded rows go to a second output.",
        (Port("in", "Rows"),),
        ("out", "excluded"),
        (
            ConfigField("conditions", "Conditions", "conditions", required=True),
            ConfigField(
                "match", "Match", "select", default="all", options=(("all", "All conditions"), ("any", "Any condition"))
            ),
        ),
        _run_filter,
        _validate_filter,
    )
)


def _run_dedupe(ctx: Context, inp: Inputs, c: dict[str, Any]) -> NodeResult:
    t: Table = inp["in"]
    keys = _list(c.get("key_columns"))
    t.require(*keys, node=ctx.label)
    res = NodeResult()
    out, removed = t.copy_shape(), t.copy_shape([*t.columns, "duplicate_of_row"])
    seen: dict[tuple[str, ...], int | None] = {}
    for row, src in zip(t.rows, t.source_rows, strict=True):
        k = tuple(" ".join(row.get(col, "").split()).lower() for col in keys)
        if k in seen:
            first = seen[k]
            removed.append({**row, "duplicate_of_row": "" if first is None else str(first)}, src)
            res.issues.append(
                issue("warning", "DUPLICATE_ROW", f"Possible duplicate of row {first} ({', '.join(keys)} match).", src)
            )
        else:
            seen[k] = src
            out.append(row, src)
    res.outputs = {"out": out, "removed": removed}
    res.logs.append(
        f"{len(removed):,} possible duplicates set aside on {', '.join(keys)}. Nothing is deleted: see the removed "
        "output."
    )
    res.issues = _cap(res.issues, res.logs)
    return res


register(
    NodeSpec(
        "deduplicate",
        "Deduplicate",
        "transform",
        "Set aside rows whose key columns match an earlier row. Removed rows keep their source row and the row "
        "they duplicate.",
        (Port("in", "Rows"),),
        ("out", "removed"),
        (
            ConfigField(
                "key_columns", "Key columns", "columns", required=True, help="Compared trimmed and case-insensitive."
            ),
        ),
        _run_dedupe,
    )
)


def _run_category(ctx: Context, inp: Inputs, c: dict[str, Any]) -> NodeResult:
    t: Table = inp["in"]
    acct = str(c.get("account_column") or "gl_account")
    t.require(acct, node=ctx.label)
    res = NodeResult()
    rules: dict[str, tuple[str, str]] = {}
    if (c.get("source") or "property") == "property":
        prop = ctx.property(c.get("property_id"))
        for m in ctx.db.scalars(
            select(M.ExpenseMapping).where(
                M.ExpenseMapping.organization_id == ctx.org_id, M.ExpenseMapping.property_id == prop.id
            )
        ):
            rules[_norm_code(m.gl_account)] = (m.category_code or "", m.status)
        res.logs.append(
            f"Using {len(rules)} expense mappings from {prop.name}. Only reviewed decisions are treated as approved."
        )
    else:
        rt: Table | None = inp.get("rules")
        if rt is None:
            raise NodeError("Connect a mapping table to the rules input, or switch the source to a property.")
        ra, rc, rs = (
            str(c.get(k) or d)
            for k, d in (
                ("rules_account_column", "gl_account"),
                ("rules_category_column", "category"),
                ("rules_status_column", "mapping_status"),
            )
        )
        rt.require(ra, rc, rs, node=ctx.label)
        for row, src in zip(rt.rows, rt.source_rows, strict=True):
            status = row.get(rs, "").strip().lower().replace(" ", "_").replace("-", "")
            status = {"nonrecoverable": "nonrecoverable", "non_recoverable": "nonrecoverable"}.get(status, status)
            if status not in ("recoverable", "nonrecoverable", "needs_review"):
                res.issues.append(
                    issue(
                        "warning",
                        "MAPPING_STATUS_INVALID",
                        f"Mapping status {row.get(rs)!r} treated as needs_review.",
                        src,
                        rs,
                    )
                )
                status = "needs_review"
            rules[_norm_code(row.get(ra, ""))] = (row.get(rc, "").strip(), status)
        res.logs.append(f"Using {len(rules)} mappings from the connected table.")
    out = t.copy_shape(
        [*[col for col in t.columns if col not in ("category", "mapping_status")], "category", "mapping_status"]
    )
    flagged: dict[str, int] = defaultdict(int)
    first_row: dict[str, int | None] = {}
    for row, src in zip(t.rows, t.source_rows, strict=True):
        code = _norm_code(row.get(acct, ""))
        cat, status = rules.get(code, ("", "unmapped"))
        if status in ("unmapped", "needs_review"):
            flagged[f"{status}:{code}"] += 1
            first_row.setdefault(f"{status}:{code}", src)
        out.append({**row, "category": cat, "mapping_status": status}, src)
    for k, n in sorted(flagged.items()):
        status, code = k.split(":", 1)
        msg = (
            f"GL account {code or '(blank)'} has no approved mapping ({n} row{'s' if n > 1 else ''})."
            if status == "unmapped"
            else f"GL account {code} mapping needs review ({n} row{'s' if n > 1 else ''})."
        )
        res.issues.append(
            issue(
                "warning",
                "UNMAPPED_ACCOUNT" if status == "unmapped" else "MAPPING_NEEDS_REVIEW",
                msg,
                first_row[k],
                acct,
                code,
            )
        )
    res.outputs["out"] = out
    res.logs.append(f"{sum(flagged.values()):,} rows need a mapping decision.")
    return res


register(
    NodeSpec(
        "category_mapper",
        "Category mapper",
        "transform",
        "Attach expense category and recoverability from approved mapping decisions. Never guesses from account names.",
        (Port("in", "Transactions"), Port("rules", "Mapping table", required=False)),
        ("out",),
        (
            ConfigField("account_column", "GL account column", "column", default="gl_account"),
            ConfigField(
                "source",
                "Mapping source",
                "select",
                default="property",
                options=(("property", "Property expense mappings"), ("table", "Connected mapping table")),
            ),
            ConfigField("property_id", "Property", "property", required=True, show_if=("source", "property")),
            ConfigField(
                "rules_account_column",
                "Table: account column",
                "text",
                default="gl_account",
                show_if=("source", "table"),
            ),
            ConfigField(
                "rules_category_column",
                "Table: category column",
                "text",
                default="category",
                show_if=("source", "table"),
            ),
            ConfigField(
                "rules_status_column",
                "Table: status column",
                "text",
                default="mapping_status",
                show_if=("source", "table"),
            ),
        ),
        _run_category,
    )
)


def _validate_formula(c: dict[str, Any]) -> list[str]:
    try:
        compile_expression(str(c.get("expression") or ""))
    except NodeError as e:
        return [str(e)]
    return []


def _run_formula(ctx: Context, inp: Inputs, c: dict[str, Any]) -> NodeResult:
    t: Table = inp["in"]
    target = str(c.get("target") or "").strip()
    places = int(to_decimal(str(c.get("decimal_places") if c.get("decimal_places") not in (None, "") else 2)) or 0)
    evaluate, refs = compile_expression(str(c.get("expression") or ""))
    t.require(*refs, node=ctx.label)
    res = NodeResult()
    out = t.copy_shape(t.columns if target in t.columns else [*t.columns, target])
    bad = 0
    for row, src in zip(t.rows, t.source_rows, strict=True):
        try:
            val = fmt_decimal(evaluate(row), places)
        except RowError as e:
            bad += 1
            val = ""
            res.issues.append(issue("error", "FORMULA_ROW", f"{target}: {e}.", src, target))
        out.append({**row, target: val}, src)
    res.outputs["out"] = out
    res.logs.append(
        f"{target} = {c.get('expression')} (Decimal, {places} places, half up). {bad} rows could not be computed."
    )
    res.issues = _cap(res.issues, res.logs)
    return res


register(
    NodeSpec(
        "formula",
        "Formula",
        "transform",
        "Compute a column with + - * / round abs min max over [Column] references. Decimal arithmetic only.",
        (Port("in", "Rows"),),
        ("out",),
        (
            ConfigField("target", "Output column", "text", required=True),
            ConfigField(
                "expression", "Expression", "expression", required=True, help="Example: round([amount] * 0.15, 2)"
            ),
            ConfigField("decimal_places", "Decimal places", "number", default=2),
        ),
        _run_formula,
        _validate_formula,
    )
)


# ===================================================================================== Financial


def _run_classify(ctx: Context, inp: Inputs, c: dict[str, Any]) -> NodeResult:
    t: Table = inp["in"]
    sc, ac = str(c.get("status_column") or "mapping_status"), str(c.get("amount_column") or "amount")
    t.require(sc, ac, node=ctx.label)
    res = NodeResult()
    buckets = {"recoverable": t.copy_shape(), "nonrecoverable": t.copy_shape(), "review": t.copy_shape()}
    totals = {k: Decimal("0") for k in buckets}
    for row, src in zip(t.rows, t.source_rows, strict=True):
        status = row.get(sc, "").strip().lower()
        key = status if status in ("recoverable", "nonrecoverable") else "review"
        buckets[key].append(row, src)
        d = to_decimal(row.get(ac, ""))
        if d is None:
            res.issues.append(
                issue("error", "INVALID_AMOUNT", f"{ac} {row.get(ac)!r} is not a number; not totaled.", src, ac)
            )
        else:
            totals[key] += d
    for k, b in buckets.items():
        res.logs.append(f"{k}: {len(b):,} rows, {fmt_decimal(totals[k])}")
    if len(buckets["review"]):
        res.issues.append(
            issue(
                "warning",
                "REVIEW_REQUIRED",
                f"{len(buckets['review']):,} rows ({fmt_decimal(totals['review'])}) need a recoverability decision "
                "before they count.",
            )
        )
    res.outputs = buckets
    return res


register(
    NodeSpec(
        "expense_classification",
        "Expense classification",
        "financial",
        "Split rows into recoverable, nonrecoverable and review-required using the approved mapping status.",
        (Port("in", "Mapped transactions"),),
        ("recoverable", "nonrecoverable", "review"),
        (
            ConfigField("status_column", "Mapping status column", "column", default="mapping_status"),
            ConfigField("amount_column", "Amount column", "column", default="amount"),
        ),
        _run_classify,
    )
)


SEVERITY = {"error": "error", "warning": "warning", "info": "info"}


def _run_allocation(ctx: Context, _inp: Inputs, c: dict[str, Any]) -> NodeResult:
    prop = ctx.property(c.get("property_id"))
    periods = ctx.db.scalars(
        select(M.ReportingPeriod)
        .where(M.ReportingPeriod.organization_id == ctx.org_id, M.ReportingPeriod.property_id == prop.id)
        .order_by(M.ReportingPeriod.through_date.desc())
    ).all()
    if c.get("period_id"):
        period = next((p for p in periods if str(p.id) == str(c["period_id"])), None)
        if period is None:
            raise NodeError("The selected reporting period was not found for this property.")
    elif periods:
        period = periods[0]
    else:
        raise NodeError(f"{prop.name} has no reporting period. Add one in Property setup.")
    threshold = _threshold(c)
    snap = build_snapshot(ctx.db, prop, period, threshold)
    out = run_audit(input_from_snapshot(snap))  # the same engine and inputs as an audit run; nothing is persisted
    pools = sorted(out.pools)
    t = Table(
        ["suite", "tenant", "status", *pools, "admin_fee", "total", "billed", "variance", "unresolved_reasons"],
        source=f"{prop.name} allocation",
    )
    suites = {x["id"]: x.get("suite", "") for x in snap["tenants"]}
    for r in out.tenants:
        by_pool = {ln.pool: ln.amount for ln in r.lines}
        row = {
            "suite": suites.get(r.tenant_id, ""),
            "tenant": r.tenant_name,
            "status": r.status,
            **{p: fmt_decimal(by_pool[p]) if p in by_pool and by_pool[p] is not None else "" for p in pools},
            "admin_fee": fmt_decimal(r.admin_fee),
            "total": "" if r.total is None else fmt_decimal(r.total),
            "billed": "" if r.billed is None else fmt_decimal(r.billed),
            "variance": "" if r.variance is None else fmt_decimal(r.variance),
            "unresolved_reasons": "; ".join(r.unresolved_reasons),
        }
        t.append(row, None)
    res = NodeResult(outputs={"out": t})
    for e in out.exceptions:
        res.issues.append(issue(SEVERITY.get(e.severity.value, "warning"), e.type.value, e.message))
    res.logs += [
        f"{prop.name}, {period.label} through {period.through_date.isoformat()}. Engine {ENGINE_VERSION}, input "
        f"{snapshot_hash(snap)[:12]}.",
        f"{sum(1 for r in out.tenants if r.status == 'calculated')} calculated, "
        f"{sum(1 for r in out.tenants if r.status != 'calculated')} unresolved. Provisional, not a final "
        "reconciliation.",
    ]
    return res


register(
    NodeSpec(
        "tenant_allocation",
        "Tenant allocation",
        "financial",
        "Run Veyra's calculation engine on the property's approved inputs. Same results as an audit run; nothing "
        "is saved.",
        (),
        ("out",),
        (
            PROPERTY_FIELD,
            ConfigField("period_id", "Reporting period", "period", help="Blank uses the latest period."),
            ConfigField("variance_threshold", "Variance threshold", "number", default=500),
        ),
        _run_allocation,
    )
)


def _run_billing(ctx: Context, inp: Inputs, c: dict[str, Any]) -> NodeResult:
    alloc: Table = inp["allocations"]
    bills: Table = inp["billings"]
    ak, an, aa = (
        str(c.get(k) or d)
        for k, d in (("allocation_key", "suite"), ("allocation_name", "tenant"), ("allocation_amount", "total"))
    )
    bk, ba = str(c.get("billing_key") or "tenant"), str(c.get("billing_amount") or "amount")
    alloc.require(ak, an, aa, node=ctx.label)
    bills.require(bk, ba, node=ctx.label)
    threshold = _threshold(c)
    res = NodeResult()
    by_key: dict[str, int] = {}
    by_name: dict[str, list[int]] = defaultdict(list)
    for i, row in enumerate(alloc.rows):
        if row.get(ak, "").strip():
            by_key[row[ak].strip().lower()] = i
        by_name[row.get(an, "").strip().lower()].append(i)
    billed: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    unmatched = Table(["billing_key", "amount", "source_rows"])
    unmatched_rows: dict[str, list[int | None]] = defaultdict(list)
    unmatched_amt: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for row, src in zip(bills.rows, bills.source_rows, strict=True):
        key = row.get(bk, "").strip().lower()
        amt = to_decimal(row.get(ba, ""))
        if amt is None:
            res.issues.append(
                issue("error", "INVALID_AMOUNT", f"Billing amount {row.get(ba)!r} is not a number; excluded.", src, ba)
            )
            continue
        idx = by_key.get(key)
        if idx is None and len(by_name.get(key, [])) == 1:
            idx = by_name[key][0]
        if idx is None:
            unmatched_rows[row.get(bk, "")].append(src)
            unmatched_amt[row.get(bk, "")] += amt
            continue
        billed[idx] += amt
    out = Table(
        ["suite", "tenant", "calculated", "billed", "difference", "direction", "status"], source="billing comparison"
    )
    for i, row in enumerate(alloc.rows):
        calc = to_decimal(row.get(aa, ""))
        b = billed.get(i)
        status = "matched"
        if calc is None:
            status = "not calculated"
            res.issues.append(
                issue(
                    "error",
                    "ALLOCATION_MISSING",
                    f"{row.get(an)}: no calculated amount ({row.get('unresolved_reasons') or 'unresolved'}).",
                )
            )
        if b is None:
            status = "no billings" if calc is not None else status
            res.issues.append(
                issue("warning", "MISSING_BILLINGS", f"{row.get(an)}: no billing rows matched {ak} {row.get(ak)!r}.")
            )
        diff = calc - b if calc is not None and b is not None else None
        if diff is not None and abs(diff) > threshold:
            res.issues.append(
                issue(
                    "warning",
                    "VARIANCE_OVER_THRESHOLD",
                    f"{row.get(an)}: provisional difference {fmt_decimal(diff)} exceeds {fmt_decimal(threshold)}.",
                )
            )
        out.append(
            {
                "suite": row.get(ak, ""),
                "tenant": row.get(an, ""),
                "calculated": "" if calc is None else fmt_decimal(calc),
                "billed": "" if b is None else fmt_decimal(b),
                "difference": "" if diff is None else fmt_decimal(diff),
                "direction": ""
                if diff is None
                else ("under-billed" if diff > 0 else "over-billed" if diff < 0 else "even"),
                "status": status,
            },
            None,
        )
    for k, rows in unmatched_rows.items():
        unmatched.append(
            {"billing_key": k, "amount": fmt_decimal(unmatched_amt[k]), "source_rows": ", ".join(str(r) for r in rows)},
            rows[0],
        )
        res.issues.append(
            issue(
                "error",
                "UNMATCHED_BILLING",
                f"Billing tenant {k!r} matches no allocation ({len(rows)} rows, {fmt_decimal(unmatched_amt[k])}).",
                rows[0],
                bk,
                k,
            )
        )
    res.outputs = {"out": out, "unmatched": unmatched}
    res.logs.append(
        f"Matched billings for {len(billed)} of {len(alloc)} tenants. {len(unmatched)} billing keys unmatched. "
        "Differences are provisional."
    )
    return res


register(
    NodeSpec(
        "billing_comparison",
        "Billing comparison",
        "financial",
        "Compare calculated allocations with recorded billings by suite (or a unique tenant name). Differences are "
        "provisional.",
        (Port("allocations", "Allocations"), Port("billings", "Billings")),
        ("out", "unmatched"),
        (
            ConfigField("allocation_key", "Allocation key column", "text", default="suite"),
            ConfigField("allocation_name", "Allocation tenant column", "text", default="tenant"),
            ConfigField("allocation_amount", "Calculated amount column", "text", default="total"),
            ConfigField(
                "billing_key",
                "Billing tenant column",
                "text",
                default="tenant",
                help="Matched to the key, then to a unique tenant name.",
            ),
            ConfigField("billing_amount", "Billing amount column", "text", default="amount"),
            ConfigField("variance_threshold", "Variance threshold", "number", default=500),
        ),
        _run_billing,
    )
)


SUPPORTED_METHODS = {"pro_rata", "fixed_pct"}


def _run_lease_check(ctx: Context, inp: Inputs, c: dict[str, Any]) -> NodeResult:
    tenants: Table = inp["tenants"]
    rules: Table = inp["rules"]
    tk, tn, tr = (
        str(c.get(k) or d)
        for k, d in (("tenant_key", "suite"), ("tenant_name", "tenant"), ("tenant_rule_column", "rule_ref"))
    )
    rr, st, me, de, fp, un = (
        str(c.get(k) or d)
        for k, d in (
            ("rule_ref_column", "rule_ref"),
            ("status_column", "status"),
            ("method_column", "method"),
            ("denominator_column", "denominator_sqft"),
            ("fixed_pct_column", "fixed_pct"),
            ("unsupported_column", "unsupported_terms"),
        )
    )
    tenants.require(tk, tn, tr, node=ctx.label)
    rules.require(rr, me, node=ctx.label)
    has_status, has_den, has_fp, has_un = (x in rules.columns for x in (st, de, fp, un))
    by_ref: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rules.rows:
        by_ref[row.get(rr, "").strip().upper()].append(row)
    res = NodeResult()
    out = Table(["suite", "tenant", "rule_ref", "readiness", "findings"], source="lease rule audit")
    for row, src in zip(tenants.rows, tenants.source_rows, strict=True):
        ref = row.get(tr, "").strip().upper()
        who = f"{row.get(tn, '')} ({tk} {row.get(tk, '')})"
        blocking: list[str] = []
        review: list[str] = []
        if not ref:
            blocking.append("no lease rule assigned")
            res.issues.append(issue("error", "MISSING_LEASE_RULE", f"{who} has no lease rule.", src, tr))
        elif ref not in by_ref:
            blocking.append(f"rule {ref} not found")
            res.issues.append(
                issue("error", "RULE_NOT_FOUND", f"{who}: rule {ref} is not in the rule table.", src, tr, ref)
            )
        else:
            pools = by_ref[ref]
            status = pools[0].get(st, "").strip().lower() if has_status else ""
            if not has_status or not status:
                review.append("approval status not provided")
                res.issues.append(
                    issue("warning", "RULE_STATUS_UNKNOWN", f"{who}: rule {ref} has no approval status.", src)
                )
            elif status != "approved":
                review.append(f"rule is {status}, not approved")
                res.issues.append(issue("warning", "RULE_NOT_APPROVED", f"{who}: rule {ref} is {status}.", src))
            for p in pools:
                pool = p.get("pool", "") or "(pool)"
                method = p.get(me, "").strip().lower()
                if method and method not in SUPPORTED_METHODS:
                    blocking.append(f"{pool}: method {method} not supported")
                    res.issues.append(
                        issue(
                            "error",
                            "UNSUPPORTED_METHOD",
                            f"{who}: {pool} uses {method!r}, which the engine does not support.",
                            src,
                        )
                    )
                if method == "pro_rata" and (not has_den or to_decimal(p.get(de, "")) is None):
                    blocking.append(f"{pool}: denominator missing")
                    res.issues.append(
                        issue("error", "MISSING_DENOMINATOR", f"{who}: {pool} pro rata rule has no denominator.", src)
                    )
                if method == "fixed_pct" and (not has_fp or to_decimal(p.get(fp, "")) is None):
                    blocking.append(f"{pool}: fixed percentage missing")
                    res.issues.append(
                        issue(
                            "error", "MISSING_FIXED_PCT", f"{who}: {pool} fixed percentage rule has no percentage.", src
                        )
                    )
                if has_un and p.get(un, "").strip():
                    blocking.append(f"{pool}: unsupported terms ({p[un].strip()})")
                    res.issues.append(
                        issue(
                            "error", "UNSUPPORTED_RULE", f"{who}: {pool} has unsupported terms: {p[un].strip()}.", src
                        )
                    )
        readiness = "blocked" if blocking else "needs review" if review else "ready"
        out.append(
            {
                "suite": row.get(tk, ""),
                "tenant": row.get(tn, ""),
                "rule_ref": ref,
                "readiness": readiness,
                "findings": "; ".join(blocking + review),
            },
            src,
        )
    counts = defaultdict(int)
    for r in out.rows:
        counts[r["readiness"]] += 1
    res.logs.append(", ".join(f"{k}: {v}" for k, v in sorted(counts.items())) or "No tenants.")
    res.outputs["out"] = out
    return res


register(
    NodeSpec(
        "lease_rule_check",
        "Lease rule completeness",
        "financial",
        "Check each tenant has an approved, complete and supported lease rule.",
        (Port("tenants", "Tenant roster"), Port("rules", "Lease rules")),
        ("out",),
        (
            ConfigField("tenant_key", "Roster: suite column", "text", default="suite"),
            ConfigField("tenant_name", "Roster: tenant column", "text", default="tenant"),
            ConfigField("tenant_rule_column", "Roster: rule column", "text", default="rule_ref"),
            ConfigField("rule_ref_column", "Rules: reference column", "text", default="rule_ref"),
            ConfigField("status_column", "Rules: status column", "text", default="status"),
            ConfigField("method_column", "Rules: method column", "text", default="method"),
            ConfigField("denominator_column", "Rules: denominator column", "text", default="denominator_sqft"),
            ConfigField("fixed_pct_column", "Rules: fixed % column", "text", default="fixed_pct"),
            ConfigField("unsupported_column", "Rules: unsupported terms column", "text", default="unsupported_terms"),
        ),
        _run_lease_check,
    )
)


def _run_detect(ctx: Context, inp: Inputs, c: dict[str, Any]) -> NodeResult:
    t: Table = inp["in"]
    req, uniq, amts = _list(c.get("required_columns")), _list(c.get("unique_columns")), _list(c.get("amount_columns"))
    sc = str(c.get("status_column") or "")
    review_vals = {v.lower() for v in _list(c.get("review_values") or "needs_review,unmapped")}
    t.require(*req, *uniq, *amts, *([sc] if sc else []), node=ctx.label)
    res = NodeResult(outputs={"out": t})
    seen: dict[tuple[str, ...], int | None] = {}
    for row, src in zip(t.rows, t.source_rows, strict=True):
        for col in req:
            if not row.get(col, "").strip():
                res.issues.append(issue("error", "REQUIRED_BLANK", f"{col} is blank.", src, col))
        for col in amts:
            if row.get(col, "").strip() and to_decimal(row[col]) is None:
                res.issues.append(
                    issue("error", "INVALID_AMOUNT", f"{col} {row[col]!r} is not a number.", src, col, row[col])
                )
        if uniq:
            k = tuple(row.get(col, "").strip().lower() for col in uniq)
            if k in seen:
                res.issues.append(
                    issue("warning", "DUPLICATE_ROW", f"Duplicate of row {seen[k]} on {', '.join(uniq)}.", src)
                )
            else:
                seen[k] = src
        if sc and row.get(sc, "").strip().lower() in review_vals:
            res.issues.append(issue("warning", "UNRESOLVED_CLASSIFICATION", f"{sc} is {row[sc]}.", src, sc))
    res.issues = _cap(res.issues, res.logs)
    res.logs.append(f"{len(res.issues):,} exceptions in {len(t):,} rows. Rows pass through unchanged.")
    return res


register(
    NodeSpec(
        "exception_detection",
        "Exception detection",
        "financial",
        "Flag blank required values, invalid amounts, duplicates and unresolved classifications. Rows pass through "
        "unchanged.",
        (Port("in", "Rows"),),
        ("out",),
        (
            ConfigField("required_columns", "Required columns", "columns"),
            ConfigField("amount_columns", "Amount columns", "columns"),
            ConfigField("unique_columns", "Duplicate key columns", "columns"),
            ConfigField("status_column", "Classification column", "column"),
            ConfigField("review_values", "Unresolved values", "text", default="needs_review,unmapped"),
        ),
        _run_detect,
    )
)


# ======================================================================================= Outputs


def issues_table(issues: list[dict[str, Any]]) -> Table:
    t = Table(["severity", "step", "code", "message", "column", "value"], source="exceptions")
    order = {"error": 0, "warning": 1, "info": 2}
    for i in sorted(issues, key=lambda x: (order.get(x["severity"], 3), x.get("step", ""), x.get("row") or 0)):
        t.append(
            {
                "severity": i["severity"],
                "step": i.get("step", ""),
                "code": i["code"],
                "message": i["message"],
                "column": i.get("column", ""),
                "value": i.get("value", ""),
            },
            i.get("row"),
        )
    return t


def _filename(c: dict[str, Any], default: str, ext: str) -> str:
    name = "".join(ch for ch in str(c.get("filename") or default) if ch.isalnum() or ch in "-_ .").strip() or default
    return name if name.lower().endswith(ext) else name + ext


def _run_excel(ctx: Context, inp: Inputs, c: dict[str, Any]) -> NodeResult:
    sheets: list[tuple[str, Table]] = list(inp.get("sheets") or [])
    issues = ctx.ancestor_issues()
    if c.get("include_issues", True) is not False:
        sheets.append(("Exceptions", issues_table(issues)))
    if not sheets:
        raise NodeError("Connect at least one step to this export.")
    name = _filename(c, "workflow-output", ".xlsx")
    data = to_xlsx_bytes(sheets, ctx.provenance())
    return NodeResult(
        artifacts=[Artifact(name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data)],
        logs=[f"Wrote {name}: {', '.join(f'{t} ({len(tb):,})' for t, tb in sheets)}."],
    )


register(
    NodeSpec(
        "excel_export",
        "Excel export",
        "output",
        "Write a formatted workbook: one sheet per connected step, a run cover sheet and an exceptions sheet.",
        (Port("sheets", "Sheets", multi=True),),
        (),
        (
            ConfigField("filename", "File name", "text", default="workflow-output.xlsx"),
            ConfigField("include_issues", "Add exceptions sheet", "bool", default=True),
        ),
        _run_excel,
    )
)


def _run_csv(ctx: Context, inp: Inputs, c: dict[str, Any]) -> NodeResult:
    t: Table = inp["in"]
    name = _filename(c, "workflow-output", ".csv")
    return NodeResult(
        artifacts=[Artifact(name, "text/csv", to_csv_bytes(t))], logs=[f"Wrote {name} ({len(t):,} rows)."]
    )


register(
    NodeSpec(
        "csv_export",
        "CSV export",
        "output",
        "Write machine-readable CSV. Cells that a spreadsheet would run as formulas are escaped.",
        (Port("in", "Rows"),),
        (),
        (ConfigField("filename", "File name", "text", default="workflow-output.csv"),),
        _run_csv,
    )
)


def _run_exception_report(ctx: Context, _inp: Inputs, c: dict[str, Any]) -> NodeResult:
    t = issues_table(ctx.ancestor_issues())
    name = _filename(c, "exceptions", ".xlsx")
    data = to_xlsx_bytes([("Exceptions", t)], ctx.provenance())
    counts = defaultdict(int)
    for r in t.rows:
        counts[r["severity"]] += 1
    return NodeResult(
        outputs={"out": t},
        artifacts=[Artifact(name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data)],
        logs=[
            f"{len(t):,} exceptions from upstream steps "
            f"({', '.join(f'{k} {v}' for k, v in sorted(counts.items())) or 'none'})."
        ],
    )


register(
    NodeSpec(
        "exception_report",
        "Exception report",
        "output",
        "Collect every issue raised by upstream steps into a reviewable table and workbook.",
        (Port("in", "After steps", multi=True),),
        ("out",),
        (ConfigField("filename", "File name", "text", default="exceptions.xlsx"),),
        _run_exception_report,
    )
)


def _run_gate(_ctx: Context, inp: Inputs, _c: dict[str, Any]) -> NodeResult:
    # The engine pauses before running this node and only calls it after approval.
    return NodeResult(outputs={"out": inp["in"]}, logs=["Approved. Rows pass through unchanged."])


register(
    NodeSpec(
        "approval_gate",
        "Approval gate",
        "control",
        "Pause the run until a reviewer approves or rejects with a note.",
        (Port("in", "Rows"),),
        ("out",),
        (
            ConfigField(
                "instructions", "Reviewer instructions", "textarea", default="Review the exceptions before continuing."
            ),
        ),
        _run_gate,
    )
)
