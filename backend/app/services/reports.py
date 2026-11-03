"""Excel exports. Built only from the audit run's snapshot and stored results (F-03), so a report
for an old run shows exactly what that run used. Every workbook opens with a cover sheet.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from decimal import Decimal

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, NamedStyle, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as M

BANNER = "PROVISIONAL PRE-CLOSE AUDIT. NOT A FINAL YEAR-END RECONCILIATION. FOR ACCOUNTANT REVIEW."
MONEY = '#,##0.00;[Red](#,##0.00);"-"'
PCT = "0.0000%"
NAVY = "1F2A44"
KINDS = {
    "package": "Full audit package",
    "classification": "CAM expense classification",
    "allocation": "Tenant allocation",
    "missing-information": "Missing information",
    "exceptions": "Exception report",
    "readiness": "Reconciliation readiness summary",
}
MISSING_TYPES = {
    "MISSING_TENANT_AREA",
    "MISSING_LEASE_RULE",
    "MISSING_DENOMINATOR",
    "MISSING_RULE_TERM",
    "UNMAPPED_GL_ACCOUNT",
    "MAPPING_NEEDS_REVIEW",
    "MISSING_BILLINGS",
    "UNKNOWN_CATEGORY",
    "UNSUPPORTED_RULE",
}
HEADER_ROW = 6
THIN = Side(style="thin", color="D9D9D9")


def load_context(db: Session, run: M.AuditRun) -> dict:
    snap = run.snapshot
    results = db.scalars(select(M.AuditResult).where(M.AuditResult.audit_run_id == run.id)).all()
    traces = (
        {
            t.audit_result_id: t
            for t in db.scalars(
                select(M.CalculationTrace).where(M.CalculationTrace.audit_result_id.in_([r.id for r in results]))
            )
        }
        if results
        else {}
    )
    exceptions = db.scalars(select(M.AuditExceptionRow).where(M.AuditExceptionRow.audit_run_id == run.id)).all()
    creator = db.get(M.User, run.created_by) if run.created_by else None
    return {
        "snap": snap,
        "run": run,
        "results": results,
        "traces": traces,
        "exceptions": exceptions,
        "tenants": {t["id"]: t for t in snap["tenants"]},
        "maps": {m["gl_account"]: m for m in snap["mappings"]},
        "cats": {c["code"]: c for c in snap["categories"]},
        "rules": {r["id"]: r for r in snap["lease_rules"]},
        "run_by": creator.name if creator else "",
        "synthetic": snap["property"]["name"].endswith("(Synthetic)"),
        "generated": datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
    }


# Sheet helpers --------------------------------------------------------------------------------


def _sheet(wb: Workbook, title: str, ctx: dict, headers: list[str], widths: list[int] | None = None) -> Worksheet:
    ws = wb.create_sheet(title[:31])
    snap, run = ctx["snap"], ctx["run"]
    ws["A1"] = BANNER
    ws["A1"].font = Font(bold=True, color="9C0006")
    ws["A1"].fill = PatternFill("solid", fgColor="FFE9E9")
    ws["A2"] = (
        f"{snap['property']['name']}  |  {snap['period']['label']}  |  "
        f"{snap['period']['fiscal_year_start']} to {snap['period']['through_date']}"
    )
    ws["A2"].font = Font(bold=True)
    ws["A3"] = (
        f"Audit run {run.id}  |  engine {run.engine_version}  |  input {run.input_hash[:16]}  |  "
        f"generated {ctx['generated']}"
    )
    ws["A3"].font = Font(color="666666", size=9)
    if ctx["synthetic"]:
        ws["A4"] = "SYNTHETIC DEMONSTRATION DATA"
        ws["A4"].font = Font(bold=True, color="7F6000")
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=HEADER_ROW, column=i, value=h)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=NAVY)
        c.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = widths[i - 1] if widths else max(12, len(h) + 4)
    ws.row_dimensions[HEADER_ROW].height = 30
    ws.freeze_panes = ws.cell(row=HEADER_ROW + 1, column=1)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = f"{HEADER_ROW}:{HEADER_ROW}"
    ws.oddFooter.center.text = "PROVISIONAL  |  Page &P of &N"
    return ws


def _register_styles(wb: Workbook) -> None:
    """Named styles are created once per workbook. Assigning a style per cell by name is cheap;
    building Border/number-format objects per cell made a 20,000-row export take about 20 s."""
    if "veyra_money" in wb.named_styles:
        return
    wb.add_named_style(NamedStyle(name="veyra_money", number_format=MONEY))
    wb.add_named_style(NamedStyle(name="veyra_pct", number_format=PCT))


def _write(ws: Worksheet, rows: list[list], money: set[int] = frozenset(), pct: set[int] = frozenset()) -> int:
    _register_styles(ws.parent)
    r = HEADER_ROW
    for r, row in enumerate(rows, HEADER_ROW + 1):
        for c, v in enumerate(row, 1):
            if c in money or c in pct:
                if isinstance(v, str) and v != "":
                    v = Decimal(v)
                cell = ws.cell(row=r, column=c, value=v)
                cell.style = "veyra_money" if c in money else "veyra_pct"
            else:
                ws.cell(row=r, column=c, value=v)
    if rows:
        ws.auto_filter.ref = f"A{HEADER_ROW}:{get_column_letter(ws.max_column)}{r}"
    return r


def _total_row(ws: Worksheet, last: int, label_col: int, cols: list[int]) -> None:
    if last <= HEADER_ROW:
        return
    t = last + 1
    ws.cell(row=t, column=label_col, value="Total").font = Font(bold=True)
    for c in cols:
        L = get_column_letter(c)
        cell = ws.cell(row=t, column=c, value=f"=SUBTOTAL(9,{L}{HEADER_ROW + 1}:{L}{last})")
        cell.number_format = MONEY
        cell.font = Font(bold=True)
        cell.border = Border(top=Side(style="thin"))


def _excluded_reason(tid: str, ctx) -> str:
    if "_excluded_by_id" not in ctx:
        ctx["_excluded_by_id"] = {
            i: reason.replace("_", " ")
            for reason, ids in (ctx["run"].summary.get("excluded") or {}).items()
            for i in ids
        }
    return ctx["_excluded_by_id"].get(tid, "")


# Sheets ---------------------------------------------------------------------------------------


def cover(wb: Workbook, ctx: dict) -> None:
    ws = wb.active
    ws.title = "Cover"
    snap, run, s = ctx["snap"], ctx["run"], ctx["run"].summary
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 90
    ws["A1"] = "Veyra CAM pre-close audit"
    ws["A1"].font = Font(bold=True, size=16, color=NAVY)
    ws["A2"] = BANNER
    ws["A2"].font = Font(bold=True, color="9C0006")
    open_exc = [e for e in ctx["exceptions"] if e.status in ("open", "in_review", "reopened")]
    status_counts: dict[str, int] = {}
    for e in ctx["exceptions"]:
        status_counts[e.status] = status_counts.get(e.status, 0) + 1
    rows = [
        ("Property", snap["property"]["name"]),
        ("Address", snap["property"]["address"]),
        (
            "Reporting period",
            f"{snap['period']['label']}: {snap['period']['fiscal_year_start']} to "
            f"{snap['period']['through_date']} (fiscal year ends {snap['period']['fiscal_year_end']})",
        ),
        ("Status", "PROVISIONAL. Not a final year-end reconciliation."),
        ("Audit run ID", str(run.id)),
        ("Run at", run.created_at.strftime("%Y-%m-%d %H:%M UTC") + (f" by {ctx['run_by']}" if ctx["run_by"] else "")),
        ("Report generated", ctx["generated"]),
        ("Engine version", run.engine_version),
        ("Input fingerprint (SHA-256)", run.input_hash),
        ("", ""),
        ("Source data", ""),
        *[
            (
                f"  {f['kind']} file",
                f"{f['filename']}  ({f['committed_rows']} rows, sha256 {f['sha256'][:12]}, "
                f"uploaded {f['uploaded_at'][:10]})",
            )
            for f in snap["source_files"]
        ],
        (
            "  GL transactions",
            f"{s.get('transaction_count', len(snap['transactions']))} in snapshot, {s['included_count']} included",
        ),
        (
            "  Excluded transactions",
            ", ".join(f"{k.replace('_', ' ')} {len(v)}" for k, v in s["excluded"].items()) or "none",
        ),
        ("  Approved lease rules", ", ".join(f"{r['ref']} v{r['version']}" for r in snap["lease_rules"]) or "none"),
        (
            "  Tenants",
            f"{len(snap['tenants'])} ({s['tenants_calculated']} calculated, {s['tenants_unresolved']} unresolved)",
        ),
        ("", ""),
        (
            "Reviewer status",
            ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in sorted(status_counts.items())) or "no exceptions",
        ),
        ("Open blocking errors", str(sum(1 for e in open_exc if e.severity == "error"))),
        ("Open warnings", str(sum(1 for e in open_exc if e.severity == "warning"))),
        ("", ""),
        ("Rounding policy", s.get("rounding_policy", "")),
        ("Calculation assumptions", ""),
        *[("", f"- {a}") for a in s.get("assumptions", [])],
    ]
    for i, (k, v) in enumerate(rows, 4):
        ws.cell(row=i, column=1, value=k).font = Font(bold=bool(k and not k.startswith("  ")))
        c = ws.cell(row=i, column=2, value=v)
        c.alignment = Alignment(wrap_text=True, vertical="top")
    if ctx["synthetic"]:
        ws.cell(row=3, column=1, value="SYNTHETIC DEMONSTRATION DATA").font = Font(bold=True, color="7F6000")
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def classification(wb, ctx):
    ws = _sheet(
        wb,
        "Expense classification",
        ctx,
        [
            "GL account",
            "Account name",
            "Date",
            "Vendor",
            "Description",
            "Amount",
            "Category",
            "Pool",
            "Recoverability",
            "Mapping version",
            "Included",
            "Excluded reason",
            "Reviewer",
            "Reviewed at",
            "Explanation",
            "Source file",
            "Source row",
        ],
        [11, 22, 11, 24, 30, 13, 16, 8, 15, 9, 9, 16, 16, 18, 40, 30, 9],
    )
    files = {f["batch_id"]: f["filename"] for f in ctx["snap"]["source_files"]}
    rows = []
    for t in sorted(ctx["snap"]["transactions"], key=lambda t: (t["gl_account"], t["txn_date"], t["source_row"])):
        m = ctx["maps"].get(t["gl_account"])
        cat = ctx["cats"].get(m["category_code"]) if m and m["category_code"] else None
        reason = _excluded_reason(t["id"], ctx)
        rows.append(
            [
                t["gl_account"],
                t["account_name"],
                t["txn_date"],
                t["vendor"],
                t["description"],
                t["amount"],
                m["category_code"] if m else "",
                cat["pool"] if cat else "",
                m["status"] if m else "unmapped",
                m["version"] if m else "",
                "No" if reason else "Yes",
                reason,
                (m or {}).get("reviewer") or "",
                ((m or {}).get("reviewed_at") or "")[:16],
                (m or {}).get("explanation") or "",
                files.get(t["batch_id"], ""),
                t["source_row"],
            ]
        )
    last = _write(ws, rows, money={6})
    _total_row(ws, last, 5, [6])
    ws2 = _sheet(
        wb,
        "Pool totals",
        ctx,
        ["Pool", "Category", "Approved recoverable", "Allocated to tenants", "Rounding difference"],
        [10, 22, 20, 20, 18],
    )
    prow = []
    for pool, p in (ctx["run"].summary.get("pools") or {}).items():
        for cat, amt in p["by_category"].items():
            prow.append([pool, cat, amt, "", ""])
        prow.append([pool, "POOL TOTAL", p["recoverable_total"], p["allocated_total"], p["rounding_difference"]])
    _write(ws2, prow, money={3, 4, 5})


def allocation(wb, ctx):
    ws = _sheet(
        wb,
        "Tenant allocation",
        ctx,
        [
            "Suite",
            "Tenant",
            "Rentable area",
            "Status",
            "Pool",
            "Tenant pool amount",
            "Share",
            "Cap reduction",
            "Pool line",
            "Admin fee",
            "Provisional total",
            "Billed in window",
            "Provisional variance",
            "Variance direction",
            "Lease rule",
            "Unresolved reasons",
        ],
        [7, 26, 11, 12, 7, 16, 11, 13, 13, 11, 15, 14, 14, 30, 12, 50],
    )
    rows = []
    for r in sorted(
        ctx["results"],
        key=lambda r: (ctx["tenants"][str(r.tenant_id)]["suite"], ctx["tenants"][str(r.tenant_id)]["name"]),
    ):
        t = ctx["tenants"][str(r.tenant_id)]
        rule = ctx["rules"].get(t["lease_rule_id"]) if t["lease_rule_id"] else None
        direction = ""
        if r.variance is not None:
            direction = (
                "Billed less than provisional share"
                if r.variance > 0
                else "Billed more than provisional share"
                if r.variance < 0
                else "Matches"
            )
        base = [t["suite"], t["name"], t["rentable_area"] or "", r.status]
        tail = [
            str(r.admin_fee),
            str(r.total) if r.total is not None else "",
            str(r.billed) if r.billed is not None else "",
            str(r.variance) if r.variance is not None else "",
            direction,
            f"{rule['ref']} v{rule['version']}" if rule else "",
            "; ".join(r.unresolved_reasons),
        ]
        blank = ["", "", "", "", "", "", ""]
        if not r.lines:
            rows.append([*base, "", "", "", "", "", *tail])
        for i, ln in enumerate(r.lines):
            rows.append(
                base
                + [ln["pool"], ln["tenant_pool_amount"], ln["share"], ln["cap_reduction"], ln["amount"]]
                + (tail if i == 0 else blank)
            )
    last = _write(ws, rows, money={6, 8, 9, 10, 11, 12, 13}, pct={7})
    _total_row(ws, last, 2, [9, 10, 11, 12, 13])
    tr = _sheet(wb, "Calculation trace", ctx, ["Tenant", "Step", "Formula", "Inputs", "Result"], [26, 30, 50, 80, 22])
    trows = []
    for r in ctx["results"]:
        t = ctx["tenants"][str(r.tenant_id)]
        steps = ctx["traces"].get(r.id).steps if ctx["traces"].get(r.id) else []
        for s in steps:
            trows.append(
                [
                    t["name"],
                    s["label"],
                    s["formula"],
                    "; ".join(f"{k}={v}" for k, v in s["inputs"].items()),
                    s["result"],
                ]
            )
    _write(tr, trows)


EXC_HEADERS = ["Severity", "Type", "Tenant", "GL account", "Pool", "Amount", "Message", "Status", "Resolution note"]
EXC_WIDTHS = [9, 26, 24, 10, 8, 13, 70, 11, 40]


def _exception_rows(ctx, only_missing=False):
    order = {"error": 0, "warning": 1, "info": 2}
    rows = []
    for e in sorted(ctx["exceptions"], key=lambda e: (order[e.severity], e.type, e.message)):
        if only_missing and e.type not in MISSING_TYPES:
            continue
        t = ctx["tenants"].get(str(e.tenant_id)) if e.tenant_id else None
        rows.append(
            [
                e.severity,
                e.type,
                t["name"] if t else "",
                e.gl_account or "",
                e.pool or "",
                str(e.amount) if e.amount is not None else "",
                e.message,
                e.status,
                e.resolution_note,
            ]
        )
    return rows


def missing_information(wb, ctx):
    ws = _sheet(wb, "Missing information", ctx, EXC_HEADERS, EXC_WIDTHS)
    _write(ws, _exception_rows(ctx, only_missing=True), money={6})


def exceptions(wb, ctx):
    ws = _sheet(wb, "Exceptions", ctx, EXC_HEADERS, EXC_WIDTHS)
    _write(ws, _exception_rows(ctx), money={6})


def readiness(wb, ctx):
    ws = _sheet(wb, "Readiness summary", ctx, ["Check", "Value", "Note"], [44, 18, 80])
    s = ctx["run"].summary
    open_exc = [e for e in ctx["exceptions"] if e.status in ("open", "in_review", "reopened")]
    needs_review = sum(1 for m in ctx["snap"]["mappings"] if m["status"] == "needs_review")
    rows = [
        ["Tenants calculated", s.get("tenants_calculated", 0), ""],
        ["Tenants unresolved", s.get("tenants_unresolved", 0), "Need data or manual review"],
        ["GL accounts without a reviewed mapping", needs_review, ""],
        ["Transactions included", s.get("included_count", 0), ""],
        ["Open blocking errors", sum(1 for e in open_exc if e.severity == "error"), "Block a final reconciliation"],
        ["Open warnings", sum(1 for e in open_exc if e.severity == "warning"), ""],
        [
            "Accepted exceptions",
            sum(1 for e in ctx["exceptions"] if e.status == "accepted"),
            "Accepted with a documented reason. Still part of the record.",
        ],
    ]
    for pool, p in (s.get("pools") or {}).items():
        rows.append([f"Pool {pool} approved recoverable", Decimal(p["recoverable_total"]), ""])
        rows.append(
            [
                f"Pool {pool} allocated",
                Decimal(p["allocated_total"]),
                "Remainder is landlord share, vacancy or unresolved tenants",
            ]
        )
    ready = not any(e.severity == "error" for e in open_exc) and needs_review == 0
    rows.append(
        [
            "Ready for year-end inputs",
            "Yes" if ready else "No",
            "Means no open errors and every GL account reviewed. Does not mean figures are final.",
        ]
    )
    _write(ws, rows)
    for row in ws.iter_rows(min_row=HEADER_ROW + 1, min_col=2, max_col=2):
        if isinstance(row[0].value, Decimal):
            row[0].number_format = MONEY


BUILDERS = {
    "classification": classification,
    "allocation": allocation,
    "missing-information": missing_information,
    "exceptions": exceptions,
    "readiness": readiness,
}


def build(kind: str, ctx: dict) -> bytes:
    wb = Workbook()
    cover(wb, ctx)
    kinds = (
        ["readiness", "allocation", "classification", "exceptions", "missing-information"]
        if kind == "package"
        else [kind]
    )
    for k in kinds:
        BUILDERS[k](wb, ctx)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
