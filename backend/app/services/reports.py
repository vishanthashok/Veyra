"""Excel exports. Every sheet carries the PROVISIONAL banner."""

from __future__ import annotations

import io
from decimal import Decimal

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as M

BANNER = "PROVISIONAL PRE-CLOSE AUDIT. NOT A FINAL YEAR-END RECONCILIATION. FOR ACCOUNTANT REVIEW."
MONEY = '#,##0.00;[Red](#,##0.00)'
KINDS = {
    "classification": "CAM expense classification",
    "allocation": "Tenant allocation",
    "missing-information": "Missing information",
    "exceptions": "Exception report",
    "readiness": "Reconciliation readiness summary",
}
MISSING_TYPES = {"MISSING_TENANT_AREA", "MISSING_LEASE_RULE", "MISSING_DENOMINATOR",
                 "MISSING_RULE_TERM", "UNMAPPED_GL_ACCOUNT", "MAPPING_NEEDS_REVIEW",
                 "MISSING_BILLINGS", "UNKNOWN_CATEGORY", "UNSUPPORTED_RULE"}


def _sheet(wb, title, ctx, headers, first=False):
    ws = wb.active if first else wb.create_sheet()
    ws.title = title[:31]
    ws["A1"] = BANNER
    ws["A1"].font = Font(bold=True, color="9C0006")
    ws["A1"].fill = PatternFill("solid", fgColor="FFC7CE")
    ws["A2"] = (f"{ctx['property'].name} | Period {ctx['period'].fiscal_year_start} to "
                f"{ctx['period'].through_date} (FY ends {ctx['period'].fiscal_year_end}) | "
                f"Audit run {ctx['run'].id} | Input hash {ctx['run'].input_hash[:12]}")
    if ctx.get("synthetic"):
        ws["A3"] = "SYNTHETIC DEMONSTRATION DATA"
        ws["A3"].font = Font(bold=True, color="7F6000")
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=5, column=i, value=h)
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor="DDEBF7")
        c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.column_dimensions[get_column_letter(i)].width = max(12, min(48, len(h) + 6))
    ws.freeze_panes = "A6"
    return ws


def _rows(ws, rows, money_cols=()):
    for r_i, row in enumerate(rows, 6):
        for c_i, v in enumerate(row, 1):
            if isinstance(v, str) and v and _is_num(v) and c_i in money_cols:
                v = Decimal(v)
            cell = ws.cell(row=r_i, column=c_i, value=v)
            if c_i in money_cols:
                cell.number_format = MONEY


def _is_num(s):
    try:
        Decimal(s)
        return True
    except Exception:
        return False


def load_context(db: Session, run: M.AuditRun) -> dict:
    org = run.organization_id
    prop = db.get(M.Property, run.property_id)
    period = db.get(M.ReportingPeriod, run.period_id)
    tenants = {t.id: t for t in db.scalars(select(M.Tenant).where(
        M.Tenant.organization_id == org, M.Tenant.property_id == prop.id))}
    results = db.scalars(select(M.AuditResult).where(M.AuditResult.audit_run_id == run.id)).all()
    traces = {t.audit_result_id: t for t in db.scalars(select(M.CalculationTrace).where(
        M.CalculationTrace.audit_result_id.in_([r.id for r in results])))} if results else {}
    exceptions = db.scalars(select(M.AuditExceptionRow).where(
        M.AuditExceptionRow.audit_run_id == run.id)).all()
    txns = db.scalars(select(M.GLTransaction).where(
        M.GLTransaction.organization_id == org, M.GLTransaction.property_id == prop.id)
        .order_by(M.GLTransaction.gl_account, M.GLTransaction.txn_date)).all()
    maps = {m.gl_account: m for m in db.scalars(select(M.ExpenseMapping).where(
        M.ExpenseMapping.organization_id == org, M.ExpenseMapping.property_id == prop.id))}
    cats = {c.code: c for c in db.scalars(select(M.ExpenseCategory).where(
        M.ExpenseCategory.organization_id == org, M.ExpenseCategory.property_id == prop.id))}
    rules = {r.id: r for r in db.scalars(select(M.LeaseRule).where(
        M.LeaseRule.organization_id == org, M.LeaseRule.property_id == prop.id))}
    users = {u.id: u.name for u in db.scalars(select(M.User).where(M.User.organization_id == org))}
    return dict(property=prop, period=period, run=run, tenants=tenants, results=results,
                traces=traces, exceptions=exceptions, txns=txns, maps=maps, cats=cats,
                rules=rules, users=users, synthetic=prop.name.endswith("(Synthetic)"))


