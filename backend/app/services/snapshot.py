"""Audit-run snapshots (F-03).

build_snapshot() freezes every input an audit uses into plain JSON: transactions with source
provenance, mapping decisions with versions, categories, tenants, approved lease rules with
versions, billings, source files and settings. input_from_snapshot() rebuilds the engine input
from that JSON alone. Audit runs always execute from the snapshot, so a stored run can be re-run
later and must give identical results, whatever has changed in the live tables since.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from veyra_engine import types as E

from .. import models as M

SNAPSHOT_SCHEMA = 1


def _s(v):
    return None if v is None else str(v)


def _d(v):
    return None if v is None else Decimal(v)


def _date(v):
    return None if v is None else date.fromisoformat(v)


def build_snapshot(db: Session, prop: M.Property, period: M.ReportingPeriod, threshold: Decimal) -> dict:
    org = prop.organization_id

    def q(model):
        return select(model).where(model.organization_id == org, model.property_id == prop.id)

    users = {u.id: u.name for u in db.scalars(select(M.User).where(M.User.organization_id == org))}
    txns = db.scalars(
        q(M.GLTransaction).order_by(
            M.GLTransaction.txn_date, M.GLTransaction.gl_account, M.GLTransaction.source_row, M.GLTransaction.id
        )
    ).all()
    batches = {b.id: b for b in db.scalars(q(M.ImportBatch))}
    files = (
        {
            f.id: f
            for f in db.scalars(
                select(M.SourceFile).where(M.SourceFile.id.in_([b.source_file_id for b in batches.values()]))
            )
        }
        if batches
        else {}
    )
    rules = {r.id: r for r in db.scalars(q(M.LeaseRule).where(M.LeaseRule.status == "approved"))}
    pools: dict = {}
    if rules:
        for a in db.scalars(
            select(M.AllocationRule).where(M.AllocationRule.lease_rule_id.in_(rules)).order_by(M.AllocationRule.pool)
        ):
            pools.setdefault(a.lease_rule_id, []).append(a)
    tenants = db.scalars(q(M.Tenant).order_by(M.Tenant.suite, M.Tenant.name, M.Tenant.id)).all()

    used_batches = {t.import_batch_id for t in txns}
    billings = db.scalars(
        q(M.CamBilling).order_by(M.CamBilling.bill_date, M.CamBilling.source_row, M.CamBilling.id)
    ).all()
    used_batches |= {b.import_batch_id for b in billings}

    return {
        "schema": SNAPSHOT_SCHEMA,
        "property": {"id": str(prop.id), "name": prop.name, "address": prop.address},
        "period": {
            "id": str(period.id),
            "label": period.label,
            "fiscal_year_start": str(period.fiscal_year_start),
            "fiscal_year_end": str(period.fiscal_year_end),
            "through_date": str(period.through_date),
        },
        "variance_threshold": str(threshold),
        "source_files": [
            {
                "batch_id": str(b.id),
                "kind": b.kind,
                "filename": files[b.source_file_id].filename,
                "sha256": files[b.source_file_id].sha256,
                "parser_version": b.parser_version,
                "committed_rows": b.accepted_count,
                "uploaded_at": b.created_at.isoformat(),
            }
            for b in sorted(batches.values(), key=lambda b: b.created_at)
            if b.id in used_batches and b.source_file_id in files
        ],
        "transactions": [
            {
                "id": str(t.id),
                "gl_account": t.gl_account,
                "account_name": t.account_name,
                "txn_date": str(t.txn_date),
                "amount": str(t.amount),
                "vendor": t.vendor,
                "description": t.description,
                "batch_id": str(t.import_batch_id),
                "source_row": t.source_row,
                "excluded_by_review": t.excluded_by_review,
            }
            for t in txns
        ],
        "mappings": [
            {
                "gl_account": m.gl_account,
                "category_code": m.category_code,
                "status": m.status,
                "version": m.version,
                "explanation": m.explanation,
                "source_ref": m.source_ref,
                "reviewer": users.get(m.reviewer_id),
                "reviewed_at": _s(m.reviewed_at and m.reviewed_at.isoformat()),
            }
            for m in db.scalars(q(M.ExpenseMapping).order_by(M.ExpenseMapping.gl_account))
        ],
        "categories": [
            {"code": c.code, "name": c.name, "pool": c.pool, "controllable": c.controllable, "variable": c.variable}
            for c in db.scalars(q(M.ExpenseCategory).order_by(M.ExpenseCategory.code))
        ],
        "lease_rules": [
            {
                "id": str(r.id),
                "ref": r.ref,
                "version": r.version,
                "approved_at": _s(r.approved_at and r.approved_at.isoformat()),
                "approved_by": users.get(r.approved_by),
                "source_ref": r.source_ref,
                "admin_fee_pct": _s(r.admin_fee_pct),
                "admin_fee_pools": sorted(r.admin_fee_pools or []),
                "admin_fee_order": r.admin_fee_order,
                "unsupported_terms": list(r.unsupported_terms or []),
                "pools": [
                    {
                        "pool": a.pool,
                        "method": a.method,
                        "denominator_sqft": _s(a.denominator_sqft),
                        "fixed_pct": _s(a.fixed_pct),
                        "excluded_categories": sorted(a.excluded_categories or []),
                        "base_year_amount": _s(a.base_year_amount),
                        "gross_up_enabled": a.gross_up_enabled,
                        "gross_up_target": _s(a.gross_up_target),
                        "gross_up_actual": _s(a.gross_up_actual),
                        "cap_kind": a.cap_kind,
                        "cap_pct": _s(a.cap_pct),
                        "cap_prior_year": _s(a.cap_prior_year),
                    }
                    for a in pools.get(r.id, [])
                ],
            }
            for r in sorted(rules.values(), key=lambda r: r.ref)
        ],
        "tenants": [
            {
                "id": str(t.id),
                "name": t.name,
                "suite": t.suite,
                "rentable_area": _s(t.rentable_area),
                "lease_start": _s(t.lease_start),
                "lease_end": _s(t.lease_end),
                "lease_rule_id": str(t.lease_rule_id) if t.lease_rule_id in rules else None,
                "lease_rule_status": "approved"
                if t.lease_rule_id in rules
                else ("draft" if t.lease_rule_id else "none"),
            }
            for t in tenants
        ],
        "billings": [
            {
                "tenant_id": str(b.tenant_id),
                "bill_date": str(b.bill_date),
                "amount": str(b.amount),
                "batch_id": str(b.import_batch_id),
                "source_row": b.source_row,
            }
            for b in billings
        ],
    }


def input_from_snapshot(snap: dict) -> E.AuditInput:
    rules = {}
    for r in snap["lease_rules"]:
        prules = []
        for a in r["pools"]:
            gross = E.GrossUp(_d(a["gross_up_target"]), _d(a["gross_up_actual"])) if a["gross_up_enabled"] else None
            cap = E.Cap(E.CapKind(a["cap_kind"]), _d(a["cap_pct"]), _d(a["cap_prior_year"])) if a["cap_kind"] else None
            prules.append(
                E.PoolRule(
                    pool=a["pool"],
                    method=E.Method(a["method"]),
                    denominator_sqft=_d(a["denominator_sqft"]),
                    fixed_pct=_d(a["fixed_pct"]),
                    excluded_categories=frozenset(a["excluded_categories"]),
                    base_year_amount=_d(a["base_year_amount"]),
                    gross_up=gross,
                    cap=cap,
                )
            )
        fee = None
        if r["admin_fee_pct"] is not None:
            fee = E.AdminFee(
                Decimal(r["admin_fee_pct"]),
                frozenset(r["admin_fee_pools"]),
                E.AdminFeeOrder(r["admin_fee_order"]) if r["admin_fee_order"] else None,
            )
        rules[r["id"]] = E.LeaseRule(r["ref"], tuple(prules), fee, tuple(r["unsupported_terms"]))

    maps = []
    for m in snap["mappings"]:
        if m["status"] == "recoverable" and not m["category_code"]:
            maps.append(E.Mapping(m["gl_account"], "", E.Recoverability.NEEDS_REVIEW))
        else:
            maps.append(E.Mapping(m["gl_account"], m["category_code"] or "", E.Recoverability(m["status"])))

    p = snap["period"]
    return E.AuditInput(
        period=E.Period(_date(p["fiscal_year_start"]), _date(p["fiscal_year_end"]), _date(p["through_date"])),
        transactions=tuple(
            E.Transaction(
                t["id"],
                t["gl_account"],
                _date(t["txn_date"]),
                Decimal(t["amount"]),
                " ".join(x for x in (t["vendor"], t["description"]) if x),
                f"batch {t['batch_id']} row {t['source_row']}",
            )
            for t in snap["transactions"]
        ),
        categories=tuple(
            E.Category(c["code"], c["pool"], c["controllable"], c["variable"]) for c in snap["categories"]
        ),
        mappings=tuple(maps),
        tenants=tuple(
            E.Tenant(
                t["id"],
                t["name"],
                _d(t["rentable_area"]),
                _date(t["lease_start"]),
                _date(t["lease_end"]),
                rules.get(t["lease_rule_id"]) if t["lease_rule_id"] else None,
            )
            for t in snap["tenants"]
        ),
        billings=tuple(
            E.Billing(b["tenant_id"], _date(b["bill_date"]), Decimal(b["amount"])) for b in snap["billings"]
        ),
        excluded_transaction_ids=frozenset(t["id"] for t in snap["transactions"] if t["excluded_by_review"]),
        variance_threshold=Decimal(snap["variance_threshold"]),
    )
