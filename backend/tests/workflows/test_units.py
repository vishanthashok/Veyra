"""Pure workflow engine pieces: parsing, safe formulas, graph checks, nodes. No database."""

import io
from datetime import date
from decimal import Decimal

import pytest
from openpyxl import Workbook, load_workbook

from app.workflows import graph
from app.workflows.expr import RowError, compile_expression
from app.workflows.nodes import REGISTRY, Context
from app.workflows.table import (
    MAX_ROWS,
    NodeError,
    Table,
    read_spreadsheet,
    safe_text,
    to_csv_bytes,
    to_decimal,
    to_xlsx_bytes,
)


def _ctx():
    return Context(
        db=None,
        org_id=None,
        node_key="n",
        label="Step",
        workflow_name="W",
        version_number=1,
        run_id=None,
        input_files={},
        ancestor_issues=lambda: [],
        provenance=lambda: ["W"],
    )  # type: ignore[arg-type]


def _t(cols, *rows):
    t = Table(list(cols))
    for i, r in enumerate(rows, start=2):
        t.append(dict(zip(cols, r, strict=True)), i)
    return t


def _xlsx(sheets):
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# --- parsing ------------------------------------------------------------------------------------


def test_xlsx_sheets_header_row_and_source_rows():
    data = _xlsx(
        {
            "Notes": [["ignore"]],
            "GL": [["Report title"], ["Account", "Amount", "Amount"], [6100, 2400.5], [None, None], [6110, 10]],
        }
    )
    t = read_spreadsheet("gl.xlsx", data, sheet="GL", header_row=2)
    assert t.columns == ["Account", "Amount", "Amount (2)"]  # duplicate headers are kept apart
    assert [r["Amount"] for r in t.rows] == ["2400.5", "10"]  # 2400.5 stays exact, 10.0 becomes "10"
    assert t.source_rows == [3, 5]  # the blank line is skipped, row numbers are the sheet's
    with pytest.raises(NodeError, match="not found"):
        read_spreadsheet("gl.xlsx", data, sheet="Missing")


def test_rejects_bad_files_and_limits():
    with pytest.raises(NodeError):
        read_spreadsheet("a.xlsx", b"plain text")
    with pytest.raises(NodeError):
        read_spreadsheet("a.txt", b"x")
    with pytest.raises(NodeError, match="UTF-8"):
        read_spreadsheet("a.csv", "naïve".encode("latin-1"))
    big = "a\n" + "1\n" * (MAX_ROWS + 1)
    with pytest.raises(NodeError, match="more than"):
        read_spreadsheet("big.csv", big.encode())


def test_formulas_in_uploads_are_never_evaluated():
    wb = Workbook()
    wb.active.append(["Amount"])
    wb.active.append(["=1+1"])
    buf = io.BytesIO()
    wb.save(buf)
    t = read_spreadsheet("f.xlsx", buf.getvalue())
    assert len(t) == 0  # no cached value and Veyra never computes formulas, so the row is blank


def test_decimal_parsing():
    assert to_decimal("$1,234.50") == Decimal("1234.50")
    assert to_decimal("(125.00)") == Decimal("-125.00")
    assert to_decimal("abc") is None and to_decimal("") is None and to_decimal("NaN") is None


def test_export_injection_protection():
    assert safe_text("=HYPERLINK(1)") == "'=HYPERLINK(1)"
    assert safe_text("@SUM(A1)") == "'@SUM(A1)" and safe_text("+1+1") == "+1+1".replace("+1+1", "'+1+1")
    assert safe_text("-12.50") == "-12.50"  # numbers stay numbers
    t = _t(["name", "amount"], ["=cmd|' /C calc'!A0", "-5.00"])
    assert to_csv_bytes(t).decode("utf-8-sig").splitlines()[1] == "'=cmd|' /C calc'!A0,-5.00"
    wb = load_workbook(io.BytesIO(to_xlsx_bytes([("Data", t)], ["note"])))
    ws = wb["Data"]
    assert ws["B2"].value == "=cmd|' /C calc'!A0" and ws["B2"].data_type == "s"
    assert ws["C2"].value == -5 and ws["A2"].value == 2  # money as a number, source row kept


