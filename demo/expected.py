"""Independent expected results for the synthetic Mesquite Crossing dataset.

This file does NOT import the Veyra engine. It recomputes the provisional figures with
exact Fraction arithmetic and writes expected_results.xlsx, where each figure is a live
Excel formula built from the raw inputs so a reviewer can check it by hand.

ALL DATA IS SYNTHETIC.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction as F
from pathlib import Path

YTD, YEAR = 273, 365  # 2026-01-01..2026-09-30 and FY2026
GLA = 60000

CAM = {
    "LANDSCAPE": F("2400") * 9 + F("2400"),  # includes the planted duplicate
    "JANITORIAL": F("1850") * 9,  # October entry is outside the period
    "PARKING_LOT": F("950") * 9 + F("7800"),
    "UTILITIES_COMMON": F("1320.50") * 9,
    "SECURITY": F("1100") * 9,
}
CONTROLLABLE = {"LANDSCAPE", "JANITORIAL", "PARKING_LOT", "SECURITY"}
VARIABLE = {"JANITORIAL", "UTILITIES_COMMON"}
TAX = F("9750") * 9
INS = F("3412.33") * 9
CAM_TOTAL = sum(CAM.values())


def c(x: F) -> Decimal:
    return (Decimal(x.numerator) / Decimal(x.denominator)).quantize(Decimal("0.01"), ROUND_HALF_UP)


def expected() -> dict[str, dict]:
    out = {}

    def std(area, occ=F(1)):
        s = F(area, GLA)
        return {"TAX": (c(TAX * s * occ), f"=ROUND({float(TAX)}*{area}/{GLA}*{occ.numerator}/{occ.denominator},2)"),
                "INS": (c(INS * s * occ), f"=ROUND({float(INS)}*{area}/{GLA}*{occ.numerator}/{occ.denominator},2)")}

    # Lone Star Grocery: CAM fixed 30%, TAX/INS pro-rata 24,000 / 60,000.
    lines = {"CAM": (c(CAM_TOTAL * F("0.30")), f"=ROUND({float(CAM_TOTAL)}*0.30,2)"), **std(24000)}
    out["Lone Star Grocery Co."] = {"lines": lines, "admin_fee": (Decimal("0.00"), "0")}

    # Alamo Cellular: CAM base year 70,000 prorated to YTD, floored at zero.
    net = max(F(0), CAM_TOTAL - F(70000) * F(YTD, YEAR))
    lines = {"CAM": (c(net * F(2400, GLA)),
                     f"=ROUND(MAX(0,{float(CAM_TOTAL)}-70000*{YTD}/{YEAR})*2400/{GLA},2)"),
             **std(2400)}
    out["Alamo Cellular"] = {"lines": lines, "admin_fee": (Decimal("0.00"), "0")}

    # Guadalupe Tax Services: non-cumulative 5% cap on controllables, then 10% admin fee after cap.
    s = F(3000, GLA)
    ctrl = sum(v for k, v in CAM.items() if k in CONTROLLABLE)
    limit = F(3600) * F("1.05") * F(YTD, YEAR)
    reduction = max(F(0), ctrl * s - limit)
    cam_line = CAM_TOTAL * s - reduction
    lines = {"CAM": (c(cam_line), f"=ROUND({float(CAM_TOTAL)}*3000/{GLA}-MAX(0,{float(ctrl)}*3000/{GLA}-3600*1.05*{YTD}/{YEAR}),2)"),
             **std(3000)}
    out["Guadalupe Tax Services"] = {
        "lines": lines,
        "admin_fee": (c(cam_line * F("0.10")),
                      f"=ROUND(0.10*({float(CAM_TOTAL)}*3000/{GLA}-MAX(0,{float(ctrl)}*3000/{GLA}-3600*1.05*{YTD}/{YEAR})),2)")}

    # Brazos Coffee Roasters: lease starts 2026-06-01. Occupied 122 of 273 days.
    occ = F(122, YTD)
    lines = {"CAM": (c(CAM_TOTAL * F(1500, GLA) * occ), f"=ROUND({float(CAM_TOTAL)}*1500/{GLA}*122/{YTD},2)"),
             **std(1500, occ)}
    out["Brazos Coffee Roasters"] = {"lines": lines, "admin_fee": (Decimal("0.00"), "0")}

    # Rio Grande Pizza: SECURITY excluded; variable categories grossed up 0.95 / 0.88; 15% admin fee.
    pool = sum((v * (F("0.95") / F("0.88")) if k in VARIABLE else v)
               for k, v in CAM.items() if k != "SECURITY")
    cam_line = pool * F(2100, GLA)
    pool_formula = (f"({float(CAM['LANDSCAPE'])}+{float(CAM['PARKING_LOT'])}"
                    f"+({float(CAM['JANITORIAL'])}+{float(CAM['UTILITIES_COMMON'])})*0.95/0.88)")
    lines = {"CAM": (c(cam_line), f"=ROUND({pool_formula}*2100/{GLA},2)"), **std(2100)}
    out["Rio Grande Pizza"] = {"lines": lines,
                               "admin_fee": (c(cam_line * F("0.15")),
                                             f"=ROUND(0.15*{pool_formula}*2100/{GLA},2)")}

    for v in out.values():
        v["total"] = sum((x[0] for x in v["lines"].values()), Decimal("0")) + v["admin_fee"][0]
    return out


UNRESOLVED = {
    "Bluebonnet Nail Spa": "UNSUPPORTED_RULE (CPI cap)",
    "Hill Country Yoga": "MISSING_TENANT_AREA",
    "Pecan Street Dental": "MISSING_LEASE_RULE",
}


def write_workbook(path: Path):
    from openpyxl import Workbook
    from openpyxl.styles import Font

    exp = expected()
    wb = Workbook()
    ws = wb.active
    ws.title = "Expected results"
    ws["A1"] = "SYNTHETIC DATA. Independent expected provisional YTD results for Mesquite Crossing."
    ws["A1"].font = Font(bold=True)
    ws["A2"] = "Period 2026-01-01 to 2026-09-30 (273 of 365 days). Formulas use raw inputs."
    ws.append([])
    ws.append(["Tenant", "Pool / item", "Expected value", "Excel formula (recomputes the value)"])
    for tenant, v in exp.items():
        for pool, (val, formula) in v["lines"].items():
            ws.append([tenant, pool, float(val), formula])
        ws.append([tenant, "ADMIN_FEE", float(v["admin_fee"][0]), v["admin_fee"][1]])
        ws.append([tenant, "TOTAL", float(v["total"]), ""])
    for tenant, why in UNRESOLVED.items():
        ws.append([tenant, "UNRESOLVED", None, why])
    for col, w in zip("ABCD", (28, 14, 16, 110)):
        ws.column_dimensions[col].width = w
    wb.save(path)


if __name__ == "__main__":
    for t, v in expected().items():
        print(t, {k: str(x[0]) for k, x in v["lines"].items()}, "fee", v["admin_fee"][0], "total", v["total"])
    out = Path(__file__).resolve().parent / "data" / "expected_results.xlsx"
    out.parent.mkdir(exist_ok=True)
    write_workbook(out)
    print("Wrote", out)