def _excluded_reason(t: M.GLTransaction, run: M.AuditRun) -> str:
    for reason, ids in (run.summary.get("excluded") or {}).items():
        if str(t.id) in ids:
            return reason
    return ""


def classification(wb, ctx, first):
    ws = _sheet(wb, "Expense classification", ctx,
                ["GL account", "Account name", "Date", "Vendor", "Description", "Amount",
                 "Category", "Pool", "Recoverability", "Included in audit", "Excluded reason",
                 "Reviewer", "Reviewed at", "Explanation", "Mapping source ref", "Source row"], first)
    rows = []
    for t in ctx["txns"]:
        m = ctx["maps"].get(t.gl_account)
        cat = ctx["cats"].get(m.category_code) if m and m.category_code else None
        reason = _excluded_reason(t, ctx["run"])
        rows.append([t.gl_account, t.account_name, t.txn_date, t.vendor, t.description,
                     str(t.amount), m.category_code if m else "", cat.pool if cat else "",
                     m.status if m else "UNMAPPED", "No" if reason else "Yes", reason,
                     ctx["users"].get(m.reviewer_id, "") if m else "",
                     m.reviewed_at.isoformat() if m and m.reviewed_at else "",
                     m.explanation if m else "", m.source_ref if m else "",
                     f"batch {t.import_batch_id} row {t.source_row}"])
    _rows(ws, rows, money_cols=(6,))
    ws2 = wb.create_sheet("Pool totals")
    ws2["A1"] = BANNER
    ws2.append([])
    ws2.append(["Pool", "Category", "Recoverable amount"])
    for pool, p in (ctx["run"].summary.get("pools") or {}).items():
        for cat, amt in p["by_category"].items():
            ws2.append([pool, cat, Decimal(amt)])
        ws2.append([pool, "TOTAL", Decimal(p["recoverable_total"])])
    for row in ws2.iter_rows(min_row=4, min_col=3, max_col=3):
        row[0].number_format = MONEY


def allocation(wb, ctx, first):
    ws = _sheet(wb, "Tenant allocation", ctx,
                ["Tenant", "Suite", "Rentable area", "Status", "Pool", "Tenant pool amount",
                 "Share", "Cap reduction", "Pool line (rounded)", "Admin fee",
                 "Provisional YTD total", "YTD billed", "Provisional variance",
                 "Variance direction", "Lease rule", "Unresolved reasons"], first)
    rows = []
    for r in sorted(ctx["results"], key=lambda r: (ctx["tenants"][r.tenant_id].suite,
                                                   ctx["tenants"][r.tenant_id].name)):
        t = ctx["tenants"][r.tenant_id]
        rule = ctx["rules"].get(t.lease_rule_id)
        direction = ""
        if r.variance is not None:
            direction = ("Billed less than provisional share" if r.variance > 0 else
                         "Billed more than provisional share" if r.variance < 0 else "Matches")
        base = [t.name, t.suite, str(t.rentable_area or ""), r.status]
        tail = [str(r.admin_fee), str(r.total) if r.total is not None else "",
                str(r.billed) if r.billed is not None else "",
                str(r.variance) if r.variance is not None else "", direction,
                rule.ref if rule else "", "; ".join(r.unresolved_reasons)]
        if not r.lines:
            rows.append(base + ["", "", "", "", ""] + tail)
        for i, ln in enumerate(r.lines):
            rows.append(base + [ln["pool"], ln["tenant_pool_amount"], ln["share"],
                                ln["cap_reduction"], ln["amount"]]
                        + (tail if i == 0 else ["", "", "", "", "", "", ""]))
    _rows(ws, rows, money_cols=(6, 8, 9, 10, 11, 12, 13))
    tr = _sheet(wb, "Calculation trace", ctx, ["Tenant", "Step", "Formula", "Inputs", "Result"])
    trows = []
    for r in ctx["results"]:
        t = ctx["tenants"][r.tenant_id]
        for s in (ctx["traces"].get(r.id).steps if ctx["traces"].get(r.id) else []):
            trows.append([t.name, s["label"], s["formula"],
                          "; ".join(f"{k}={v}" for k, v in s["inputs"].items()), s["result"]])
    _rows(tr, trows)


