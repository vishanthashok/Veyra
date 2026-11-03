import io
import sys
from decimal import Decimal
from pathlib import Path

from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.demo_seed import DATA, REPO, seed

sys.path.insert(0, str(REPO / "demo"))
import expected as EXP  # noqa: E402


def _prop(client, name="Test Plaza"):
    p = client.post("/api/v1/properties", json={"name": name, "total_rsf": "10000"}).json()
    return p["id"]


def test_requires_login():
    from app.main import app
    with TestClient(app) as c:
        assert c.get("/api/v1/properties").status_code == 401
        assert c.get("/api/health").json() == {"status": "ok"}


def test_demo_end_to_end_matches_independent_expected(client):
    out = seed(client, DATA, *client.creds)
    run = client.get(f"/api/v1/audit-runs/{out['run']['id']}").json()
    assert run["provisional"] is True
    by_name = {r["tenant_name"]: r for r in run["results"]}

    exp = EXP.expected()
    for name, e in exp.items():
        r = by_name[name]
        assert r["status"] == "calculated", (name, r["unresolved_reasons"])
        lines = {ln["pool"]: Decimal(ln["amount"]) for ln in r["lines"]}
        assert lines == {k: v[0] for k, v in e["lines"].items()}, name
        assert Decimal(r["admin_fee"]) == e["admin_fee"][0], name
        assert Decimal(r["total"]) == e["total"], name
    for name in EXP.UNRESOLVED:
        assert by_name[name]["status"] == "unresolved"
        assert by_name[name]["total"] is None

    # Imports: nothing silently dropped.
    gl = out["imports"]["gl"]["batch"]
    assert gl["row_count"] == gl["accepted_count"] == 69 and gl["rejected_rows"] == []

    exc_types = {e["type"] for e in client.get(f"/api/v1/audit-runs/{run['id']}/exceptions").json()}
    for t in ["DUPLICATE_GL_CANDIDATE", "MAPPING_NEEDS_REVIEW", "TRANSACTION_OUTSIDE_PERIOD",
              "MISSING_TENANT_AREA", "MISSING_LEASE_RULE", "UNSUPPORTED_RULE",
              "VARIANCE_OVER_THRESHOLD"]:
        assert t in exc_types, t

    # Trace exists and explains the total.
    gro = by_name["Guadalupe Tax Services"]
    steps = client.get(f"/api/v1/audit-results/{gro['id']}/trace").json()["steps"]
    labels = [s["label"] for s in steps]
    assert "[CAM] Controllable cap" in labels and "Admin fee" in labels

    # Reports carry the provisional banner and the computed total.
    for kind in ["classification", "allocation", "missing-information", "exceptions", "readiness", "package"]:
        resp = client.get(f"/api/v1/audit-runs/{run['id']}/reports/{kind}.xlsx")
        assert resp.status_code == 200, kind
        wb = load_workbook(io.BytesIO(resp.content))
        assert wb.worksheets[0]["A1"].value.startswith("PROVISIONAL"), kind
        assert wb.worksheets[0]["A3"].value == "SYNTHETIC DEMONSTRATION DATA"
    wb = load_workbook(io.BytesIO(client.get(
        f"/api/v1/audit-runs/{run['id']}/reports/allocation.xlsx").content))
    ws = wb["Tenant allocation"]
    totals = {ws.cell(r, 1).value: ws.cell(r, 11).value for r in range(6, ws.max_row + 1)
              if ws.cell(r, 11).value is not None}
    assert Decimal(str(totals["Rio Grande Pizza"])) == exp["Rio Grande Pizza"]["total"]

    # Excluding the confirmed duplicate changes CAM by exactly one invoice.
    txns = client.get(f"/api/v1/properties/{out['property_id']}/gl-transactions",
                      params={"gl_account": "6100"}).json()
    dup = [t for t in txns if t["txn_date"] == "2026-03-05"][1]
    assert client.post(f"/api/v1/gl-transactions/{dup['id']}/exclude",
                       json={"note": "Confirmed duplicate invoice"}).status_code == 200
    run2 = client.post(f"/api/v1/properties/{out['property_id']}/audit-runs",
                       json={"period_id": out["period_id"]}).json()
    assert Decimal(run2["summary"]["pools"]["CAM"]["recoverable_total"]) == Decimal("76384.50")
    assert run2["input_hash"] != run["input_hash"]


