"""Spreadsheet import: safe parsing, preview, column mapping, row validation.

Invalid rows are never silently discarded. They are stored on the batch with errors.
"""

from __future__ import annotations

import hashlib
import io
from datetime import date, datetime
from decimal import Decimal

import pandas as pd
from openpyxl import load_workbook

from veyra_engine.money import D

FIELDS = {
    "gl": (["gl_account", "txn_date", "amount"], ["account_name", "vendor", "description"]),
    "billings": (["tenant", "bill_date", "amount"], ["description"]),
    "lease_rules": (
        ["rule_ref", "tenant", "pool", "method"],
        [
            "denominator_sqft",
            "fixed_pct",
            "excluded_categories",
            "base_year_amount",
            "gross_up_target",
            "gross_up_actual",
            "cap_kind",
            "cap_pct",
            "cap_prior_year",
            "admin_fee_pct",
            "admin_fee_pools",
            "admin_fee_order",
            "unsupported_terms",
            "source_ref",
        ],
    ),
}

SYNONYMS = {
    "gl_account": ["gl account", "account", "account number", "acct", "gl", "account #"],
    "account_name": ["account name", "account description", "gl name"],
    "txn_date": ["date", "transaction date", "post date", "posting date", "txn date"],
    "bill_date": ["date", "bill date", "invoice date", "charge date"],
    "amount": ["amount", "debit", "net amount", "charge amount"],
    "vendor": ["vendor", "payee", "name"],
    "description": ["description", "memo", "memo/description", "details"],
    "tenant": ["tenant", "tenant name", "lessee", "suite"],
}


class ImportError_(ValueError):
    pass


def sniff_kind(filename: str, content: bytes) -> str:
    name = filename.lower()
    if name.endswith(".xlsx"):
        if not content.startswith(b"PK\x03\x04"):
            raise ImportError_("File has an .xlsx name but is not a valid XLSX file.")
        return "xlsx"
    if name.endswith(".csv"):
        if b"\x00" in content[:4096]:
            raise ImportError_("CSV file contains binary data.")
        try:
            content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ImportError_("CSV must be UTF-8 encoded.") from exc
        return "csv"
    raise ImportError_("Only .csv and .xlsx files are accepted.")


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _cell_to_str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        # Excel stores numbers as doubles. repr gives the shortest exact round-trip text.
        return repr(v)
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return str(v).strip()


def read_table(fmt: str, content: bytes) -> pd.DataFrame:
    """Read every cell as text. Money is parsed later with Decimal, never float."""
    if fmt == "csv":
        df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False, encoding="utf-8-sig")
    else:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        rows = [[_cell_to_str(c) for c in r] for r in ws.iter_rows(values_only=True)]
        wb.close()
        if not rows:
            raise ImportError_("The first worksheet is empty.")
        header = [h or f"column_{i + 1}" for i, h in enumerate(rows[0])]
        df = pd.DataFrame(rows[1:], columns=header)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.fillna("")
    # Drop rows that are entirely blank (not invalid, just empty spreadsheet lines).
    return df[~(df.apply(lambda r: all(str(x).strip() == "" for x in r), axis=1))]


def suggest_map(kind: str, columns: list[str]) -> dict[str, str]:
    req, opt = FIELDS[kind]
    lower = {c.lower(): c for c in columns}
    out = {}
    for f in req + opt:
        if f in lower:
            out[f] = lower[f]
            continue
        for syn in SYNONYMS.get(f, []):
            if syn in lower and lower[syn] not in out.values():
                out[f] = lower[syn]
                break
    return out


def parse_date(v: str) -> date:
    v = v.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Unrecognized date {v!r}. Use YYYY-MM-DD or MM/DD/YYYY.")


def parse_money(v: str) -> Decimal:
    if v.strip() == "":
        raise ValueError("Amount is blank.")
    d = D(v)
    if d != d.quantize(Decimal("0.01")) and abs(d - d.quantize(Decimal("0.01"))) > Decimal("0.000001"):
        raise ValueError(f"Amount {v!r} has more than 2 decimal places.")
    return d.quantize(Decimal("0.01"))


def parse_optional_decimal(v: str) -> Decimal | None:
    return None if v.strip() == "" else D(v)


