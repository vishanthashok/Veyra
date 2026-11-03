"""Load the synthetic Mesquite Crossing dataset through the real API.

Usage (from backend/):
    uv run python -m app.demo_seed            # seed and run an audit
    uv run python -m app.demo_seed --reports  # also write the Excel reports to demo/output/

ALL DATA IS SYNTHETIC.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

from sqlalchemy import select

from .auth import hash_password
from .db import SessionLocal
from .models import Organization, User

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "demo" / "data"
DEMO_EMAIL = "demo@veyra.local"
DEMO_PASSWORD = os.environ.get("VEYRA_DEMO_PASSWORD", "veyra-demo-2026")
PROPERTY_NAME = "Mesquite Crossing (Synthetic)"


def ensure_demo_user(email=DEMO_EMAIL, password=DEMO_PASSWORD, org_name="Demo Org (Synthetic)"):
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            org = Organization(name=org_name)
            db.add(org)
            db.flush()
            user = User(organization_id=org.id, email=email, name="Demo Reviewer",
                        password_hash=hash_password(password))
            db.add(user)
            db.commit()
        return user.id, user.organization_id


def _ok(resp, code=(200, 201)):
    if resp.status_code not in ((code,) if isinstance(code, int) else code):
        raise RuntimeError(f"{resp.request.method} {resp.request.url} -> {resp.status_code}: {resp.text}")
    return resp.json() if resp.content else None


def _upload(client, pid, kind, path: Path):
    ctype = "text/csv" if path.suffix == ".csv" else \
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    with open(path, "rb") as f:
        prev = _ok(client.post(f"/api/v1/properties/{pid}/imports", data={"kind": kind},
                               files={"file": (path.name, f, ctype)}))
    return _ok(client.post(f"/api/v1/imports/{prev['batch']['id']}/commit",
                           json={"column_map": prev["suggested_map"]}))


def seed(client, data_dir: Path = DATA, email=DEMO_EMAIL, password=DEMO_PASSWORD) -> dict:
    sys.path.insert(0, str(REPO / "demo"))
    import generate  # noqa: PLC0415

    _ok(client.post("/api/v1/auth/login", json={"email": email, "password": password}))
    prop = _ok(client.post("/api/v1/properties", json={
        "name": PROPERTY_NAME, "property_type": "retail",
        "address": "100 Synthetic Rd, San Antonio, TX (fictional)", "total_rsf": "60000",
        "fiscal_year_end_month": 12, "reconciliation_status": "data_collection"}))
    pid = prop["id"]
    period = _ok(client.post(f"/api/v1/properties/{pid}/periods", json={
        "label": "FY2026 YTD Sep", "fiscal_year_start": "2026-01-01",
        "fiscal_year_end": "2026-12-31", "through_date": "2026-09-30"}))
    for code, name, pool, ctrl, var in generate.CATEGORIES:
        _ok(client.post(f"/api/v1/properties/{pid}/categories", json={
            "code": code, "name": name, "pool": pool, "controllable": ctrl, "variable": var}))
    for name, suite, area, start, end in generate.TENANTS:
        _ok(client.post(f"/api/v1/properties/{pid}/tenants", json={
            "name": name, "suite": suite, "rentable_area": area or None,
            "lease_start": start, "lease_end": end}))

    gl = _upload(client, pid, "gl", data_dir / "mesquite_crossing_gl_2026_synthetic.xlsx")
    bills = _upload(client, pid, "billings", data_dir / "mesquite_crossing_billings_2026_synthetic.csv")
    rules = _upload(client, pid, "lease_rules", data_dir / "mesquite_crossing_lease_rules_synthetic.csv")

    for acct, _name, cat, status, why in generate.MAPPINGS:
        _ok(client.put(f"/api/v1/properties/{pid}/mappings/{acct}", json={
            "category_code": cat, "status": status, "explanation": why,
            "source_ref": "Synthetic chart of accounts review"}))
    for r in _ok(client.get(f"/api/v1/properties/{pid}/lease-rules")):
        _ok(client.post(f"/api/v1/lease-rules/{r['id']}/approve",
                        json={"note": "Synthetic demo approval. Terms checked against synthetic abstract."}))

    run = _ok(client.post(f"/api/v1/properties/{pid}/audit-runs", json={"period_id": period["id"]}))
    return {"property_id": pid, "period_id": period["id"], "run": run,
            "imports": {"gl": gl, "billings": bills, "lease_rules": rules}}


def main():
    from fastapi.testclient import TestClient

    from .main import app

    ap = argparse.ArgumentParser()
    ap.add_argument("--reports", action="store_true")
    args = ap.parse_args()
    ensure_demo_user()
    with TestClient(app) as client:
        out = seed(client)
        s = out["run"]["summary"]
        print(f"Seeded {PROPERTY_NAME}. Audit run {out['run']['id']}")
        print(f"  calculated: {s['tenants_calculated']}  unresolved: {s['tenants_unresolved']}  "
              f"exceptions: {s['exception_counts']}")
        if args.reports:
            dest = REPO / "demo" / "output"
            dest.mkdir(exist_ok=True)
            for kind in ["classification", "allocation", "missing-information", "exceptions",
                         "readiness", "package"]:
                r = client.get(f"/api/v1/audit-runs/{out['run']['id']}/reports/{kind}.xlsx")
                (dest / f"mesquite_crossing_{kind}_PROVISIONAL.xlsx").write_bytes(r.content)
            print(f"  reports written to {dest}")
        print(f"Sign in as {DEMO_EMAIL} / {DEMO_PASSWORD}")


if __name__ == "__main__":
    main()
