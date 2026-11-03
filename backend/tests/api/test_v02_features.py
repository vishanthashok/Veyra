"""v0.2 behavior: reproducibility, atomic imports, isolation, review queue and bulk mapping."""

import uuid
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.demo_seed import DATA, seed

from .test_regressions_v02 import _rule, _setup, _upload


@pytest.fixture
def demo(client):
    return seed(client, DATA, *client.creds)


def test_old_run_stays_reproducible_after_inputs_change(client, demo):
    rid = demo["run"]["id"]
    pid = demo["property_id"]
    before = client.get(f"/api/v1/audit-runs/{rid}").json()
    # Change a lease rule, a mapping and exclude a transaction after the run.
    rule = next(r for r in client.get(f"/api/v1/properties/{pid}/lease-rules").json() if r["ref"] == "LR-110")
    client.post(f"/api/v1/lease-rules/{rule['id']}/unapprove", json={"note": "fix base year"})
    client.put(
        f"/api/v1/properties/{pid}/mappings/6600",
        json={"status": "nonrecoverable", "category_code": "INSURANCE", "explanation": "reclassified"},
    )
    v = client.post(f"/api/v1/audit-runs/{rid}/verify").json()
    assert v == {
        "reproducible": True,
        "engine_version_stored": before["engine_version"],
        "engine_version_now": before["engine_version"],
        "differences": [],
    }
    after = client.get(f"/api/v1/audit-runs/{rid}").json()
    assert [r["total"] for r in after["results"]] == [r["total"] for r in before["results"]]
    # A new run reflects the changes.
    new = client.get(
        f"/api/v1/audit-runs/{client.post(f'/api/v1/properties/{pid}/audit-runs', json={'period_id': demo['period_id']}).json()['id']}"
    ).json()
    assert "INS" not in new["summary"]["pools"]
    assert next(r for r in new["results"] if r["tenant_name"] == "Alamo Cellular")["status"] == "unresolved"
    assert new["snapshot_counts"]["lease_rules"] == before["snapshot_counts"]["lease_rules"] - 1


def test_snapshot_records_versions_and_files(client, demo):
    run = client.get(f"/api/v1/audit-runs/{demo['run']['id']}").json()
    assert run["reproducible"] is True
    assert run["snapshot_counts"]["source_files"] == 2  # GL and billings feed the calculation
    trace = client.get(f"/api/v1/audit-results/{run['results'][0]['id']}/trace").json()
    assert trace["lease_rule"]["version"] >= 1
    assert trace["engine_version"] == run["engine_version"]


def test_failed_commit_writes_nothing_and_can_retry(client, monkeypatch):
    pid, _, _ = _setup(client, [])
    csv = b"Account,Date,Amount\n6100,2026-03-01,1.00\n6100,2026-03-02,2.00\n6100,2026-03-03,3.00\n"
    prev = client.post(
        f"/api/v1/properties/{pid}/imports", data={"kind": "gl"}, files={"file": ("gl.csv", csv, "text/csv")}
    ).json()
    from app.services import imports as I

    real = I.stage_gl

    def boom(db, actor, batch, rows):
        real(db, actor, batch, rows[:2])  # rows are added, then the process fails mid-commit
        raise RuntimeError("disk full")

    monkeypatch.setattr(I, "stage_gl", boom)
    with TestClient(__import__("app.main", fromlist=["app"]).app, raise_server_exceptions=False) as c2:
        c2.cookies = client.cookies
        r = c2.post(f"/api/v1/imports/{prev['batch']['id']}/commit", json={"column_map": prev["suggested_map"]})
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "internal_error"
    assert "disk full" not in r.text  # internal detail not leaked
    assert client.get(f"/api/v1/properties/{pid}/gl-transactions").json()["total"] == 0
    assert client.get(f"/api/v1/properties/{pid}/imports").json()[0]["status"] == "failed"
    monkeypatch.setattr(I, "stage_gl", real)
    ok = client.post(f"/api/v1/imports/{prev['batch']['id']}/commit", json={"column_map": prev["suggested_map"]})
    assert ok.status_code == 200 and ok.json()["batch"]["accepted_count"] == 3


def test_validate_is_a_dry_run(client):
    pid, _, _ = _setup(client, [])
    csv = b"Account,Date,Amount\n6100,2026-03-01,1.00\n6100,bad,2.00\n"
    prev = client.post(
        f"/api/v1/properties/{pid}/imports", data={"kind": "gl"}, files={"file": ("gl.csv", csv, "text/csv")}
    ).json()
    v = client.post(
        f"/api/v1/imports/{prev['batch']['id']}/validate", json={"column_map": prev["suggested_map"]}
    ).json()
    assert v["dry_run"] is True and v["batch"]["accepted_count"] == 1 and len(v["batch"]["rejected_rows"]) == 1
    assert client.get(f"/api/v1/properties/{pid}/gl-transactions").json()["total"] == 0
    assert client.get(f"/api/v1/properties/{pid}/imports").json()[0]["status"] == "uploaded"


