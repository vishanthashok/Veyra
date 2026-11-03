import {
  AlertTriangle,
  BookOpenCheck,
  Building2,
  FileSpreadsheet,
  LayoutDashboard,
  ListChecks,
  Scale,
  Tags,
  Upload,
  Users,
} from "lucide-react";

export const PROPERTY_NAV = [
  { slug: "", label: "Overview", icon: Building2 },
  { slug: "tenants", label: "Tenants", icon: Users },
  { slug: "import", label: "Data import", icon: Upload },
  { slug: "mapping", label: "Expense mapping", icon: Tags },
  { slug: "rules", label: "Lease rules", icon: BookOpenCheck },
  { slug: "audit", label: "Audit workspace", icon: Scale },
  { slug: "exceptions", label: "Exceptions", icon: AlertTriangle },
  { slug: "reports", label: "Reports", icon: FileSpreadsheet },
] as const;

export const GLOBAL_NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/properties", label: "Properties", icon: ListChecks },
] as const;
