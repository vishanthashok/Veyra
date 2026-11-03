"""Stage 5 to 6: per-tenant allocation, lease adjustments and admin fees.

Order per tenant pool: share, exclusions, gross-up, base year, share x occupancy, cap, round.
Admin fee is applied once per tenant after all pool lines.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from .money import cents, fmt
from .types import (
    AdminFeeOrder,
    AuditException,
    AuditInput,
    CapKind,
    Category,
    Method,
    PoolLine,
    PoolRule,
    PoolSummary,
    Severity,
    Tenant,
    TenantResult,
    TraceStep,
)
from .types import ExceptionType as ET

ZERO = Decimal("0")
ONE = Decimal("1")


def occupied_days(t: Tenant, start: date, end: date) -> int:
    assert t.lease_start is not None
    s = max(start, t.lease_start)
    e = min(end, t.lease_end) if t.lease_end else end
    return max(0, (e - s).days + 1)


def _unresolved(
    r: TenantResult, exceptions: list[AuditException], etype: ET, msg: str, pool: str | None = None
) -> None:
    r.status = "unresolved"
    r.total = None
    if msg in r.unresolved_reasons:  # same problem in several pools: report once
        return
    r.unresolved_reasons.append(msg)
    exceptions.append(AuditException(etype, Severity.ERROR, msg, tenant_id=r.tenant_id, pool=pool))


def calc_tenant(
    tenant: Tenant,
    inp: AuditInput,
    pools: dict[str, PoolSummary],
    categories: dict[str, Category],
    year_fraction: Decimal,
    exceptions: list[AuditException],
    pool_shares: dict[str, Decimal],
    pool_unrounded: dict[str, Decimal],
) -> TenantResult:
    p = inp.period
    r = TenantResult(tenant.id, tenant.name, "calculated")
    rule = tenant.rule
    if rule is None:
        _unresolved(r, exceptions, ET.MISSING_LEASE_RULE, f"{tenant.name} has no approved lease rule.")
        return r
    if rule.unsupported_terms:
        _unresolved(
            r,
            exceptions,
            ET.UNSUPPORTED_RULE,
            f"{tenant.name} lease has terms the engine cannot compute: "
            + "; ".join(rule.unsupported_terms)
            + ". Manual review required.",
        )
        return r
    if tenant.lease_start is None:
        _unresolved(r, exceptions, ET.MISSING_RULE_TERM, f"{tenant.name} has no lease start date.")
        return r

    days = occupied_days(tenant, p.fiscal_year_start, p.through_date)
    occ = Decimal(days) / Decimal(p.ytd_days)
    r.trace.append(
        TraceStep(
            "Occupancy factor",
            "occupied_days / ytd_days",
            fmt(occ),
            {
                "occupied_days": str(days),
                "ytd_days": str(p.ytd_days),
                "lease_start": str(tenant.lease_start),
                "lease_end": str(tenant.lease_end),
            },
        )
    )

    pending: list[tuple[PoolRule, PoolLine, Decimal]] = []
    for pr in rule.pools:
        res = _calc_pool_line(tenant, pr, pools, categories, year_fraction, occ, r, exceptions)
        if res is None:
            continue
        pending.append((pr, *res))
    if r.status == "unresolved":
        r.lines = []
        return r

    # Admin fee, applied once per tenant on the listed pools.
    fee = ZERO
    if rule.admin_fee:
        af = rule.admin_fee
        tenant_pools = {pr.pool for pr in rule.pools}
        if not af.pools or not af.pools <= tenant_pools:
            missing = sorted(af.pools - tenant_pools) if af.pools else []
            _unresolved(
                r,
                exceptions,
                ET.MISSING_RULE_TERM,
                f"{tenant.name} admin fee applies to "
                + (f"pools the tenant does not pay into ({', '.join(missing)})" if missing else "no pools")
                + ". Correct the lease rule.",
            )
            r.lines = []
            return r
        fee_lines = [(pr, line) for pr, line, _ in pending if pr.pool in af.pools]
        has_cap = any(pr.cap is not None for pr, _ in fee_lines)
        if has_cap and af.order is None:
            _unresolved(
                r,
                exceptions,
                ET.MISSING_RULE_TERM,
                f"{tenant.name} has an admin fee and a cap but the lease rule does not "
                "state whether the fee applies before or after the cap.",
            )
            r.lines = []
            return r
        if af.order == AdminFeeOrder.BEFORE_CAP:
            base = sum((ln.amount_unrounded + ln.cap_reduction for _, ln in fee_lines), ZERO)
        else:
            base = sum((ln.amount_unrounded for _, ln in fee_lines), ZERO)
        fee = cents(base * af.pct)
        r.trace.append(
            TraceStep(
                "Admin fee",
                "round(fee_base * admin_pct)",
                fmt(fee),
                {
                    "fee_base": fmt(base),
                    "admin_pct": fmt(af.pct),
                    "pools": ",".join(sorted(af.pools)),
                    "order": af.order.value if af.order else "n/a (no cap)",
                },
            )
        )

    for pr, line, share in pending:
        r.lines.append(line)
        pool_shares[pr.pool] += share
        pool_unrounded[pr.pool] += line.amount_unrounded
    r.admin_fee = fee
    r.total = sum((ln.amount for ln in r.lines), ZERO) + fee
    r.trace.append(
        TraceStep(
            "Provisional YTD total",
            "sum(rounded pool lines) + admin_fee",
            fmt(r.total),
            {**{f"line_{ln.pool}": fmt(ln.amount) for ln in r.lines}, "admin_fee": fmt(fee)},
        )
    )
    return r


def _calc_pool_line(
    tenant: Tenant,
    pr: PoolRule,
    pools: dict[str, PoolSummary],
    categories: dict[str, Category],
    year_fraction: Decimal,
    occ: Decimal,
    r: TenantResult,
    exceptions: list[AuditException],
) -> tuple[PoolLine, Decimal] | None:
    pool = pr.pool
    tag = f"[{pool}]"
    # Share.
    if pr.method == Method.PRO_RATA:
        if tenant.rentable_area is None:
            _unresolved(
                r,
                exceptions,
                ET.MISSING_TENANT_AREA,
                f"{tenant.name} has no rentable area. Pro-rata pools cannot be allocated.",
            )
            return None
        if pr.denominator_sqft is None or pr.denominator_sqft <= ZERO:
            _unresolved(
                r,
                exceptions,
                ET.MISSING_DENOMINATOR,
                f"{tenant.name} pool {pool} has no lease-defined denominator.",
                pool,
            )
            return None
        share = tenant.rentable_area / pr.denominator_sqft
        share_formula = "rentable_area / denominator_sqft"
        share_inputs = {"rentable_area": fmt(tenant.rentable_area), "denominator_sqft": fmt(pr.denominator_sqft)}
    elif pr.method == Method.FIXED_PCT:
        if pr.fixed_pct is None:
            _unresolved(
                r,
                exceptions,
                ET.MISSING_RULE_TERM,
                f"{tenant.name} pool {pool} is fixed percentage but has no percentage.",
                pool,
            )
            return None
        share = pr.fixed_pct
        share_formula = "fixed_pct"
        share_inputs = {"fixed_pct": fmt(pr.fixed_pct)}
    else:
        _unresolved(
            r, exceptions, ET.UNSUPPORTED_RULE, f"{tenant.name} pool {pool} uses unsupported method {pr.method}.", pool
        )
        return None
    if share > ONE:
        _unresolved(
            r, exceptions, ET.SHARES_EXCEED_100, f"{tenant.name} share in pool {pool} is {share}, above 100%.", pool
        )
        return None
    r.trace.append(TraceStep(f"{tag} Share", share_formula, fmt(share), share_inputs))

    if pr.base_year_amount is not None and pr.cap is not None:
        _unresolved(
            r,
            exceptions,
            ET.UNSUPPORTED_RULE,
            f"{tenant.name} pool {pool} combines a base year and a cap. "
            "Interaction is lease-specific. Manual review required.",
            pool,
        )
        return None
    if pr.cap is not None and pr.cap.kind != CapKind.NONCUMULATIVE:
        _unresolved(
            r,
            exceptions,
            ET.UNSUPPORTED_RULE,
            f"{tenant.name} pool {pool} has a {pr.cap.kind.value} cap. Only non-cumulative caps are supported.",
            pool,
        )
        return None

    # Pool dollars this tenant participates in.
    ps = pools.get(pool)
    by_cat = dict(ps.by_category) if ps else {}
    for c in pr.excluded_categories:
        if c in by_cat:
            r.trace.append(TraceStep(f"{tag} Exclude {c}", "lease exclusion", fmt(-by_cat[c]), {"category": c}))
            del by_cat[c]

    if pr.gross_up is not None:
        g = pr.gross_up
        if g.target_occupancy is None or g.actual_occupancy is None or g.actual_occupancy <= ZERO:
            _unresolved(
                r,
                exceptions,
                ET.MISSING_RULE_TERM,
                f"{tenant.name} pool {pool} has a gross-up without both target and actual occupancy.",
                pool,
            )
            return None
        if g.actual_occupancy < g.target_occupancy:
            factor = g.target_occupancy / g.actual_occupancy
            for c, amt in list(by_cat.items()):
                if categories[c].variable:
                    by_cat[c] = amt * factor
                    r.trace.append(
                        TraceStep(
                            f"{tag} Gross-up {c}",
                            "amount * target_occupancy / actual_occupancy",
                            fmt(by_cat[c]),
                            {
                                "amount": fmt(amt),
                                "target_occupancy": fmt(g.target_occupancy),
                                "actual_occupancy": fmt(g.actual_occupancy),
                            },
                        )
                    )

    pool_amt = sum(by_cat.values(), ZERO)
    ctrl_amt = sum((a for c, a in by_cat.items() if categories[c].controllable), ZERO)
    r.trace.append(
        TraceStep(
            f"{tag} Tenant pool amount",
            "sum(recoverable categories)",
            fmt(pool_amt),
            {c: fmt(a) for c, a in sorted(by_cat.items())},
        )
    )

    net = pool_amt
    if pr.base_year_amount is not None:
        base_ytd = pr.base_year_amount * year_fraction
        net = max(ZERO, pool_amt - base_ytd)
        r.trace.append(
            TraceStep(
                f"{tag} Base year",
                "max(0, pool_amount - base_year_amount * ytd_days / year_days)",
                fmt(net),
                {
                    "pool_amount": fmt(pool_amt),
                    "base_year_amount": fmt(pr.base_year_amount),
                    "year_fraction": fmt(year_fraction),
                    "note": "Base year prorated to YTD for provisional audit.",
                },
            )
        )

    amount = net * share * occ
    controllable_share = ctrl_amt * share * occ
    r.trace.append(
        TraceStep(
            f"{tag} Tenant share",
            "net_pool * share * occupancy_factor",
            fmt(amount),
            {"net_pool": fmt(net), "share": fmt(share), "occupancy_factor": fmt(occ)},
        )
    )

    reduction = ZERO
    if pr.cap is not None:
        cap = pr.cap
        if cap.pct is None or cap.prior_year_controllable is None:
            _unresolved(
                r,
                exceptions,
                ET.MISSING_RULE_TERM,
                f"{tenant.name} pool {pool} has a cap without a cap percentage or prior-year controllable amount.",
                pool,
            )
            return None
        limit = cap.prior_year_controllable * (ONE + cap.pct) * year_fraction
        reduction = max(ZERO, controllable_share - limit)
        amount -= reduction
        r.trace.append(
            TraceStep(
                f"{tag} Controllable cap",
                "reduction = max(0, controllable_share - prior_year * (1 + cap_pct) * year_fraction)",
                fmt(reduction),
                {
                    "controllable_share": fmt(controllable_share),
                    "prior_year_controllable": fmt(cap.prior_year_controllable),
                    "cap_pct": fmt(cap.pct),
                    "year_fraction": fmt(year_fraction),
                    "note": "Annual cap prorated to YTD for provisional audit.",
                },
            )
        )

    line = PoolLine(pool, pool_amt, share, amount, cents(amount), controllable_share, reduction)
    r.trace.append(
        TraceStep(f"{tag} Rounded line", "round_half_up(amount, 0.01)", fmt(line.amount), {"amount": fmt(amount)})
    )
    return line, share