def test_error_report_csv(client):
    pid, _, _ = _setup(client, [])
    res = _upload(client, pid, "gl", "gl.csv", b"Account,Date,Amount\n6100,nope,1.00\n").json()
    r = client.get(f"/api/v1/imports/{res['batch']['id']}/errors.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "source_row,errors" in r.text and "Unrecognized date" in r.text


def test_upload_idempotency_key(client):
    pid, _, _ = _setup(client, [])
    h = {"Idempotency-Key": "upload-1"}
    files = {"file": ("gl.csv", b"Account,Date,Amount\n6100,2026-03-01,1.00\n", "text/csv")}
    a = client.post(f"/api/v1/properties/{pid}/imports", data={"kind": "gl"}, files=files, headers=h).json()
    b = client.post(f"/api/v1/properties/{pid}/imports", data={"kind": "gl"}, files=files, headers=h).json()
    assert a["batch"]["id"] == b["batch"]["id"]
    assert len(client.get(f"/api/v1/properties/{pid}/imports").json()) == 1


def test_bulk_mapping_records_each_account(client):
    pid, _, _ = _setup(client, [])
    _upload(client, pid, "gl", "gl.csv", b"Account,Date,Amount\n6100,2026-03-01,1.00\n6200,2026-03-01,2.00\n")
    r = client.post(
        f"/api/v1/properties/{pid}/mappings/bulk",
        json={
            "gl_accounts": ["6100", "6200"],
            "status": "recoverable",
            "category_code": "LAND",
            "explanation": "Common area, lease 6.1",
        },
    )
    assert r.status_code == 200
    assert [(a["gl_account"], a["status"], a["version"]) for a in r.json()] == [
        ("6100", "recoverable", 1),
        ("6200", "recoverable", 1),
    ]
    hist = client.get(f"/api/v1/properties/{pid}/mappings/6200/history").json()
    assert hist[0]["decision"] == "recoverable"
    bad = client.post(
        f"/api/v1/properties/{pid}/mappings/bulk",
        json={"gl_accounts": ["6100"], "status": "recoverable", "explanation": "x"},
    )
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "validation_error"


def test_exception_lifecycle(client):
    pid, per, ids = _setup(client, [("A", "1", "1000")])
    _upload(client, pid, "gl", "gl.csv", b"Account,Date,Amount\n6100,2026-03-01,1.00\n")  # unmapped warning
    run = client.post(f"/api/v1/properties/{pid}/audit-runs", json={"period_id": per}).json()
    queue = client.get(f"/api/v1/properties/{pid}/exceptions").json()
    warn = next(e for e in queue if e["type"] == "MAPPING_NEEDS_REVIEW")
    url = f"/api/v1/exceptions/{warn['id']}"
    me = client.get("/api/v1/auth/me").json()
    assert client.put(url + "/assignee", json={"user_id": me["user_id"]}).json()["assigned_to_name"]
    assert client.patch(url, json={"status": "in_review", "note": "checking invoice"}).json()["status"] == "in_review"
    assert client.patch(url, json={"status": "resolved", "note": "mapped in next run"}).json()["status"] == "resolved"
    assert client.patch(url, json={"status": "accepted", "note": "skip"}).status_code == 422  # must reopen first
    assert client.patch(url, json={"status": "reopened", "note": "auditor asked again"}).json()["status"] == "reopened"
    hist = [h["decision"] for h in client.get(url + "/history").json()]
    assert hist == ["in_review", "resolved", "reopened"]
    only_open = client.get(f"/api/v1/audit-runs/{run['id']}/exceptions", params={"status": "open"}).json()
    assert warn["id"] not in [e["id"] for e in only_open]


def test_tenant_without_history_can_be_deleted(client):
    pid, _, ids = _setup(client, [("Temp", "9", "100")])
    assert client.delete(f"/api/v1/tenants/{ids[('Temp', '9')]}").status_code == 204


def test_org_isolation_across_all_resources(client, user_factory, demo):
    run = client.get(f"/api/v1/audit-runs/{demo['run']['id']}").json()
    exc = client.get(f"/api/v1/audit-runs/{run['id']}/exceptions").json()[0]
    batch = client.get(f"/api/v1/properties/{demo['property_id']}/imports").json()[0]
    txn = client.get(f"/api/v1/properties/{demo['property_id']}/gl-transactions").json()["items"][0]
    rule = client.get(f"/api/v1/properties/{demo['property_id']}/lease-rules").json()[0]
    from app.main import app

    email, pw = user_factory()
    with TestClient(app) as other:
        other.post("/api/v1/auth/login", json={"email": email, "password": pw})
        for method, path, body in [
            ("get", f"/api/v1/audit-runs/{run['id']}", None),
            ("post", f"/api/v1/audit-runs/{run['id']}/verify", None),
            ("get", f"/api/v1/audit-runs/{run['id']}/exceptions", None),
            ("get", f"/api/v1/audit-runs/{run['id']}/reports/package.xlsx", None),
            ("get", f"/api/v1/audit-results/{run['results'][0]['id']}/trace", None),
            ("patch", f"/api/v1/exceptions/{exc['id']}", {"status": "accepted", "note": "nope nope"}),
            ("get", f"/api/v1/exceptions/{exc['id']}/history", None),
            ("get", f"/api/v1/imports/{batch['id']}/errors.csv", None),
            ("post", f"/api/v1/imports/{batch['id']}/commit", {"column_map": {}}),
            ("post", f"/api/v1/gl-transactions/{txn['id']}/exclude", {"note": "nope nope"}),
            ("post", f"/api/v1/lease-rules/{rule['id']}/unapprove", {"note": "nope nope"}),
            ("get", f"/api/v1/properties/{demo['property_id']}/gl-transactions", None),
            ("get", f"/api/v1/properties/{demo['property_id']}/exceptions", None),
        ]:
            r = getattr(other, method)(path, **({"json": body} if body is not None else {}))
            assert r.status_code == 404, (method, path, r.status_code)
        assert other.get("/api/v1/dashboard").json() == {"properties": []}
        assert {u["email"] for u in other.get("/api/v1/users").json()} == {email}


def test_dashboard_readiness(client, demo):
    d = next(p for p in client.get("/api/v1/dashboard").json()["properties"] if p["id"] == demo["property_id"])
    assert d["checks"]["gl_imported"] and d["checks"]["billings_imported"]
    assert d["accounts_needing_review"] == 1  # 6150 planted
    assert d["tenants_missing_rules"] == 1 and d["tenants_missing_area"] == 1
    assert d["ready"] is False and 0 < d["completeness"] < 100
    assert d["open_exceptions"]["error"] == 3


def test_production_config_refuses_default_secret():
    from app.config import Settings

    with pytest.raises(RuntimeError, match="VEYRA_SECRET_KEY"):
        Settings(env="production").validate_for_runtime()
    Settings(env="production", secret_key="x" * 40, cookie_secure=True).validate_for_runtime()


def test_rule_edit_bumps_version(client):
    pid, _, ids = _setup(client, [("A", "1", "1000")])
    r = _rule(client, pid, ids[("A", "1")])
    assert r["version"] == 1
    client.post(f"/api/v1/lease-rules/{r['id']}/unapprove", json={"note": "edit"})
    body = {"ref": "LR-1", "pools": [{"pool": "CAM", "method": "pro_rata", "denominator_sqft": "9000"}]}
    assert client.put(f"/api/v1/lease-rules/{r['id']}", json=body).json()["version"] == 2


def test_validation_error_envelope(client):
    r = client.post("/api/v1/properties", json={"name": ""})
    assert r.status_code == 422
    e = r.json()["error"]
    assert e["code"] == "validation_error" and e["details"][0]["field"] == "name"
    assert uuid.UUID(e["request_id"], version=4) or e["request_id"]


def test_engine_values_unchanged_for_demo(client, demo):
    """Characterization: v0.2 must produce the v0.1 demo figures exactly."""
    run = client.get(f"/api/v1/audit-runs/{demo['run']['id']}").json()
    totals = {r["tenant_name"]: r["total"] for r in run["results"]}
    assert totals == {
        "Lone Star Grocery Co.": "71019.74",
        "Alamo Cellular": "5795.57",
        "Bluebonnet Nail Spa": None,
        "Guadalupe Tax Services": "9686.66",
        "Hill Country Yoga": None,
        "Brazos Coffee Roasters": "2203.66",
        "Pecan Street Dental": None,
        "Rio Grande Pizza": "7010.09",
    }
    assert sum(Decimal(v) for v in totals.values() if v) == Decimal("95715.72")


def test_activity_is_built_from_real_records(client, demo):
    events = client.get("/api/v1/activity", params={"limit": 100}).json()
    kinds = {e["kind"] for e in events}
    assert {"audit_run", "import", "expense_mapping", "lease_rule"} <= kinds
    assert [e["at"] for e in events] == sorted([e["at"] for e in events], reverse=True)
    # Exactly the 3 committed imports and 7 rule approvals from the seed, no invented events.
    assert sum(e["kind"] == "import" for e in events) == 3
    assert sum(e["kind"] == "lease_rule" for e in events) == 7
    run = next(e for e in events if e["kind"] == "audit_run")
    assert run["detail"] == "5 calculated, 3 unresolved"
    scoped = client.get("/api/v1/activity", params={"property_id": demo["property_id"]}).json()
    assert all(e["property_id"] == demo["property_id"] for e in scoped)


def test_dashboard_exposes_period_and_open_exception_types(client, demo):
    d = next(p for p in client.get("/api/v1/dashboard").json()["properties"] if p["id"] == demo["property_id"])
    assert d["period"]["label"] == "FY2026 YTD Sep" and d["period"]["through_date"] == "2026-09-30"
    types = {(t["type"], t["severity"]): t["count"] for t in d["open_exception_types"]}
    assert types[("MISSING_LEASE_RULE", "error")] == 1
    assert d["open_exception_types"][0]["severity"] == "error"
