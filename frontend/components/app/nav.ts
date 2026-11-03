import { AlertTriangle, BookOpenCheck, Building2, FileSpreadsheet, LayoutGrid, Scale, Settings2, Tags, Upload } from "lucide-react";
import type { DashboardRow } from "@/lib/api";

export type NavItem = {
  key: string;
  label: string;
  icon: React.ElementType;
  /** Path under /properties/{id}; "" is the property setup page. Undefined for global routes. */
  slug?: string;
  href?: string;
  count?: (r: DashboardRow | undefined) => { n: number; tone: "error" | "warning" } | null;
};

export const WORKSPACE: NavItem[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid, href: "/" },
  { key: "properties", label: "Properties", icon: Building2, href: "/properties" },
];

export const REVIEW: NavItem[] = [
  { key: "setup", label: "Property setup", icon: Settings2, slug: "" },
  { key: "import", label: "Data imports", icon: Upload, slug: "import" },
  {
    key: "mapping",
    label: "Expense mapping",
    icon: Tags,
    slug: "mapping",
    count: (r) => (r?.accounts_needing_review ? { n: r.accounts_needing_review, tone: "warning" } : null),
  },
  {
    key: "rules",
    label: "Lease rules",
    icon: BookOpenCheck,
    slug: "rules",
    count: (r) =>
      r && r.unapproved_rules + r.tenants_missing_rules ? { n: r.unapproved_rules + r.tenants_missing_rules, tone: "warning" } : null,
  },
  { key: "audit", label: "Audit workspace", icon: Scale, slug: "audit" },
  {
    key: "exceptions",
    label: "Exceptions",
    icon: AlertTriangle,
    slug: "exceptions",
    count: (r) => {
      const e = r?.open_exceptions ?? {};
      const n = (e.error ?? 0) + (e.warning ?? 0);
      return n ? { n, tone: e.error ? "error" : "warning" } : null;
    },
  },
];

export const OUTPUT: NavItem[] = [{ key: "reports", label: "Reports", icon: FileSpreadsheet, slug: "reports" }];

/** Back-compat for the command palette. */
export const PROPERTY_NAV = [...REVIEW, ...OUTPUT].map((n) => ({ slug: n.slug ?? "", label: n.label, icon: n.icon }));
export const GLOBAL_NAV = WORKSPACE.map((n) => ({ href: n.href!, label: n.label, icon: n.icon }));
