# Design system (v0.3)

Source of truth: `frontend/app/globals.css` (tokens) and `frontend/components/ui` plus `frontend/components/app` (components). Tokens are CSS custom properties exposed to Tailwind through `@theme inline`, so components write `bg-surface`, `text-muted`, `border-line`, `shadow-pop`.

The critique that drove this version is in [UI_CRITIQUE.md](UI_CRITIQUE.md).

## Direction

Financial operations software in the style of Linear, Stripe, Ramp and Mercury. Warm off-white page, white panels, charcoal navigation, one refined teal accent. Tables and queues are the main surface. Every screen answers one question: what needs attention next. No gradients, glass, oversized cards or decorative charts. Motion only confirms a state change.

## Tokens

### Color

| Token | Value | Use | Contrast on white / on `--bg` |
| --- | --- | --- | --- |
| `--bg` | `#fafaf8` | Page background | n/a |
| `--surface` | `#ffffff` | Panels, inputs | n/a |
| `--surface-2` / `-3` | `#f5f5f2` / `#eeeeea` | Hover, table headers, chips, skeletons | n/a |
| `--line` / `--line-strong` | `#e9e8e4` / `#d8d7d1` | Borders, input borders | n/a |
| `--ink` | `#17191d` | Primary text | 17.6 / 16.8 |
| `--ink-2` | `#3d414a` | Secondary text | 10.2 / 9.8 |
| `--muted` | `#676c75` | Labels, captions | 5.3 / 5.1 |
| `--subtle` | `#9a9ea6` | Icons and placeholders only | decorative |
| `--nav` / `-2` / `-3` | `#121417` / `#1b1e23` / `#252930` | Sidebar, hover, active item | `--nav-ink` 15.6, `--nav-muted` 6.2 |
| `--accent` | `#0d7a6a` | Primary actions, focus, selection | 5.2 / 5.0 |
| `--accent-soft` | `#e8f3f0` | Selected row, featured icon tile | n/a |
| `--error` | `#b3261e` | Blocking errors | 6.5 |
| `--warning` | `#93560f` | Needs review | 5.9 |
| `--success` | `#2a7350` | Complete, calculated | 5.7 |
| `--info` | `#2e5aa3` | For awareness, in review | 6.8 |
| `--under` / `--over` | `#93560f` / `#2e5aa3` | Variance direction | always paired with a text label |

Each status color has a `-bg` tint for badges. Status never relies on color alone: `StatusBadge` renders a word, `SeverityIcon` uses a different shape per severity (octagon, triangle, circle) with an `aria-label`, and variance columns carry a text "Direction" column.

### Typography

Geist for UI and Geist Mono for codes (GL accounts, rule refs, exception types, hashes), loaded through `next/font`.

| Token | Size | Use |
| --- | --- | --- |
| `text-2xs` | 11 px | Group labels, keyboard hints |
| `text-xs` | 12 px | Table headers, captions, metadata |
| `text-sm` | 13 px | Body, table cells |
| `text-base` | 14 px | Inputs, emphasized body |
| `text-md` | 15 px | Section headings |
| `text-lg` / `text-xl` | 17 / 22 px | Drawer titles, metric values |
| `text-2xl` | 28 px | Page titles (600, -0.02em) |

Numbers use `.num` or `.tabular` (tabular lining figures). Money is right aligned and never wraps.

### Spacing, radius, shadow

Tailwind 4 px spacing. Content max width 1360 px. Radius `5 / 7 / 10 px`. Shadows `xs` (panels), `sm` (raised buttons), `pop` (menus, dialogs, drawers). Panels use a 1 px border plus `shadow-xs`.

### Motion

`--dur-fast 120ms` (menus, hovers), `--dur-base 180ms` (dialogs, drawers), `--ease cubic-bezier(0.2,0,0,1)`. Utilities `.anim-fade`, `.anim-slide`, `.anim-pop`. `prefers-reduced-motion` turns all animation and the skeleton shimmer off.

### Density

`--row-h 40px`, `--row-h-compact 34px`, `--cell-x 14px`. Mapping, rules and the import preview use compact rows.

### Layout and layering

Sidebar 232 px, 60 px collapsed. Topbar 52 px. `--z-sticky 10`, `--z-topbar 20`, `--z-sidebar 30`, `--z-popover 40`, `--z-dialog 50`, `--z-toast 60`.

### Breakpoints

Tailwind defaults: `sm 640`, `md 768` (sidebar becomes persistent, drawer below), `lg 1024` (split layouts, 4- or 5-column metric strip), `xl 1280`.

## App shell