# --- formulas -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "expr",
    [
        "__import__('os')",
        "[a].real",
        "lambda: 1",
        "[a] ** 2",
        "open('x')",
        "[a] if 1 else 2",
        "'text'",
        "x",
        "round([a])",
        "abs([a], 1)",
    ],
)
def test_formula_rejects_anything_outside_the_whitelist(expr):
    with pytest.raises(NodeError):
        compile_expression(expr)


def test_formula_decimal_math():
    f, cols = compile_expression("round([Amount] * 0.1 / 3, 2) + max([Fee], 1) - abs(-0.005)")
    assert cols == ["Amount", "Fee"]
    assert f({"Amount": "1000.05", "Fee": "0.5"}) == Decimal("34.335")
    with pytest.raises(RowError, match="division by zero"):
        compile_expression("[a] / [b]")[0]({"a": "1", "b": "0"})
    with pytest.raises(RowError):
        f({"Amount": "", "Fee": "1"})


# --- graph --------------------------------------------------------------------------------------


def _defn(nodes, edges):
    return graph.normalize({"nodes": nodes, "edges": edges})


def test_graph_order_is_deterministic_and_cycles_are_rejected():
    n = [
        {"id": "u", "type": "spreadsheet_upload"},
        {"id": "b", "type": "deduplicate", "config": {"key_columns": ["x"]}},
        {"id": "a", "type": "data_cleaner"},
        {"id": "x", "type": "excel_export"},
    ]
    e = [
        {"source": "u", "target": "a"},
        {"source": "u", "target": "b"},
        {"source": "a", "target": "x", "target_port": "sheets"},
        {"source": "b", "target": "x", "target_port": "sheets"},
    ]
    d = _defn(n, e)
    assert graph.validate(d) == []
    assert graph.order(d) == ["u", "b", "a", "x"]  # ties keep definition order
    assert graph.ancestors(d, "x") == {"u", "a", "b"}
    cyc = _defn(n, [*e, {"source": "b", "target": "a"}, {"source": "a", "target": "b"}])
    assert graph.order(cyc) is None
    assert any("accepts one connection" in x["message"] for x in graph.validate(cyc))


def test_graph_port_checks_and_hash_ignores_layout():
    d = _defn(
        [{"id": "u", "type": "spreadsheet_upload"}, {"id": "c", "type": "csv_export"}],
        [{"source": "u", "source_port": "nope", "target": "c"}],
    )
    assert any("no output" in x["message"] for x in graph.validate(d))
    a = _defn([{"id": "u", "type": "spreadsheet_upload", "position": {"x": 1, "y": 2}}], [])
    b = _defn([{"id": "u", "type": "spreadsheet_upload", "position": {"x": 9, "y": 9}}], [])
    assert graph.definition_hash(a) == graph.definition_hash(b)
    assert graph.validate(_defn([{"id": "bad id!", "type": "spreadsheet_upload"}], []))


# --- nodes --------------------------------------------------------------------------------------


def test_cleaner_normalizes_and_rejects_with_evidence():
    t = _t(
        ["acct", "date", "amt", "memo"],
        [" 6100.0 ", "1/5/2026", "$1,200", "ok"],
        ["6110", str((date(2026, 1, 5) - date(1899, 12, 30)).days), "(10.50)", ""],
        ["6120", "2026-13-40", "1.005", "x"],
    )
    r = REGISTRY["data_cleaner"].run(
        _ctx(),
        {"in": t},
        {"code_columns": ["acct"], "date_columns": ["date"], "amount_columns": ["amt"], "warn_blank_columns": ["memo"]},
    )
    out, rej = r.outputs["out"], r.outputs["rejected"]
    assert out.rows[0] == {"acct": "6100", "date": "2026-01-05", "amt": "1200.00", "memo": "ok"}
    assert out.rows[1]["date"] == "2026-01-05" and out.rows[1]["amt"] == "-10.50"  # Excel serial date
    assert rej.source_rows == [4] and "not a date" in rej.rows[0]["error"] and "decimal places" in rej.rows[0]["error"]
    assert {i["code"] for i in r.issues} == {"BLANK_VALUE", "INVALID_DATE", "AMOUNT_PRECISION"}


