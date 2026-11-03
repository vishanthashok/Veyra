"""Measure engine, snapshot and report cost at portfolio scale. Synthetic data only.

uv run python scripts/bench.py            # engine only
VEYRA_DATABASE_URL=... uv run python scripts/bench.py --api   # also import + run + report via the API
"""

import argparse
import io
import random
import time
from datetime import date, timedelta
from decimal import Decimal

from veyra_engine import run_audit
from veyra_engine.types import (
    AdminFee,
    AuditInput,
    Billing,
    Category,
    LeaseRule,
    Mapping,
    Method,
    Period,
    PoolRule,
    Recoverability,
    Tenant,
    Transaction,
)

ACCOUNTS = [(f"6{i:03d}", f"CAT{i % 12}") for i in range(60)]


def synthetic(n_txn: int, n_tenants: int, seed: int = 7) -> AuditInput:
    rnd = random.Random(seed)
    cats = tuple(
        Category(f"CAT{i}", ["CAM", "TAX", "INS"][i % 3], controllable=i % 2 == 0, variable=i % 4 == 0)
        for i in range(12)
    )
    maps = tuple(Mapping(a, c, Recoverability.RECOVERABLE) for a, c in ACCOUNTS)
    start = date(2026, 1, 1)
    txns = tuple(
        Transaction(
            str(i),
            rnd.choice(ACCOUNTS)[0],
            start + timedelta(days=rnd.randrange(273)),
            Decimal(rnd.randrange(-5000, 500000)) / 100,
            f"inv {i}",
        )
        for i in range(n_txn)
    )
    fee = AdminFee(Decimal("0.10"), frozenset({"CAM"}))
    tenants = tuple(
        Tenant(
            f"T{i}",
            f"Tenant {i}",
            Decimal(rnd.randrange(800, 4000)),
            date(2020, 1, 1),
            None,
            LeaseRule(
                f"LR{i}", tuple(PoolRule(p, Method.PRO_RATA, Decimal("400000")) for p in ("CAM", "TAX", "INS")), fee
            ),
        )
        for i in range(n_tenants)
    )
    bills = tuple(Billing(f"T{i}", date(2026, m, 1), Decimal("1000")) for i in range(n_tenants) for m in range(1, 10))
    return AuditInput(Period(date(2026, 1, 1), date(2026, 12, 31), date(2026, 9, 30)), txns, cats, maps, tenants, bills)


def timed(label, fn):
    t = time.perf_counter()
    out = fn()
    print(f"{label:<44} {1000 * (time.perf_counter() - t):9.1f} ms")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", action="store_true")
    args = ap.parse_args()
    for n, t in [(1_000, 15), (10_000, 50), (50_000, 150)]:
        inp = timed(f"build input {n} txns / {t} tenants", lambda n=n, t=t: synthetic(n, t))
        timed(f"run_audit {n} txns / {t} tenants (invariants on)", lambda inp=inp: run_audit(inp))
        timed(
            f"run_audit {n} txns / {t} tenants (invariants off)", lambda inp=inp: run_audit(inp, check_invariants=False)
        )
    if args.api:
        api_bench()


def api_bench():
    from fastapi.testclient import TestClient

    from app.demo_seed import ensure_demo_user
    from app.main import app

    email = f"bench-{int(time.time())}@test.local"
    ensure_demo_user(email=email, password="bench-pass-1", org_name="Bench Org (Synthetic)")
    rnd = random.Random(3)
    with TestClient(app) as c:
        c.post("/api/v1/auth/login", json={"email": email, "password": "bench-pass-1"})
        pid = c.post("/api/v1/properties", json={"name": "Bench (Synthetic)"}).json()["id"]
        per = c.post(
            f"/api/v1/properties/{pid}/periods",
            json={
                "label": "FY26",
                "fiscal_year_start": "2026-01-01",
                "fiscal_year_end": "2026-12-31",
                "through_date": "2026-09-30",
            },
        ).json()["id"]
        for i in range(12):
            c.post(
                f"/api/v1/properties/{pid}/categories",
                json={"code": f"CAT{i}", "name": f"Cat {i}", "pool": ["CAM", "TAX", "INS"][i % 3]},
            )
        rows = ["Account,Date,Amount,Memo"] + [
            f"{rnd.choice(ACCOUNTS)[0]},2026-{rnd.randrange(1, 10):02d}-{rnd.randrange(1, 28):02d},{rnd.randrange(100, 900000) / 100:.2f},inv {i}"
            for i in range(20_000)
        ]
        data = "\n".join(rows).encode()
        prev = timed(
            "upload + parse 20,000-row GL CSV",
            lambda: c.post(
                f"/api/v1/properties/{pid}/imports",
                data={"kind": "gl"},
                files={"file": ("gl.csv", io.BytesIO(data), "text/csv")},
            ).json(),
        )
        timed(
            "validate (dry run) 20,000 rows",
            lambda: c.post(
                f"/api/v1/imports/{prev['batch']['id']}/validate", json={"column_map": prev["suggested_map"]}
            ),
        )
        timed(
            "commit 20,000 rows",
            lambda: c.post(f"/api/v1/imports/{prev['batch']['id']}/commit", json={"column_map": prev["suggested_map"]}),
        )
        timed(
            "bulk map 60 accounts",
            lambda: c.post(
                f"/api/v1/properties/{pid}/mappings/bulk",
                json={
                    "gl_accounts": [a for a, _ in ACCOUNTS],
                    "status": "recoverable",
                    "category_code": "CAT0",
                    "explanation": "bench",
                },
            ),
        )
        for i in range(100):
            r = c.post(
                f"/api/v1/properties/{pid}/lease-rules",
                json={"ref": f"LR{i}", "pools": [{"pool": "CAM", "method": "pro_rata", "denominator_sqft": "400000"}]},
            ).json()
            c.post(f"/api/v1/lease-rules/{r['id']}/approve", json={"note": "bench rule"})
            c.post(
                f"/api/v1/properties/{pid}/tenants",
                json={
                    "name": f"Tenant {i}",
                    "suite": str(i),
                    "rentable_area": "2000",
                    "lease_start": "2020-01-01",
                    "lease_rule_id": r["id"],
                },
            )
        run = timed(
            "audit run (snapshot + engine + persist), 100 tenants",
            lambda: c.post(f"/api/v1/properties/{pid}/audit-runs", json={"period_id": per}).json(),
        )
        timed("GET audit run with results", lambda: c.get(f"/api/v1/audit-runs/{run['id']}"))
        timed("GET gl-transactions page 1 (100 rows)", lambda: c.get(f"/api/v1/properties/{pid}/gl-transactions"))
        timed("GET dashboard", lambda: c.get("/api/v1/dashboard"))
        timed("verify run (re-execute snapshot)", lambda: c.post(f"/api/v1/audit-runs/{run['id']}/verify"))
        timed("report: full package xlsx", lambda: c.get(f"/api/v1/audit-runs/{run['id']}/reports/package.xlsx"))


if __name__ == "__main__":
    main()