- **Sidebar** (charcoal). Groups: Workspace (Overview, Properties), Review (Property setup, Data imports, Expense mapping, Lease rules, Audit workspace, Exceptions), Output (Reports). Review items show live counts (unmapped accounts, unapproved rules, open exceptions). The footer names the property under review and holds the collapse control (Cmd/Ctrl + \). Collapsed items keep tooltips. Below 768 px the sidebar is a drawer.
- **Topbar.** `PropertySwitcher` (All properties or one property), a reporting-period pill inside a property, search that opens the command palette (Cmd/Ctrl + K), and the account menu.
- The current property is the one in the URL, else the last one used, else the first.

## Components

| Component | File | Notes |
| --- | --- | --- |
| AppShell, Sidebar, PropertySwitcher | `app/app-shell.tsx`, `app/nav.ts` | Shell, nav groups with counts, collapse, mobile drawer |
| PageHeader, SectionHeader | `app/page.tsx` | Breadcrumbs, 28 px title, meta, description, actions |
| MetricCard, MetricStrip | `app/metrics.tsx` | Joined cells over a 1 px grid; tone dot; odd last cell spans on mobile |
| StatusBadge, Badge, SeverityIcon | `ui/badge.tsx` | One mapping from status to tone and label |
| DataTable | `ui/data-table.tsx` | See below |
| EmptyState, ErrorBox, ProvisionalTag, ProvisionalBanner, Stepper, KeyValue | `app/page.tsx` | Page-level building blocks |
| ActionList | `app/action-list.tsx` | Ranked, linked work items with severity, detail and a verb |
| ActivityTimeline | `app/activity-timeline.tsx` | Real events only; groups bursts by the same person within 15 minutes |
| AuditProgress | `app/audit-progress.tsx` | Segmented readiness bar with "done/total" text |
| FilterBar, Segmented | `ui/input.tsx` | Tabs with counts for queue filters; scrolls instead of wrapping |
| DetailDrawer (Sheet) | `ui/dialog.tsx` | Inset right drawer with eyebrow, title, description; Radix focus trap |
| ConfirmDialog, useNoteDialog | `app/note-dialog.tsx` | Destructive confirmation and reviewer notes |
| LoadingSkeleton, TableSkeleton | `ui/skeleton.tsx` | Shimmer, disabled by reduced motion |
| SetupTabs | `properties/[id]/setup-tabs.tsx` | Details and Tenants under Property setup |
| Button | `ui/button.tsx` | `primary`, `secondary`, `ghost`, `danger`, `link`, `dark`; `xs/sm/md/icon`; `loading` sets `aria-busy` |
| Input, Select, Textarea, Field | `ui/input.tsx` | `Field` wires label, hint and error with `aria-describedby` and `aria-invalid` |
| Menu, Tooltip, Kbd | `ui/*` | Radix primitives |
| CommandPalette | `app/command-palette.tsx` | cmdk, Cmd/Ctrl + K |

### DataTable

TanStack Table v8. Sentence-case headers, sort with `aria-sort` and a hover-only sort icon, flexible search, dashed facet filters, opt-in column menu (`columnsMenu`), pagination, row selection with a bulk action bar, sticky header, grouped column headers in small caps, CSV export of the filtered rows, money-safe sorting via `compareDecimal`, keyboard rows (Tab to a row, arrows move, Enter or Space opens), an accent bar on the active row, empty and filtered-empty states, skeleton loading. `filterStart` places a Segmented filter before the search box.

## Screen patterns

- **Overview.** Four metrics, then the Action center (ranked: blocking errors, mapping, rules, imports, warnings, info), Recent activity from real records, and the property table with readiness, open exceptions by severity, last audit and a next-step button.
- **Audit workspace.** Run picker, five-metric strip, tenant reconciliation with grouped columns (Calculated, Billed, Difference) and filters, expense pools with allocation bars. A row opens the calculation trace drawer: summary equation first, then numbered steps grouped by phase.
- **Exceptions.** Split view. Left: queue with Needs action / Closed / All, search, severity, keyboard (arrow keys or j/k). Right: how to clear it with a fix link, supporting data, the relevant calculation from the run, history, and a resolution panel. Blocking errors cannot be resolved by hand.
- **Import wizard.** Upload, Map columns, Validate, Review, Confirm. Spreadsheet-style preview with column letters, row numbers, mapped columns highlighted and an inline problem column.
- **Provisional language.** Calculated amounts carry `ProvisionalTag`. No screen shows savings or recovered revenue.
- **Reviewer actions** collect a note in a dialog. The note is part of the record.
- **Toasts** confirm completed actions. Errors appear inline next to the action, with the request ID for server errors.

## Not included

Dark mode. Charts: none on purpose; readiness and allocation use bars with text values.