def validate_rows(kind: str, df: pd.DataFrame, column_map: dict[str, str]):
    """Yield (source_row, values, errors). source_row is the 1-based spreadsheet row incl. header."""
    req, _opt = FIELDS[kind]
    missing = [f for f in req if f not in column_map or column_map[f] not in df.columns]
    if missing:
        raise ImportError_(f"Required fields are not mapped to a column: {', '.join(missing)}")
    for idx, (_, row) in enumerate(df.iterrows()):
        source_row = idx + 2
        raw = {f: str(row[c]).strip() for f, c in column_map.items() if c in df.columns}
        errors, vals = [], dict(raw)
        for f in req:
            if raw.get(f, "") == "":
                errors.append(f"{f} is blank")
        try:
            if kind == "gl" and raw.get("txn_date"):
                vals["txn_date"] = parse_date(raw["txn_date"])
            if kind == "billings" and raw.get("bill_date"):
                vals["bill_date"] = parse_date(raw["bill_date"])
        except ValueError as e:
            errors.append(str(e))
        if kind in ("gl", "billings") and raw.get("amount", "") != "":
            try:
                vals["amount"] = parse_money(raw["amount"])
            except (ValueError, TypeError) as e:
                errors.append(str(e))
        if kind == "lease_rules":
            if raw.get("method") and raw["method"] not in ("pro_rata", "fixed_pct"):
                errors.append("method must be pro_rata or fixed_pct")
            for f in (
                "denominator_sqft",
                "fixed_pct",
                "base_year_amount",
                "gross_up_target",
                "gross_up_actual",
                "cap_pct",
                "cap_prior_year",
                "admin_fee_pct",
            ):
                try:
                    vals[f] = parse_optional_decimal(raw.get(f, ""))
                except (ValueError, TypeError):
                    errors.append(f"{f} is not a number")
            if raw.get("cap_kind") and raw["cap_kind"] not in ("noncumulative", "cumulative", "cpi"):
                errors.append("cap_kind must be noncumulative, cumulative or cpi")
            if raw.get("admin_fee_order") and raw["admin_fee_order"] not in ("after_cap", "before_cap"):
                errors.append("admin_fee_order must be after_cap or before_cap")
        yield source_row, vals, errors


def split_list(v: str | None) -> list[str]:
    return [x.strip() for x in (v or "").split(";") if x.strip()]


# Staging -------------------------------------------------------------------------------------
# These functions add rows to the caller's transaction. They never commit.

PARSER_VERSION = "2"


class TenantMatcher:
    """Resolve a billing or rule row to exactly one tenant by name or suite (F-01).

    Matching is case-insensitive. A value that matches more than one tenant (two tenants with the
    same name, or a name equal to another tenant's suite) is rejected, never guessed.
    """

    def __init__(self, tenants):
        self._index: dict[str, set] = {}
        self._by_id = {}
        for t in tenants:
            self._by_id[t.id] = t
            for key in {t.name.strip().lower(), (t.suite or "").strip().lower()} - {""}:
                self._index.setdefault(key, set()).add(t.id)

    def find(self, value: str):
        ids = self._index.get((value or "").strip().lower(), set())
        if len(ids) == 1:
            return self._by_id[next(iter(ids))], None
        if not ids:
            return None, f"Tenant {value!r} does not match any tenant name or suite"
        return None, (f"Tenant {value!r} matches more than one tenant. Use the suite number to identify the tenant.")


def _reject(rejected, src, errs, v):
    rejected.append({"row": src, "errors": errs, "values": {k: str(x) for k, x in v.items()}})


def stage_gl(db, actor, batch, rows) -> dict:
    from sqlalchemy import select

    from .. import models as M

    pid = batch.property_id
    existing = {
        (t.gl_account, t.txn_date, t.amount, (t.description or "").lower())
        for t in db.scalars(
            select(M.GLTransaction).where(
                M.GLTransaction.organization_id == actor.org_id, M.GLTransaction.property_id == pid
            )
        )
    }
    seen: set = set()
    rejected: list = []
    warnings: list[str] = []
    accepted = 0
    for src, v, errs in rows:
        if errs:
            _reject(rejected, src, errs, v)
            continue
        key = (v["gl_account"], v["txn_date"], v["amount"], v.get("description", "").lower())
        if key in seen or key in existing:
            warnings.append(
                f"Row {src}: possible duplicate of another transaction "
                f"({v['gl_account']} {v['txn_date']} {v['amount']}). Kept and flagged."
            )
        seen.add(key)
        db.add(
            M.GLTransaction(
                organization_id=actor.org_id,
                property_id=pid,
                import_batch_id=batch.id,
                source_row=src,
                gl_account=v["gl_account"],
                account_name=v.get("account_name", ""),
                txn_date=v["txn_date"],
                amount=v["amount"],
                vendor=v.get("vendor", ""),
                description=v.get("description", ""),
            )
        )
        accepted += 1
    # Every new account starts as needs_review, so nothing is recoverable by default.
    accounts = {v["gl_account"] for _, v, e in rows if not e}
    mapped = set(
        db.scalars(
            select(M.ExpenseMapping.gl_account).where(
                M.ExpenseMapping.organization_id == actor.org_id, M.ExpenseMapping.property_id == pid
            )
        )
    )
    for a in sorted(accounts - mapped):
        db.add(M.ExpenseMapping(organization_id=actor.org_id, property_id=pid, gl_account=a, status="needs_review"))
    db.flush()
    return {"accepted": accepted, "rejected": rejected, "warnings": warnings}


