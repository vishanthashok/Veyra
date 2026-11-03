"""Regression tests for defects found in the v0.2 engineering audit.

Each test was written first against v0.1 to reproduce the defect (see docs/ENGINEERING_AUDIT.md),
then kept as a regression guard.
"""

import io
from decimal import Decimal

from fastapi.testclient import TestClient
from openpyxl import load_workbook


def _setup(client, tenants):
    pid = client.post("/api/v1/properties", json={"name": "Reg Plaza", "total_rsf": "10000"}).json()["id"]
    per = client.post(
        f"/api/v1/properties/{pid}/periods",
        json={
            "label": "FY26",
            "fiscal_year_start": "2026-01-01",
            "fiscal_year_end": "2026-12-31",
            "through_date": "2026-09-30",
        },
    ).json()["id"]
    client.post(f"/api/v1/properties/{pid}/categories", json={"code": "LAND", "name": "Land", "pool": "CAM"})
    ids = {}
    for name, suite, area in tenants:
        ids[(name, suite)] = client.post(
            f"/api/v1/properties/{pid}/tenants",
            json={"name": name, "suite": suite, "rentable_area": area, "lease_start": "2020-01-01"},
        ).json()["id"]
    return pid, per, ids


def _upload(client, pid, kind, name, content, **commit_kw):
    prev = client.post(
        f"/api/v1/properties/{pid}/imports", data={"kind": kind}, files={"file": (name, content, "text/csv")}
    )
    assert prev.status_code == 201, prev.text
    prev = prev.json()
    return client.post(
        f"/api/v1/imports/{prev['batch']['id']}/commit", json={"column_map": prev["suggested_map"], **commit_kw}
    )


def _rule(client, pid, tid, ref="LR-1", **extra):
    r = client.post(
        f"/api/v1/properties/{pid}/lease-rules",
        json={"ref": ref, "pools": [{"pool": "CAM", "method": "pro_rata", "denominator_sqft": "10000"}], **extra},
    ).json()
    client.post(f"/api/v1/lease-rules/{r['id']}/approve", json={"note": "checked"})
    t = client.get(f"/api/v1/properties/{pid}/tenants").json()
    me = next(x for x in t if x["id"] == tid)
    client.put(
        f"/api/v1/tenants/{tid}",
        json={
            **{k: me[k] for k in ("name", "suite", "rentable_area", "lease_start", "lease_end", "allocation_method")},
            "lease_rule_id": r["id"],
        },
    )
    return r


# F-01 -----------------------------------------------------------------------
def test_ambiguous_tenant_name_is_rejected_not_misassigned(client):
    pid, _, _ = _setup(client, [("Dental Group", "100", "1000"), ("Dental Group", "200", "1000")])
    res = _upload(
        client,
        pid,
        "billings",
        "b.csv",
        b"Tenant,Bill Date,Amount\nDental Group,2026-01-01,100.00\n200,2026-01-01,50.00\n",
    ).json()
    b = res["batch"]
    assert b["accepted_count"] == 1  # the suite match is unambiguous
    assert b["rejected_rows"][0]["row"] == 2
    assert "matches more than one tenant" in b["rejected_rows"][0]["errors"][0]


# F-02 -----------------------------------------------------------------------
def test_tenant_with_financial_records_cannot_be_deleted(client):
    pid, _, ids = _setup(client, [("Solo", "100", "1000")])
    _upload(client, pid, "billings", "b.csv", b"Tenant,Bill Date,Amount\nSolo,2026-01-01,100.00\n")
    tid = ids[("Solo", "100")]
    r = client.delete(f"/api/v1/tenants/{tid}")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "conflict"


# F-03 -----------------------------------------------------------------------
def test_old_audit_run_report_uses_its_own_snapshot(client):
    pid, per, ids = _setup(client, [("Solo", "100", "2000")])
    _upload(client, pid, "gl", "gl.csv", b"Account,Date,Amount\n6100,2026-03-01,1000.00\n")
    client.put(
        f"/api/v1/properties/{pid}/mappings/6100",
        json={"status": "recoverable", "category_code": "LAND", "explanation": "lease 6.1"},
    )
    _rule(client, pid, ids[("Solo", "100")])
    run1 = client.post(f"/api/v1/properties/{pid}/audit-runs", json={"period_id": per}).json()
    # Reviewer later reclassifies the account.
    client.put(
        f"/api/v1/properties/{pid}/mappings/6100",
        json={"status": "nonrecoverable", "category_code": "LAND", "explanation": "capital"},
    )
    wb = load_workbook(io.BytesIO(client.get(f"/api/v1/audit-runs/{run1['id']}/reports/classification.xlsx").content))
    ws = wb["Expense classification"]
    header = [c.value for c in ws[6]]
    col = header.index("Recoverability") + 1
    statuses = {ws.cell(r, col).value for r in range(7, ws.max_row + 1) if ws.cell(r, 1).value == "6100"}
    assert statuses == {"recoverable"}  # what run 1 actually used
    snap = client.get(f"/api/v1/audit-runs/{run1['id']}").json()
    assert snap["engine_version"]
    assert snap["snapshot_counts"]["transactions"] == 1