def test_dedupe_keeps_evidence_and_filter_types():
    t = _t(["k", "v", "d"], ["A ", "1", "2026-01-02"], ["a", "2", "01/03/2026"], ["b", "x", "2026-02-01"])
    r = REGISTRY["deduplicate"].run(_ctx(), {"in": t}, {"key_columns": ["k"]})
    assert len(r.outputs["out"]) == 2 and r.outputs["removed"].rows[0]["duplicate_of_row"] == "2"
    f = REGISTRY["filter_rows"].run(
        _ctx(),
        {"in": t},
        {
            "conditions": [
                {"column": "d", "op": "gte", "value": "2026-01-03", "type": "date"},
                {"column": "v", "op": "lt", "value": "5", "type": "number"},
            ],
            "match": "all",
        },
    )
    assert [r["k"] for r in f.outputs["out"].rows] == ["a"]
    assert any(i["code"] == "FILTER_UNPARSEABLE" for i in f.issues)


def test_mapper_auto_detects_and_requires():
    t = _t(["GL Account", "Memo", "Net Amount"], ["6100", "m", "5"])
    r = REGISTRY["column_mapper"].run(
        _ctx(),
        {"in": t},
        {"mapping": [{"target": "gl_account"}, {"target": "amount"}, {"target": "vendor", "required": False}]},
    )
    assert r.outputs["out"].columns == ["gl_account", "amount", "vendor"] and r.outputs["out"].rows[0]["amount"] == "5"
    with pytest.raises(NodeError, match="No column found"):
        REGISTRY["column_mapper"].run(_ctx(), {"in": t}, {"mapping": [{"target": "txn_date"}]})


def test_classification_and_billing_use_decimal():
    t = _t(
        ["mapping_status", "amount"],
        ["recoverable", "0.10"],
        ["recoverable", "0.20"],
        ["unmapped", "5.00"],
        ["nonrecoverable", "1.00"],
    )
    r = REGISTRY["expense_classification"].run(_ctx(), {"in": t}, {})
    assert "recoverable: 2 rows, 0.30" in r.logs  # 0.1 + 0.2 is exactly 0.30
    alloc = _t(["suite", "tenant", "total"], ["100", "Grocer", "100.10"], ["110", "Cell", ""])
    bills = _t(["tenant", "amount"], ["100", "50.05"], ["grocer", "50.04"], ["Ghost", "9.99"])
    b = REGISTRY["billing_comparison"].run(
        _ctx(), {"allocations": alloc, "billings": bills}, {"variance_threshold": "0"}
    )
    row = b.outputs["out"].rows[0]
    assert (row["billed"], row["difference"], row["direction"]) == ("100.09", "0.01", "under-billed")
    assert b.outputs["out"].rows[1]["status"] == "not calculated"
    assert b.outputs["unmatched"].rows[0]["billing_key"] == "Ghost"
    assert {"UNMATCHED_BILLING", "ALLOCATION_MISSING", "VARIANCE_OVER_THRESHOLD"} <= {i["code"] for i in b.issues}


def test_lease_rule_check():
    tenants = _t(
        ["suite", "tenant", "rule_ref"],
        ["100", "A", "LR-1"],
        ["110", "B", ""],
        ["120", "C", "LR-2"],
        ["130", "D", "LR-3"],
    )
    rules = _t(
        ["rule_ref", "status", "pool", "method", "denominator_sqft", "fixed_pct", "unsupported_terms"],
        ["LR-1", "approved", "CAM", "pro_rata", "10000", "", ""],
        ["LR-2", "draft", "CAM", "pro_rata", "", "", "CPI cap"],
        ["LR-3", "approved", "CAM", "anchor_contribution", "", "", ""],
    )
    r = REGISTRY["lease_rule_check"].run(_ctx(), {"tenants": tenants, "rules": rules}, {})
    got = {x["suite"]: x["readiness"] for x in r.outputs["out"].rows}
    assert got == {"100": "ready", "110": "blocked", "120": "blocked", "130": "blocked"}
    assert {
        "MISSING_LEASE_RULE",
        "RULE_NOT_APPROVED",
        "MISSING_DENOMINATOR",
        "UNSUPPORTED_RULE",
        "UNSUPPORTED_METHOD",
    } <= {i["code"] for i in r.issues}
