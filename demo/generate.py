"""Generate the synthetic Mesquite Crossing dataset.

ALL DATA IS SYNTHETIC. Company names are fictional. Run from the repo root:
    cd backend && uv run python ../demo/generate.py
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from openpyxl import Workbook

OUT = Path(__file__).resolve().parent / "data"
MONTHS = range(1, 10)  # Jan to Sep 2026

TENANTS = [
    # name, suite, area, lease_start, lease_end
    ("Lone Star Grocery Co.", "100", "24000", "2015-01-01", "2035-12-31"),
    ("Alamo Cellular", "110", "2400", "2019-03-01", "2029-02-28"),
    ("Bluebonnet Nail Spa", "120", "1800", "2021-05-01", "2031-04-30"),
    ("Guadalupe Tax Services", "130", "3000", "2018-01-01", "2028-12-31"),
    ("Hill Country Yoga", "140", "", "2022-08-01", "2027-07-31"),  # PLANTED: missing area
    ("Brazos Coffee Roasters", "150", "1500", "2026-06-01", "2031-05-31"),  # partial year
    ("Pecan Street Dental", "160", "2200", "2020-01-01", "2030-12-31"),  # PLANTED: no rule
    ("Rio Grande Pizza", "170", "2100", "2017-09-01", "2027-08-31"),
]

CATEGORIES = [
    # code, name, pool, controllable, variable
    ("LANDSCAPE", "Landscaping", "CAM", True, False),
    ("JANITORIAL", "Janitorial and porter", "CAM", True, True),
    ("PARKING_LOT", "Parking lot sweeping and repair", "CAM", True, False),
    ("UTILITIES_COMMON", "Common area utilities", "CAM", False, True),
    ("SECURITY", "Security patrol", "CAM", True, False),
    ("RE_TAX", "Real estate taxes", "TAX", False, False),
    ("INSURANCE", "Property insurance", "INS", False, False),
]

# gl_account, account_name, category or None, status, explanation
MAPPINGS = [
    ("6100", "Landscaping", "LANDSCAPE", "recoverable", "Common area landscaping. Lease s.6.1(a)."),
    ("6110", "Janitorial", "JANITORIAL", "recoverable", "Common area janitorial. Lease s.6.1(b)."),
    ("6120", "Parking Lot", "PARKING_LOT", "recoverable", "Sweeping and routine repair. Lease s.6.1(c)."),
    ("6130", "Common Utilities", "UTILITIES_COMMON", "recoverable", "Site lighting and irrigation meters."),
    ("6140", "Security", "SECURITY", "recoverable", "Night patrol contract."),
    ("6500", "Property Taxes", "RE_TAX", "recoverable", "Bexar County ad valorem accrual."),
    ("6600", "Insurance", "INSURANCE", "recoverable", "Property and liability premium accrual."),
    ("6900", "Roof Replacement", "LANDSCAPE", "nonrecoverable", "Capital expenditure. Excluded under s.6.3(d)."),
    ("7100", "Leasing Commissions", None, "nonrecoverable", "Leasing costs excluded under s.6.3(f)."),
    # 6150 Holiday Decorations is PLANTED as unreviewed: no mapping decision in the seed.
]


def gl_rows():
    rows = []

    def add(acct, name, d, amt, vendor, desc):
        rows.append([acct, name, d.isoformat(), amt, vendor, desc])

    for m in MONTHS:
        d = date(2026, m, 5)
        add("6100", "Landscaping", d, "2400.00", "Cedar Ridge Grounds LLC", f"Monthly grounds {m:02d}/2026")
        add("6110", "Janitorial", d, "1850.00", "Sun City Porter Services", f"Porter service {m:02d}/2026")
        add("6120", "Parking Lot", d, "950.00", "Caliche Sweepers", f"Lot sweeping {m:02d}/2026")
        add("6130", "Common Utilities", date(2026, m, 20), "1320.50", "Synthetic Power & Water", f"Common meters {m:02d}/2026")
        add("6140", "Security", d, "1100.00", "Night Owl Patrol", f"Patrol {m:02d}/2026")
        add("6500", "Property Taxes", date(2026, m, 28), "9750.00", "Accrual", f"Tax accrual {m:02d}/2026")
        add("6600", "Insurance", date(2026, m, 28), "3412.33", "Accrual", f"Insurance accrual {m:02d}/2026")
    # PLANTED: duplicate March landscaping invoice.
    add("6100", "Landscaping", date(2026, 3, 5), "2400.00", "Cedar Ridge Grounds LLC", "Monthly grounds 03/2026")
    add("6120", "Parking Lot", date(2026, 6, 14), "7800.00", "Caliche Sweepers", "Pothole and restripe")
    # PLANTED: capital item, nonrecoverable.
    add("6900", "Roof Replacement", date(2026, 4, 18), "46500.00", "Hill Country Roofing", "Building B roof replacement")
    add("7100", "Leasing Commissions", date(2026, 5, 2), "12000.00", "Synthetic Realty Partners", "Suite 150 commission")
    # PLANTED: account with no mapping decision.
    add("6150", "Holiday Decorations", date(2026, 1, 9), "1875.00", "Festive Displays Inc", "Holiday decor removal")
    # PLANTED: transaction after the through date (2026-09-30).
    add("6110", "Janitorial", date(2026, 10, 4), "1850.00", "Sun City Porter Services", "Porter service 10/2026")
    return rows


ESTIMATES = {  # monthly estimate billed per tenant (CAM, tax and insurance combined)
    "Lone Star Grocery Co.": "7750.00",
    "Alamo Cellular": "650.00",
    "Bluebonnet Nail Spa": "600.00",
    "Guadalupe Tax Services": "1075.00",
    "Hill Country Yoga": "450.00",
    "Brazos Coffee Roasters": "550.00",
    "Pecan Street Dental": "640.00",
    "Rio Grande Pizza": "700.00",
}

RULE_HEADERS = ["rule_ref", "tenant", "pool", "method", "denominator_sqft", "fixed_pct",
                "excluded_categories", "base_year_amount", "gross_up_target", "gross_up_actual",
                "cap_kind", "cap_pct", "cap_prior_year", "admin_fee_pct", "admin_fee_pools",
                "admin_fee_order", "unsupported_terms", "source_ref"]


def r(ref, tenant, pool, method, **kw):
    row = dict.fromkeys(RULE_HEADERS, "")
    row.update(rule_ref=ref, tenant=tenant, pool=pool, method=method, **kw)
    return [row[h] for h in RULE_HEADERS]


def rule_rows():
    gla = "60000"
    rows = []
    t = "Lone Star Grocery Co."
    rows += [r("LR-100", t, "CAM", "fixed_pct", fixed_pct="0.30", source_ref="Lease s.6.2 (synthetic)"),
             r("LR-100", t, "TAX", "pro_rata", denominator_sqft=gla),
             r("LR-100", t, "INS", "pro_rata", denominator_sqft=gla)]
    t = "Alamo Cellular"
    rows += [r("LR-110", t, "CAM", "pro_rata", denominator_sqft=gla, base_year_amount="70000.00",
               source_ref="Lease s.5.4 base year 2019 (synthetic)"),
             r("LR-110", t, "TAX", "pro_rata", denominator_sqft=gla),
             r("LR-110", t, "INS", "pro_rata", denominator_sqft=gla)]
    t = "Bluebonnet Nail Spa"  # PLANTED: CPI cap is unsupported in v0.1
    rows += [r("LR-120", t, "CAM", "pro_rata", denominator_sqft=gla, cap_kind="cpi", cap_pct="0.04",
               cap_prior_year="2100.00", source_ref="Lease s.6.5 CPI cap (synthetic)"),
             r("LR-120", t, "TAX", "pro_rata", denominator_sqft=gla),
             r("LR-120", t, "INS", "pro_rata", denominator_sqft=gla)]
    t = "Guadalupe Tax Services"
    rows += [r("LR-130", t, "CAM", "pro_rata", denominator_sqft=gla, cap_kind="noncumulative",
               cap_pct="0.05", cap_prior_year="3600.00", admin_fee_pct="0.10", admin_fee_pools="CAM",
               admin_fee_order="after_cap", source_ref="Lease s.6.4 and s.6.6 (synthetic)"),
             r("LR-130", t, "TAX", "pro_rata", denominator_sqft=gla),
             r("LR-130", t, "INS", "pro_rata", denominator_sqft=gla)]
    t = "Hill Country Yoga"
    rows += [r("LR-140", t, "CAM", "pro_rata", denominator_sqft=gla),
             r("LR-140", t, "TAX", "pro_rata", denominator_sqft=gla),
             r("LR-140", t, "INS", "pro_rata", denominator_sqft=gla)]
    t = "Brazos Coffee Roasters"
    rows += [r("LR-150", t, "CAM", "pro_rata", denominator_sqft=gla),
             r("LR-150", t, "TAX", "pro_rata", denominator_sqft=gla),
             r("LR-150", t, "INS", "pro_rata", denominator_sqft=gla)]
    t = "Rio Grande Pizza"
    rows += [r("LR-170", t, "CAM", "pro_rata", denominator_sqft=gla, excluded_categories="SECURITY",
               gross_up_target="0.95", gross_up_actual="0.88", admin_fee_pct="0.15",
               admin_fee_pools="CAM", source_ref="Lease s.6.1, s.6.7 gross-up (synthetic)"),
             r("LR-170", t, "TAX", "pro_rata", denominator_sqft=gla),
             r("LR-170", t, "INS", "pro_rata", denominator_sqft=gla)]
    return rows


def main():
    OUT.mkdir(exist_ok=True)
    wb = Workbook()
    ws = wb.active
    ws.title = "GL Detail"
    ws.append(["Account", "Account Name", "Date", "Amount", "Vendor", "Memo/Description"])
    for row in gl_rows():
        acct, name, d, amt, vendor, desc = row
        ws.append([acct, name, date.fromisoformat(d), float(amt), vendor, desc])
    wb.save(OUT / "mesquite_crossing_gl_2026_synthetic.xlsx")

    with open(OUT / "mesquite_crossing_billings_2026_synthetic.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Tenant", "Bill Date", "Amount", "Description"])
        for name, *_ in TENANTS:
            start = 6 if name == "Brazos Coffee Roasters" else 1
            for m in range(start, 10):
                w.writerow([name, f"{m:02d}/01/2026", ESTIMATES[name], f"CAM estimate {m:02d}/2026"])

    with open(OUT / "mesquite_crossing_lease_rules_synthetic.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(RULE_HEADERS)
        w.writerows(rule_rows())
    print(f"Wrote synthetic dataset to {OUT}")


if __name__ == "__main__":
    main()