def _exception_rows(ctx, only_missing=False):
    rows = []
    for e in ctx["exceptions"]:
        if only_missing and e.type not in MISSING_TYPES:
            continue
        t = ctx["tenants"].get(e.tenant_id) if e.tenant_id else None
        rows.append([e.severity, e.type, t.name if t else "", e.gl_account or "", e.pool or "",
                     str(e.amount) if e.amount is not None else "", e.message, e.status,
                     e.resolution_note, ", ".join(e.transaction_ids)])
    order = {"error": 0, "warning": 1, "info": 2}
    return sorted(rows, key=lambda r: (order.get(r[0], 9), r[1]))


EXC_HEADERS = ["Severity", "Type", "Tenant", "GL account", "Pool", "Amount", "Message",
               "Status", "Resolution note", "Transaction IDs"]


def missing_information(wb, ctx, first):
    ws = _sheet(wb, "Missing information", ctx, EXC_HEADERS, first)
    _rows(ws, _exception_rows(ctx, only_missing=True), money_cols=(6,))


def exceptions(wb, ctx, first):
    ws = _sheet(wb, "Exceptions", ctx, EXC_HEADERS, first)
    _rows(ws, _exception_rows(ctx), money_cols=(6,))


def readiness(wb, ctx, first):
    ws = _sheet(wb, "Readiness summary", ctx, ["Item", "Value", "Note"], first)
    s = ctx["run"].summary
    open_exc = [e for e in ctx["exceptions"] if e.status == "open"]
    unmapped = len({t.gl_account for t in ctx["txns"]} - {
        a for a, m in ctx["maps"].items() if m.status != "needs_review"})
    rows = [
        ["Tenants calculated", s.get("tenants_calculated", 0), ""],
        ["Tenants unresolved", s.get("tenants_unresolved", 0), "Need data or manual review"],
        ["GL accounts without a reviewed mapping", unmapped, ""],
        ["Transactions included", s.get("included_count", 0), ""],
        ["Open errors", sum(1 for e in open_exc if e.severity == "error"), "Block final reconciliation"],
        ["Open warnings", sum(1 for e in open_exc if e.severity == "warning"), ""],
        ["Open informational items", sum(1 for e in open_exc if e.severity == "info"), ""],
    ]
    for pool, p in (s.get("pools") or {}).items():
        rows.append([f"Pool {pool} recoverable YTD", Decimal(p["recoverable_total"]), ""])
        rows.append([f"Pool {pool} allocated YTD", Decimal(p["allocated_total"]),
                     "Unallocated remainder is landlord share, vacancy or excluded tenants"])
    ready = not any(e.severity == "error" for e in open_exc) and unmapped == 0
    rows.append(["Ready for year-end close inputs", "Yes" if ready else "No",
                 "Ready means no open errors and every GL account reviewed. "
                 "It does not mean the figures are final."])
    _rows(ws, rows)
    for row in ws.iter_rows(min_row=6, min_col=2, max_col=2):
        if isinstance(row[0].value, Decimal):
            row[0].number_format = MONEY


BUILDERS = {"classification": classification, "allocation": allocation,
            "missing-information": missing_information, "exceptions": exceptions,
            "readiness": readiness}


def build(kind: str, ctx: dict) -> bytes:
    wb = Workbook()
    if kind == "package":
        for i, k in enumerate(["readiness", "allocation", "classification", "exceptions"]):
            BUILDERS[k](wb, ctx, first=(i == 0))
    else:
        BUILDERS[kind](wb, ctx, first=True)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
