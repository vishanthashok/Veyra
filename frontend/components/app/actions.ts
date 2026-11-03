import type { DashboardRow } from "@/lib/api";
import type { ActionItem } from "./action-list";

export const CHECKS: { key: string; label: string; slug: string; cta: string }[] = [
  { key: "gl_imported", label: "General ledger imported", slug: "import", cta: "Import GL" },
  { key: "billings_imported", label: "Tenant billings imported", slug: "import", cta: "Import billings" },
  { key: "accounts_reviewed", label: "Every GL account classified", slug: "mapping", cta: "Map accounts" },
  { key: "tenants_have_area", label: "Every tenant has rentable area", slug: "tenants", cta: "Fix tenants" },
  { key: "tenants_have_approved_rules", label: "Every tenant has an approved lease rule", slug: "rules", cta: "Approve rules" },
  { key: "audit_run", label: "Audit run on current data", slug: "audit", cta: "Run audit" },
  { key: "no_open_errors", label: "No open blocking errors", slug: "exceptions", cta: "Review exceptions" },
];

export function nextStep(r: DashboardRow) {
  return CHECKS.find((c) => !r.checks[c.key]) ?? null;
}

const TYPE_TEXT: Record<string, [string, string, string]> = {
  // type: [title template, workflow slug, cta]
  MISSING_LEASE_RULE: ["{n} tenant{s} without an approved lease rule", "exceptions", "Review"],
  MISSING_TENANT_AREA: ["{n} tenant{s} missing rentable area", "exceptions", "Review"],
  UNSUPPORTED_RULE: ["{n} lease term{s} the engine cannot compute", "exceptions", "Review"],
  MISSING_RULE_TERM: ["{n} lease rule{s} with a missing term", "exceptions", "Review"],
  MISSING_DENOMINATOR: ["{n} pro-rata pool{s} without a denominator", "exceptions", "Review"],
  UNKNOWN_CATEGORY: ["{n} mapping{s} to an unknown category", "mapping", "Fix mapping"],
  SHARES_EXCEED_100: ["{n} tenant share{s} above 100%", "exceptions", "Review"],
  DUPLICATE_GL_CANDIDATE: ["{n} possible duplicate invoice{s}", "exceptions", "Check"],
  MAPPING_NEEDS_REVIEW: ["{n} GL account{s} excluded pending review", "mapping", "Classify"],
  UNMAPPED_GL_ACCOUNT: ["{n} unmapped GL account{s}", "mapping", "Classify"],
  TRANSACTION_OUTSIDE_PERIOD: ["{n} transaction{s} outside the audit window", "exceptions", "Check"],
  MISSING_BILLINGS: ["{n} tenant{s} with no billings in the window", "exceptions", "Review"],
  VARIANCE_OVER_THRESHOLD: ["{n} provisional variance{s} above threshold", "exceptions", "Verify"],
  ROUNDING_DIFFERENCE: ["{n} pool rounding difference{s}", "exceptions", "View"],
};

export function buildActions(rows: DashboardRow[]): ActionItem[] {
  const multi = rows.length > 1;
  const items: (ActionItem & { rank: number })[] = [];
  const sev = { error: 0, warning: 1, info: 2 };
  for (const r of rows) {
    const base = `/properties/${r.id}`;
    for (const t of r.open_exception_types) {
      if (t.type === "MAPPING_NEEDS_REVIEW" || t.type === "UNMAPPED_GL_ACCOUNT") continue; // covered by the mapping item
      if (t.severity === "info" && t.type === "ROUNDING_DIFFERENCE") continue;
      const [tpl, slug, cta] = TYPE_TEXT[t.type] ?? [`{n} ${t.type.toLowerCase().replace(/_/g, " ")}`, "exceptions", "Review"];
      items.push({
        id: `${r.id}-${t.type}`,
        severity: t.severity,
        title: tpl.replace("{n}", String(t.count)).replace("{s}", t.count === 1 ? "" : "s"),
        context: multi ? r.name : undefined,
        detail: t.severity === "error" ? "Blocks a tenant result" : t.severity === "warning" ? "Needs review" : "For awareness",
        href: `${base}/${slug}`,
        cta,
        rank: sev[t.severity] * 10,
      });
    }
    if (r.accounts_needing_review)
      items.push({
        id: `${r.id}-mapping`,
        severity: "warning",
        title: `${r.accounts_needing_review} GL account${r.accounts_needing_review === 1 ? "" : "s"} need${r.accounts_needing_review === 1 ? "s" : ""} classification`,
        context: multi ? r.name : undefined,
        detail: "Excluded from every pool until reviewed",
        href: `${base}/mapping`,
        cta: "Classify",
        rank: 11,
      });
    if (r.unapproved_rules)
      items.push({
        id: `${r.id}-rules`,
        severity: "warning",
        title: `${r.unapproved_rules} lease rule${r.unapproved_rules === 1 ? "" : "s"} awaiting approval`,
        context: multi ? r.name : undefined,
        detail: "Draft rules are not used in audits",
        href: `${base}/rules`,
        cta: "Approve",
        rank: 12,
      });
    if (!r.checks.gl_imported || !r.checks.billings_imported)
      items.push({
        id: `${r.id}-import`,
        severity: "warning",
        title: !r.checks.gl_imported ? "General ledger not imported" : "Tenant billings not imported",
        context: multi ? r.name : undefined,
        href: `${base}/import`,
        cta: "Import",
        rank: 13,
      });
    if (!r.latest_audit && r.checks.gl_imported)
      items.push({
        id: `${r.id}-audit`,
        severity: "info",
        title: "No audit run yet",
        context: multi ? r.name : undefined,
        href: `${base}/audit`,
        cta: "Run audit",
        rank: 20,
      });
  }
  return items.sort((a, b) => a.rank - b.rank);
}