# F-04 -----------------------------------------------------------------------
def test_admin_fee_on_pool_tenant_does_not_pay_is_unresolved(client):
    pid, per, ids = _setup(client, [("Solo", "100", "2000")])
    _upload(client, pid, "gl", "gl.csv", b"Account,Date,Amount\n6100,2026-03-01,1000.00\n")
    client.put(
        f"/api/v1/properties/{pid}/mappings/6100",
        json={"status": "recoverable", "category_code": "LAND", "explanation": "lease 6.1"},
    )
    _rule(client, pid, ids[("Solo", "100")], admin_fee_pct="0.10", admin_fee_pools=["TAX"])
    run = client.get(
        f"/api/v1/audit-runs/{client.post(f'/api/v1/properties/{pid}/audit-runs', json={'period_id': per}).json()['id']}"
    ).json()
    assert run["results"][0]["status"] == "unresolved"


# F-05 -----------------------------------------------------------------------
def test_blocking_error_cannot_be_marked_resolved_by_hand(client):
    pid, per, _ = _setup(client, [("NoRule", "100", "1000")])
    run = client.post(f"/api/v1/properties/{pid}/audit-runs", json={"period_id": per}).json()
    exc = client.get(f"/api/v1/audit-runs/{run['id']}/exceptions").json()
    err = next(e for e in exc if e["severity"] == "error")
    r = client.patch(f"/api/v1/exceptions/{err['id']}", json={"status": "resolved", "note": "looks fine"})
    assert r.status_code == 422
    ok = client.patch(
        f"/api/v1/exceptions/{err['id']}", json={"status": "accepted", "note": "Tenant vacated, excluded by owner"}
    )
    assert ok.status_code == 200 and ok.json()["status"] == "accepted"
    hist = client.get(f"/api/v1/exceptions/{err['id']}/history").json()
    assert [h["decision"] for h in hist] == ["accepted"]


# F-06 -----------------------------------------------------------------------
def test_committing_identical_file_twice_requires_confirmation(client):
    pid, _, _ = _setup(client, [])
    csv = b"Account,Date,Amount\n6100,2026-03-01,1000.00\n"
    assert _upload(client, pid, "gl", "gl.csv", csv).status_code == 200
    r = _upload(client, pid, "gl", "gl.csv", csv)
    assert r.status_code == 409
    assert _upload(client, pid, "gl", "gl.csv", csv, allow_duplicate_file=True).status_code == 200
    assert len(client.get(f"/api/v1/properties/{pid}/gl-transactions").json()["items"]) == 2


# F-07 -----------------------------------------------------------------------
def test_logout_revokes_session(client):
    token = client.cookies.get("veyra_session")
    client.post("/api/v1/auth/logout")
    from app.main import app

    with TestClient(app) as other:
        other.cookies.set("veyra_session", token)
        assert other.get("/api/v1/auth/me").status_code == 401


# F-08 -----------------------------------------------------------------------
def test_login_is_rate_limited(user_factory):
    from app.main import app

    email, _ = user_factory()
    with TestClient(app) as c:
        codes = [c.post("/api/v1/auth/login", json={"email": email, "password": "wrong"}).status_code for _ in range(7)]
    assert codes[:5] == [401] * 5
    assert codes[-1] == 429


# F-09 -----------------------------------------------------------------------
def test_audit_run_idempotency_key(client):
    pid, per, _ = _setup(client, [])
    h = {"Idempotency-Key": "run-abc-1"}
    a = client.post(f"/api/v1/properties/{pid}/audit-runs", json={"period_id": per}, headers=h).json()
    b = client.post(f"/api/v1/properties/{pid}/audit-runs", json={"period_id": per}, headers=h).json()
    assert a["id"] == b["id"]
    assert len(client.get(f"/api/v1/properties/{pid}/audit-runs").json()) == 1


# F-10 -----------------------------------------------------------------------
def test_errors_use_consistent_envelope_and_request_id(client):
    r = client.get("/api/v1/properties/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404
    body = r.json()
    assert body["error"]["code"] == "not_found"
    assert body["error"]["request_id"] == r.headers["X-Request-ID"]
    assert r.headers["X-Content-Type-Options"] == "nosniff"


def test_repeat_audit_is_deterministic(client):
    pid, per, ids = _setup(client, [("A", "1", "3333"), ("B", "2", "3333"), ("C", "3", "3334")])
    _upload(client, pid, "gl", "gl.csv", b"Account,Date,Amount\n6100,2026-03-01,1000.01\n6100,2026-04-01,-12.34\n")
    client.put(
        f"/api/v1/properties/{pid}/mappings/6100",
        json={"status": "recoverable", "category_code": "LAND", "explanation": "lease 6.1"},
    )
    for i, k in enumerate(ids):
        _rule(client, pid, ids[k], ref=f"LR-{i}")
    r1 = client.get(
        f"/api/v1/audit-runs/{client.post(f'/api/v1/properties/{pid}/audit-runs', json={'period_id': per}).json()['id']}"
    ).json()
    r2 = client.get(
        f"/api/v1/audit-runs/{client.post(f'/api/v1/properties/{pid}/audit-runs', json={'period_id': per}).json()['id']}"
    ).json()
    assert r1["input_hash"] == r2["input_hash"]
    strip = lambda run: [(x["tenant_name"], x["total"], x["lines"]) for x in run["results"]]  # noqa: E731
    assert strip(r1) == strip(r2)
    assert sum(Decimal(x["total"]) for x in r1["results"]) == Decimal("987.67")
