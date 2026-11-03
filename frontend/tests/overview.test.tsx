import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildActions, nextStep } from "@/components/app/actions";
import { ActionList } from "@/components/app/action-list";
import { groupEvents } from "@/components/app/activity-timeline";
import { MetricStrip } from "@/components/app/metrics";
import type { ActivityEvent, DashboardRow } from "@/lib/api";

const checks = {
  gl_imported: true,
  billings_imported: true,
  accounts_reviewed: false,
  tenants_have_area: false,
  tenants_have_approved_rules: false,
  audit_run: true,
  no_open_errors: false,
};
const row = (over: Partial<DashboardRow> = {}): DashboardRow => ({
  id: "p1",
  name: "Mesquite Crossing",
  property_type: "retail",
  reconciliation_status: "in_review",
  tenants: 8,
  gl_accounts: 10,
  accounts_needing_review: 1,
  tenants_missing_rules: 1,
  tenants_with_draft_rules: 0,
  unapproved_rules: 2,
  tenants_missing_area: 1,
  open_exceptions: { error: 3, warning: 3, info: 2 },
  open_exception_types: [
    { type: "MISSING_LEASE_RULE", severity: "error", count: 1 },
    { type: "MAPPING_NEEDS_REVIEW", severity: "warning", count: 1 },
    { type: "DUPLICATE_GL_CANDIDATE", severity: "warning", count: 2 },
    { type: "VARIANCE_OVER_THRESHOLD", severity: "info", count: 2 },
    { type: "ROUNDING_DIFFERENCE", severity: "info", count: 1 },
  ],
  period: { id: "x", label: "FY2026 YTD Sep", fiscal_year_start: "2026-01-01", fiscal_year_end: "2026-12-31", through_date: "2026-09-30" },
  checks,
  completeness: 43,
  ready: false,
  latest_audit: null,
  ...over,
});

describe("action center", () => {
  it("orders blocking errors first and links each item to its workflow", () => {
    const items = buildActions([row()]);
    expect(items[0]).toMatchObject({
      severity: "error",
      title: "1 tenant without an approved lease rule",
      href: "/properties/p1/exceptions",
    });
    const titles = items.map((i) => i.title);
    expect(titles).toContain("2 possible duplicate invoices");
    expect(titles).toContain("1 GL account needs classification");
    expect(titles).toContain("2 lease rules awaiting approval");
    // The mapping exception is represented once, by the mapping item, not twice.
    expect(titles.filter((t) => String(t).includes("excluded pending review"))).toHaveLength(0);
    // Rounding notes are not action items.
    expect(titles.some((t) => String(t).includes("rounding"))).toBe(false);
    const sev = items.map((i) => i.severity);
    expect(sev.indexOf("info")).toBeGreaterThan(sev.lastIndexOf("warning"));
  });

  it("only names the property when there is more than one", () => {
    expect(buildActions([row()])[0].context).toBeUndefined();
    expect(buildActions([row(), row({ id: "p2", name: "Other" })])[0].context).toBe("Mesquite Crossing");
  });

  it("asks for imports before anything else on an empty property", () => {
    const empty = row({
      open_exception_types: [],
      accounts_needing_review: 0,
      unapproved_rules: 0,
      checks: { ...checks, gl_imported: false, billings_imported: false },
    });
    expect(buildActions([empty]).map((i) => i.title)).toEqual(["General ledger not imported"]);
    expect(nextStep(empty)).toMatchObject({ slug: "import", cta: "Import GL" });
  });

  it("renders rows as links with a call to action", () => {
    render(<ActionList items={buildActions([row()])} />);
    expect(screen.getByRole("link", { name: /1 tenant without an approved lease rule/ })).toHaveAttribute(
      "href",
      "/properties/p1/exceptions",
    );
  });
});

describe("activity grouping", () => {
  const ev = (i: number, over: Partial<ActivityEvent> = {}): ActivityEvent => ({
    kind: "lease_rule",
    at: new Date(Date.UTC(2026, 10, 3, 18, 0, 60 - i)).toISOString(),
    actor: "Demo Reviewer",
    property_id: "p1",
    property: "Mesquite",
    title: `approved lease rule LR-${100 + i}`,
    detail: "checked",
    ref: String(i),
    decision: "approve",
    ...over,
  });

  it("merges consecutive decisions by one person and keeps others separate", () => {
    const g = groupEvents([ev(0), ev(1), ev(2), ev(3, { kind: "audit_run", title: "ran an audit", decision: undefined }), ev(4)]);
    expect(g.map((e) => e.title)).toEqual(["approved 3 lease rules", "ran an audit", "approved lease rule LR-104"]);
    expect(g[0].detail).toBe("LR-102, LR-101, LR-100");
  });

  it("strips the empty-category prefix from mapping notes", () => {
    const g = groupEvents([
      ev(0, { kind: "expense_mapping", title: "classified GL 7100", detail: "-: Leasing costs excluded", decision: "nonrecoverable" }),
    ]);
    expect(g[0].detail).toBe("Leasing costs excluded");
  });
});

describe("MetricStrip", () => {
  it("renders every metric with its label and links when given", () => {
    render(
      <MetricStrip
        metrics={[
          { label: "Open exceptions", value: 6, hint: "3 blocking", tone: "error", href: "/x" },
          { label: "Unmapped GL accounts", value: 1 },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /Open exceptions\s*6\s*3 blocking/ })).toHaveAttribute("href", "/x");
    expect(screen.getByText("Unmapped GL accounts")).toBeInTheDocument();
  });
});
