"""Workflows API: templates end to end, versioning, approvals, cancellation, retries, isolation.

Runs execute in a FastAPI background task; Starlette's TestClient finishes background tasks
before returning, so each POST that starts a run returns once the run has stopped.
"""

import io
from decimal import Decimal
from pathlib import Path

from openpyxl import load_workbook

from app.demo_seed import DATA, REPO, seed

EX = REPO / "demo" / "workflows"
API = "/api/v1"


def _upload(client, path: Path, name: str | None = None):
    r = client.post(f"{API}/workflow-files", files={"file": (name or path.name, path.read_bytes(), "text/csv")})
    assert r.status_code == 201, r.text
    return r.json()


def _create(client, template: str, name: str = "WF", property_id: str | None = None):
    body = {"name": name, "template_key": template}
    if property_id:
        body["property_id"] = property_id
    r = client.post(f"{API}/workflows", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _run(client, wf_id: str, inputs: dict, key: str | None = None):
    headers = {"Idempotency-Key": key} if key else {}
    r = client.post(f"{API}/workflows/{wf_id}/runs", json={"inputs": inputs}, headers=headers)
    assert r.status_code == 201, r.text
    return client.get(f"{API}/workflow-runs/{r.json()['id']}").json()


def _step(run, key):
    return next(s for s in run["steps"] if s["node_key"] == key)


def _download(client, run, name):
    art = next(a for a in run["artifacts"] if a["name"] == name)
    r = client.get(f"{API}/workflow-artifacts/{art['id']}/download")
    assert r.status_code == 200
    return r


def test_catalog_and_templates(client):
    nodes = client.get(f"{API}/workflow-nodes").json()
    types = {n["type"] for n in nodes}
    assert {
        "spreadsheet_upload",
        "property_data",
        "column_mapper",
        "data_cleaner",
        "filter_rows",
        "deduplicate",
        "category_mapper",
        "formula",
        "expense_classification",
        "tenant_allocation",
        "billing_comparison",
        "exception_detection",
        "excel_export",
        "csv_export",
        "exception_report",
        "approval_gate",
    } <= types
    tpls = client.get(f"{API}/workflow-templates").json()
    assert [t["key"] for t in tpls] == [
        "gl_expense_cleaner",
        "cam_expense_classification",
        "tenant_billing_comparison",
        "lease_rule_audit",
        "cam_preclose_readiness",
    ]
    assert not tpls[0]["needs_property"] and tpls[1]["needs_property"]


def test_gl_expense_cleaner_end_to_end(client):
    wf = _create(client, "gl_expense_cleaner", "GL cleaner")
    assert wf["errors"] == [] and wf["version"]["number"] == 1
    f = _upload(client, EX / "gl_export_messy.csv")
    assert f["preview"]["row_count"] == 11 and "Memo/Description" in f["preview"]["columns"]
    run = _run(client, wf["id"], {"upload": f["id"]})
    assert run["status"] == "completed", run["error"]
    assert [s["status"] for s in run["steps"]] == ["completed"] * 6

    clean = _step(run, "clean")
    # 11 rows: bad date, 3-decimal amount, blank account and the "=1+1" amount are rejected with
    # reasons; the other 7 pass.
    assert clean["outputs"]["out"]["row_count"] == 7
    assert clean["outputs"]["rejected"]["row_count"] == 4
    codes = {i["code"] for i in clean["issues"]}
    assert {"INVALID_DATE", "AMOUNT_PRECISION", "REQUIRED_BLANK", "BLANK_VALUE", "INVALID_AMOUNT"} <= codes
    out = clean["outputs"]["out"]
    cols = out["columns"]
    rows = [dict(zip(cols, r, strict=True)) for r in out["rows"]]
    assert rows[0]["amount"] == "2400.00" and rows[0]["txn_date"] == "2026-01-05"
    assert rows[1]["gl_account"] == "6110" and rows[1]["account_name"] == "Janitorial"
    assert rows[2]["amount"] == "975.50" and rows[2]["txn_date"] == "2026-01-12"
    assert next(r for r in rows if r["gl_account"] == "6140")["amount"] == "-125.00"
    # Source rows are preserved (header is row 1).
    assert out["source_rows"][:3] == [2, 3, 4]

    dedupe = _step(run, "dedupe")
    assert dedupe["outputs"]["removed"]["row_count"] == 1
    removed = dict(zip(dedupe["outputs"]["removed"]["columns"], dedupe["outputs"]["removed"]["rows"][0], strict=True))
    assert removed["duplicate_of_row"] == "4"

    # Workbook: cover, cleaned rows, duplicates, rejected rows, exceptions. Formula text stays text.
    wb = load_workbook(io.BytesIO(_download(client, run, "gl-cleaned.xlsx").content))
    assert wb.sheetnames[0] == "Run" and "Exceptions" in wb.sheetnames
    assert "Provisional" in " ".join(str(c.value) for c in wb["Run"]["A"])
    rejected = next(ws for ws in wb.worksheets if "rejected" in ws.title)
    cell = next(c for row in rejected.iter_rows() for c in row if c.value == "=1+1")
    assert cell.data_type == "s"  # stored as text, not a formula
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                assert c.data_type != "f", f"formula written in {ws.title}!{c.coordinate}"
    csv_text = _download(client, run, "gl-cleaned.csv").content.decode("utf-8-sig")
    assert csv_text.splitlines()[0] == "gl_account,account_name,txn_date,amount,vendor,description"
    assert len(csv_text.splitlines()) == 7  # header + 6 unique valid rows

    # The original upload is stored unchanged and referenced by hash.
    assert run["inputs"][0]["sha256"] == f["sha256"]

    # Rerun the saved workflow with a new file.
    f2 = _upload(client, EX / "gl_export_march.csv")
    run2 = _run(client, wf["id"], {"upload": f2["id"]})
    assert run2["status"] == "completed" and _step(run2, "clean")["outputs"]["out"]["row_count"] == 3
    runs = client.get(f"{API}/workflow-runs", params={"workflow_id": wf["id"]}).json()
    assert [r["id"] for r in runs] == [run2["id"], run["id"]]
    lib = next(w for w in client.get(f"{API}/workflows").json() if w["id"] == wf["id"])
    assert lib["last_run"]["id"] == run2["id"] and lib["steps"] == 6


def test_step_data_paging(client):
    wf = _create(client, "gl_expense_cleaner")
    f = _upload(client, EX / "gl_export_messy.csv")
    run = _run(client, wf["id"], {"upload": f["id"]})
    d = client.get(f"{API}/workflow-runs/{run['id']}/steps/clean/data", params={"port": "rejected", "limit": 2}).json()
    assert d["row_count"] == 4 and len(d["rows"]) == 2 and "error" in d["columns"]


def test_missing_file_and_bad_files(client):
    wf = _create(client, "gl_expense_cleaner")
    r = client.post(f"{API}/workflows/{wf['id']}/runs", json={"inputs": {}})
    assert r.status_code == 422 and "Upload a file" in r.json()["error"]["message"]
    r = client.post(f"{API}/workflow-files", files={"file": ("x.xlsx", b"not a zip", "application/octet-stream")})
    assert r.status_code == 422
    r = client.post(f"{API}/workflow-files", files={"file": ("x.exe", b"MZ", "application/octet-stream")})
    assert r.status_code == 422


def test_versioning_and_validation(client):
    wf = _create(client, "gl_expense_cleaner")
    defn = wf["definition"]
    # Layout-only changes still create a version (positions are part of the saved definition) but
    # an identical save does not.
    same = client.put(f"{API}/workflows/{wf['id']}", json={"definition": defn}).json()
    assert same["version"]["number"] == 1
    defn["nodes"][3]["config"]["key_columns"] = ["gl_account", "txn_date", "amount"]
    v2 = client.put(f"{API}/workflows/{wf['id']}", json={"definition": defn}).json()
    assert v2["version"]["number"] == 2 and len(v2["versions"]) == 2
    old = client.get(f"{API}/workflows/{wf['id']}/versions/1").json()
    assert old["definition"]["nodes"][3]["config"]["key_columns"][-1] == "description"

    # Cycles, unknown types, bad configuration and unconnected inputs are rejected with reasons.
    cyc = {
        "nodes": [
            {"id": "a", "type": "column_mapper", "config": {"mapping": [{"target": "x"}]}},
            {"id": "b", "type": "deduplicate", "config": {"key_columns": ["x"]}},
        ],
        "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}],
    }
    errs = client.post(f"{API}/workflows/validate", json=cyc).json()["errors"]
    assert any("cycle" in e["message"] for e in errs)
    bad = {
        "nodes": [
            {"id": "u", "type": "spreadsheet_upload", "config": {}},
            {"id": "f", "type": "formula", "config": {"target": "t", "expression": "__import__('os')"}},
            {"id": "z", "type": "no_such_node", "config": {}},
            {"id": "d", "type": "deduplicate", "config": {}},
        ],
        "edges": [{"source": "u", "target": "f"}],
    }
    msgs = " | ".join(e["message"] for e in client.post(f"{API}/workflows/validate", json=bad).json()["errors"])
    assert "Unknown step type" in msgs and "Key columns is required" in msgs and "connect a step" in msgs
    assert "Only round, abs, min and max are allowed" in msgs


def test_formula_and_filter_use_decimal(client):
    defn = {
        "nodes": [
            {"id": "u", "type": "spreadsheet_upload", "config": {}},
            {"id": "c", "type": "data_cleaner", "config": {"amount_columns": ["amount"]}},
            {
                "id": "fx",
                "type": "formula",
                "config": {"target": "share", "expression": "round([amount] * 0.1 / 3, 2)", "decimal_places": 2},
            },
            {
                "id": "flt",
                "type": "filter_rows",
                "config": {"conditions": [{"column": "amount", "op": "gte", "value": "0.30", "type": "number"}]},
            },
            {"id": "x", "type": "csv_export", "config": {"filename": "out.csv"}},
        ],
        "edges": [
            {"source": "u", "target": "c"},
            {"source": "c", "target": "fx"},
            {"source": "fx", "target": "flt"},
            {"source": "flt", "target": "x"},
        ],
    }
    wf = client.post(f"{API}/workflows", json={"name": "Precision", "definition": defn}).json()
    assert wf["errors"] == []
    f = client.post(
        f"{API}/workflow-files",
        files={"file": ("p.csv", b"id,amount\n1,0.10\n2,0.20\n3,0.30\n4,1000.05\n5,\n", "text/csv")},
    ).json()
    run = _run(client, wf["id"], {"u": f["id"]})
    assert run["status"] == "completed"
    fx = _step(run, "fx")["outputs"]["out"]
    shares = [r[fx["columns"].index("share")] for r in fx["rows"]]
    # 1000.05 * 0.1 / 3 = 33.335 -> 33.34 half up (float would give 33.33)
    assert shares == ["0.00", "0.01", "0.01", "33.34", ""]
    assert any(i["code"] == "FORMULA_ROW" for i in _step(run, "fx")["issues"])
    flt = _step(run, "flt")["outputs"]
    assert flt["out"]["row_count"] == 2 and flt["excluded"]["row_count"] == 3


def test_failed_step_fails_run_and_retry(client):
    defn = {
        "nodes": [
            {"id": "u", "type": "spreadsheet_upload", "config": {"expected_columns": ["Account"]}},
            {"id": "x", "type": "csv_export", "config": {}},
        ],
        "edges": [{"source": "u", "target": "x"}],
    }
    wf = client.post(f"{API}/workflows", json={"name": "Strict", "definition": defn}).json()
    f = client.post(f"{API}/workflow-files", files={"file": ("w.csv", b"Wrong\n1\n", "text/csv")}).json()
    run = _run(client, wf["id"], {"u": f["id"]})
    assert run["status"] == "failed" and "Account" in run["error"]
    assert [s["status"] for s in run["steps"]] == ["failed", "skipped"]
    assert run["artifacts"] == []
    r = client.post(f"{API}/workflow-runs/{run['id']}/retry")
    assert r.status_code == 201
    retry = client.get(f"{API}/workflow-runs/{r.json()['id']}").json()
    assert retry["retry_of"] == run["id"] and retry["status"] == "failed"
    assert retry["inputs"][0]["file_id"] == f["id"]


def test_idempotent_run_creation(client):
    wf = _create(client, "gl_expense_cleaner")
    f = _upload(client, EX / "gl_export_march.csv")
    a = _run(client, wf["id"], {"upload": f["id"]}, key="run-once-1")
    b = _run(client, wf["id"], {"upload": f["id"]}, key="run-once-1")
    assert a["id"] == b["id"]
    assert len(client.get(f"{API}/workflow-runs", params={"workflow_id": wf["id"]}).json()) == 1


def test_preclose_readiness_with_approval_gate(client):
    out = seed(client, DATA, *client.creds)
    pid = out["property_id"]
    wf = _create(client, "cam_preclose_readiness", "Pre-close", pid)
    assert wf["errors"] == []
    run = _run(client, wf["id"], {})
    assert run["status"] == "waiting_approval", run["error"]
    gate = _step(run, "gate")
    assert gate["status"] == "waiting_approval" and gate["approval"]["status"] == "pending"
    assert _step(run, "xlsx")["status"] == "pending" and run["artifacts"] == []

    # The provisional calculation equals a normal audit run for the same inputs.
    alloc = _step(run, "alloc")["outputs"]["out"]
    rows = {r[alloc["columns"].index("tenant")]: dict(zip(alloc["columns"], r, strict=True)) for r in alloc["rows"]}
    audit = out["run"]
    results = client.get(f"{API}/audit-runs/{audit['id']}").json()["results"]
    assert results
    for res in results:
        got = rows[res["tenant_name"]]
        assert got["status"] == res["status"]
        assert (got["total"] or None) == res["total"] and (got["variance"] or None) == res["variance"]
    lease = _step(run, "lease")
    assert any(i["code"] == "MISSING_LEASE_RULE" for i in lease["issues"])

    # A note is required, then approval resumes the run to completion.
    aid = gate["approval"]["id"]
    assert client.post(f"{API}/workflow-approvals/{aid}", json={"decision": "approve", "note": ""}).status_code == 422
    r = client.post(
        f"{API}/workflow-approvals/{aid}", json={"decision": "approve", "note": "Reviewed exceptions with owner"}
    )
    assert r.status_code == 200
    done = client.get(f"{API}/workflow-runs/{run['id']}").json()
    assert done["status"] == "completed", done["error"]
    assert {a["name"] for a in done["artifacts"]} == {"cam-preclose-readiness.xlsx", "cam-preclose-exceptions.xlsx"}
    assert _step(done, "gate")["approval"]["note"] == "Reviewed exceptions with owner"
    report = _step(done, "report")["outputs"]["out"]
    assert report["row_count"] > 0
    # Deciding twice is refused.
    assert (
        client.post(f"{API}/workflow-approvals/{aid}", json={"decision": "reject", "note": "too late"}).status_code
        == 409
    )

    # Reject ends the run without outputs.
    run2 = _run(client, wf["id"], {})
    aid2 = _step(run2, "gate")["approval"]["id"]
    client.post(f"{API}/workflow-approvals/{aid2}", json={"decision": "reject", "note": "Mappings not final"})
    rej = client.get(f"{API}/workflow-runs/{run2['id']}").json()
    assert rej["status"] == "rejected" and rej["artifacts"] == []
    assert _step(rej, "xlsx")["status"] == "skipped"

    # Cancel while waiting for approval.
    run3 = _run(client, wf["id"], {})
    c = client.post(f"{API}/workflow-runs/{run3['id']}/cancel").json()
    assert c["status"] == "cancelled" and _step(c, "gate")["status"] == "cancelled"
    assert client.post(f"{API}/workflow-runs/{run3['id']}/cancel").status_code == 409


def test_property_templates(client):
    out = seed(client, DATA, *client.creds)
    pid = out["property_id"]
    assert (
        client.post(f"{API}/workflows", json={"name": "x", "template_key": "cam_expense_classification"}).status_code
        == 422
    )

    cls = _create(client, "cam_expense_classification", "Classify", pid)
    f = _upload(client, EX / "gl_export_messy.csv")
    run = _run(client, cls["id"], {"upload": f["id"]})
    assert run["status"] == "completed", run["error"]
    c = _step(run, "classify")["outputs"]
    assert c["recoverable"]["row_count"] > 0 and c["review"]["row_count"] > 0
    assert {i["code"] for i in _step(run, "map")["issues"]} & {"UNMAPPED_ACCOUNT", "MAPPING_NEEDS_REVIEW"}

    bill = _create(client, "tenant_billing_comparison", "Billing", pid)
    run = _run(client, bill["id"], {"upload": _upload(client, EX / "tenant_billings.csv")["id"]})
    assert run["status"] == "completed", run["error"]
    cmp_ = _step(run, "compare")["outputs"]["out"]
    rows = [dict(zip(cmp_["columns"], r, strict=True)) for r in cmp_["rows"]]
    calc = [r for r in rows if r["calculated"] and r["billed"]]
    assert calc and all(Decimal(r["difference"]) == Decimal(r["calculated"]) - Decimal(r["billed"]) for r in calc)

    lease = _create(client, "lease_rule_audit", "Lease", pid)
    run = _run(client, lease["id"], {"roster": _upload(client, EX / "tenant_roster.csv")["id"]})
    assert run["status"] == "completed", run["error"]
    chk = _step(run, "check")
    codes = {i["code"] for i in chk["issues"]}
    assert {"MISSING_LEASE_RULE", "RULE_NOT_FOUND"} <= codes
    out_rows = [dict(zip(chk["outputs"]["out"]["columns"], r, strict=True)) for r in chk["outputs"]["out"]["rows"]]
    assert next(r for r in out_rows if r["suite"] == "160")["readiness"] == "blocked"


def test_workflow_isolation(client, user_factory):
    from fastapi.testclient import TestClient

    from app.main import app

    wf = _create(client, "gl_expense_cleaner")
    f = _upload(client, EX / "gl_export_march.csv")
    run = _run(client, wf["id"], {"upload": f["id"]})
    art = run["artifacts"][0]["id"]
    email, pw = user_factory()
    with TestClient(app) as other:
        other.post(f"{API}/auth/login", json={"email": email, "password": pw})
        assert other.get(f"{API}/workflows/{wf['id']}").status_code == 404
        assert other.get(f"{API}/workflow-runs/{run['id']}").status_code == 404
        assert other.get(f"{API}/workflow-artifacts/{art}/download").status_code == 404
        assert other.get(f"{API}/workflow-files/{f['id']}/preview").status_code == 404
        assert all(w["id"] != wf["id"] for w in other.get(f"{API}/workflows").json())
        # Another organization cannot run this workflow, or run its own with this org's file.
        assert other.post(f"{API}/workflows/{wf['id']}/runs", json={"inputs": {"upload": f["id"]}}).status_code == 404
        mine = other.post(f"{API}/workflows", json={"name": "o", "template_key": "gl_expense_cleaner"}).json()
        r = other.post(f"{API}/workflows/{mine['id']}/runs", json={"inputs": {"upload": f["id"]}})
        assert r.status_code == 422 and "not found" in r.json()["error"]["message"]


def _two_step(client, retries: int):
    defn = {
        "nodes": [
            {"id": "u", "type": "spreadsheet_upload", "config": {}},
            {"id": "x", "type": "csv_export", "config": {"retries": retries}},
            {"id": "y", "type": "csv_export", "config": {"filename": "second.csv"}},
        ],
        "edges": [{"source": "u", "target": "x"}, {"source": "u", "target": "y"}],
    }
    wf = client.post(f"{API}/workflows", json={"name": f"Retry {retries}", "definition": defn}).json()
    f = client.post(f"{API}/workflow-files", files={"file": ("r.csv", b"a\n1\n", "text/csv")}).json()
    return wf, f


def test_retry_policy_and_safe_errors(client, monkeypatch):
    import dataclasses

    from app.workflows import nodes

    calls = {"n": 0}
    real = nodes.REGISTRY["csv_export"]

    def flaky(ctx, inp, c):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient: connection reset at 10.0.0.5")
        return real.run(ctx, inp, c)

    monkeypatch.setitem(nodes.REGISTRY, "csv_export", dataclasses.replace(real, run=flaky))
    wf, f = _two_step(client, retries=1)
    run = _run(client, wf["id"], {"u": f["id"]})
    assert run["status"] == "completed"
    x = _step(run, "x")
    assert x["attempts"] == 2 and any("Retrying" in line for line in x["logs"])

    calls["n"] = -10  # always fail now: every call before n reaches 1 raises
    monkeypatch.setitem(
        nodes.REGISTRY,
        "csv_export",
        dataclasses.replace(real, run=lambda *_: (_ for _ in ()).throw(RuntimeError("secret detail"))),
    )
    wf, f = _two_step(client, retries=0)
    run = _run(client, wf["id"], {"u": f["id"]})
    assert run["status"] == "failed"
    x = _step(run, "x")
    assert x["status"] == "failed" and x["attempts"] == 1
    assert "secret detail" not in x["error"] and "Unexpected error" in x["error"]  # internals are never shown
    assert _step(run, "y")["status"] == "skipped" and run["artifacts"] == []


def test_cancel_while_running(client, monkeypatch):
    import dataclasses

    from sqlalchemy import update

    from app import models as M
    from app.db import SessionLocal
    from app.workflows import nodes

    real = nodes.REGISTRY["csv_export"]

    def cancel_during(ctx, inp, c):
        with SessionLocal() as s:  # a reviewer cancels from another request while this step runs
            s.execute(update(M.WorkflowRun).where(M.WorkflowRun.id == ctx.run_id).values(cancel_requested=True))
            s.commit()
        return real.run(ctx, inp, c)

    monkeypatch.setitem(nodes.REGISTRY, "csv_export", dataclasses.replace(real, run=cancel_during))
    wf, f = _two_step(client, retries=0)
    run = _run(client, wf["id"], {"u": f["id"]})
    assert run["status"] == "cancelled"
    assert [s["status"] for s in run["steps"]] == ["completed", "completed", "cancelled"]