def test_org_isolation(client, user_factory):
    pid = _prop(client)
    from app.main import app
    email, pw = user_factory()
    with TestClient(app) as other:
        other.post("/api/v1/auth/login", json={"email": email, "password": pw})
        assert other.get(f"/api/v1/properties/{pid}").status_code == 404
        assert other.get("/api/v1/properties").json() == []
        assert other.post(f"/api/v1/properties/{pid}/tenants", json={"name": "X"}).status_code == 404


def test_invalid_rows_are_kept_with_errors(client):
    pid = _prop(client)
    csv = (b"Account,Date,Amount,Memo/Description\n"
           b"6100,2026-01-05,100.00,ok\n"
           b"6100,not-a-date,100.00,bad date\n"
           b"6100,2026-01-06,,blank amount\n"
           b"6100,2026-01-07,12.345,too many decimals\n"
           b",2026-01-08,5.00,no account\n")
    prev = client.post(f"/api/v1/properties/{pid}/imports", data={"kind": "gl"},
                       files={"file": ("gl.csv", csv, "text/csv")}).json()
    assert prev["suggested_map"]["gl_account"] == "Account"
    res = client.post(f"/api/v1/imports/{prev['batch']['id']}/commit",
                      json={"column_map": prev["suggested_map"]}).json()
    b = res["batch"]
    assert b["accepted_count"] == 1
    assert [r["row"] for r in b["rejected_rows"]] == [3, 4, 5, 6]
    # New accounts default to needs_review, never recoverable.
    accts = client.get(f"/api/v1/properties/{pid}/gl-accounts").json()
    assert accts[0]["status"] == "needs_review"
    # Re-committing is refused; re-uploading the same file warns.
    assert client.post(f"/api/v1/imports/{b['id']}/commit",
                       json={"column_map": prev["suggested_map"]}).status_code == 409
    again = client.post(f"/api/v1/properties/{pid}/imports", data={"kind": "gl"},
                        files={"file": ("gl.csv", csv, "text/csv")}).json()
    assert again["warnings"]


def test_upload_safety(client):
    pid = _prop(client)
    url = f"/api/v1/properties/{pid}/imports"
    assert client.post(url, data={"kind": "gl"}, files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 422
    assert client.post(url, data={"kind": "gl"}, files={"file": ("x.xlsx", b"not a zip", "application/zip")}).status_code == 422
    assert client.post(url, data={"kind": "nope"}, files={"file": ("x.csv", b"a\n1", "text/csv")}).status_code == 422
    big = b"a\n" + b"1\n" * (6 * 1024 * 1024)
    assert client.post(url, data={"kind": "gl"}, files={"file": ("x.csv", big, "text/csv")}).status_code == 413


def test_mapping_rules(client):
    pid = _prop(client)
    client.post(f"/api/v1/properties/{pid}/categories",
                json={"code": "LANDSCAPE", "name": "Landscaping", "pool": "CAM"})
    url = f"/api/v1/properties/{pid}/mappings/6100"
    assert client.put(url, json={"status": "recoverable", "explanation": "x"}).status_code == 422
    assert client.put(url, json={"status": "recoverable", "category_code": "LANDSCAPE",
                                 "explanation": ""}).status_code == 422
    assert client.put(url, json={"status": "recoverable", "category_code": "NOPE",
                                 "explanation": "x"}).status_code == 422
    ok = client.put(url, json={"status": "recoverable", "category_code": "LANDSCAPE",
                               "explanation": "Lease s.6.1"})
    assert ok.status_code == 200 and ok.json()["reviewer"]


def test_approved_rule_is_locked(client):
    pid = _prop(client)
    body = {"ref": "LR-1", "pools": [{"pool": "CAM", "method": "pro_rata", "denominator_sqft": "10000"}]}
    r = client.post(f"/api/v1/properties/{pid}/lease-rules", json=body).json()
    assert r["status"] == "draft"
    assert client.post(f"/api/v1/lease-rules/{r['id']}/approve", json={"note": "checked"}).json()["status"] == "approved"
    assert client.put(f"/api/v1/lease-rules/{r['id']}", json=body).status_code == 409
    client.post(f"/api/v1/lease-rules/{r['id']}/unapprove", json={"note": "fix denominator"})
    assert client.put(f"/api/v1/lease-rules/{r['id']}", json=body).status_code == 200


def test_period_validation(client):
    pid = _prop(client)
    bad = {"label": "x", "fiscal_year_start": "2026-01-01", "fiscal_year_end": "2026-12-31",
           "through_date": "2027-01-05"}
    assert client.post(f"/api/v1/properties/{pid}/periods", json=bad).status_code == 422