def stage_billings(db, actor, batch, rows, match: TenantMatcher) -> dict:
    from .. import models as M

    rejected: list = []
    accepted = 0
    for src, v, errs in rows:
        t = None
        if not errs:
            t, err = match.find(v.get("tenant", ""))
            if err:
                errs = [err]
        if errs:
            _reject(rejected, src, errs, v)
            continue
        db.add(
            M.CamBilling(
                organization_id=actor.org_id,
                property_id=batch.property_id,
                tenant_id=t.id,
                import_batch_id=batch.id,
                source_row=src,
                bill_date=v["bill_date"],
                amount=v["amount"],
                description=v.get("description", ""),
            )
        )
        accepted += 1
    db.flush()
    return {"accepted": accepted, "rejected": rejected, "warnings": []}


def stage_lease_rules(db, actor, batch, rows, match: TenantMatcher, filename: str) -> dict:
    from sqlalchemy import select

    from .. import models as M

    pid = batch.property_id
    rejected: list = []
    warnings: list[str] = []
    accepted = 0
    rules = {
        r.ref: r
        for r in db.scalars(
            select(M.LeaseRule).where(M.LeaseRule.organization_id == actor.org_id, M.LeaseRule.property_id == pid)
        )
    }
    for src, v, errs in rows:
        t = None
        if not errs:
            t, err = match.find(v.get("tenant", ""))
            if err:
                errs = [err]
        ref = v.get("rule_ref", "")
        if not errs and ref in rules and rules[ref].status == "approved":
            errs = [f"Lease rule {ref} is approved. Return it to draft in the app to change it."]
        if not errs and t.lease_rule_id is not None and t.lease_rule_id != getattr(rules.get(ref), "id", None):
            current = db.get(M.LeaseRule, t.lease_rule_id)
            if current is not None and current.status == "approved":  # F-12
                errs = [f"{t.name} is linked to approved rule {current.ref}. Return it to draft before relinking."]
        if errs:
            _reject(rejected, src, errs, v)
            continue
        lr = rules.get(ref)
        if lr is None:
            lr = M.LeaseRule(
                organization_id=actor.org_id,
                property_id=pid,
                ref=ref,
                status="draft",
                admin_fee_pools=[],
                unsupported_terms=[],
            )
            db.add(lr)
            db.flush()
            rules[ref] = lr
        if v.get("admin_fee_pct") is not None:
            lr.admin_fee_pct = v["admin_fee_pct"]
            lr.admin_fee_pools = split_list(v.get("admin_fee_pools"))
            lr.admin_fee_order = v.get("admin_fee_order") or None
        terms = split_list(v.get("unsupported_terms"))
        if terms:
            lr.unsupported_terms = sorted(set(lr.unsupported_terms or []) | set(terms))
        lr.source_ref = v.get("source_ref") or lr.source_ref or f"{filename} row {src}"
        pool = v["pool"]
        a = db.scalar(
            select(M.AllocationRule).where(M.AllocationRule.lease_rule_id == lr.id, M.AllocationRule.pool == pool)
        )
        if a is None:
            a = M.AllocationRule(organization_id=actor.org_id, lease_rule_id=lr.id, pool=pool)
            db.add(a)
        a.method = v["method"]
        a.denominator_sqft = v.get("denominator_sqft")
        a.fixed_pct = v.get("fixed_pct")
        a.excluded_categories = split_list(v.get("excluded_categories"))
        a.base_year_amount = v.get("base_year_amount")
        a.gross_up_enabled = v.get("gross_up_target") is not None or v.get("gross_up_actual") is not None
        a.gross_up_target = v.get("gross_up_target")
        a.gross_up_actual = v.get("gross_up_actual")
        a.cap_kind = v.get("cap_kind") or None
        a.cap_pct = v.get("cap_pct")
        a.cap_prior_year = v.get("cap_prior_year")
        if t.lease_rule_id not in (None, lr.id):
            warnings.append(f"Row {src}: {t.name} was linked to draft rule. Relinked to {ref}.")
        t.lease_rule_id = lr.id
        accepted += 1
    db.flush()
    warnings.append("Imported lease rules are drafts. Approve each one before it is used in an audit.")
    return {"accepted": accepted, "rejected": rejected, "warnings": warnings}
