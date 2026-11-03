# Design system

Source of truth: `frontend/app/globals.css` (tokens) and `frontend/components/ui` (components). Tokens are CSS custom properties exposed to Tailwind through `@theme inline`, so components write `bg-surface`, `text-muted`, `border-line`, `shadow-pop`.

## Direction

Financial operations software. Tables are the main surface. Warm paper background, white panels, deep navy navigation, one restrained teal-blue accent. No gradients, glass, oversized cards or decorative charts. Motion only confirms a state change.

## Tokens

### Color

| Token | Value | Use | Contrast on white |
| --- | --- | --- | --- |
| `--bg` | `#f6f5f2` | Page background | n/a |
| `--surface` | `#ffffff` | Panels, inputs | n/a |
| `--surface-2` / `-3` | `#faf9f7` / `#f1efeb` | Table headers, hover, chips | n/a |
| `--line` / `--line-strong` | `#e6e3dd` / `#d3cfc7` | Borders, input borders | n/a |
| `--ink` | `#16191f` | Primary text | 17.6:1 |
| `--ink-2` | `#3f444c` | Secondary text | 10.1:1 |
| `--muted` | `#646a73` | Labels, captions | 5.6:1 |
| `--subtle` | `#8a9099` | Icons and placeholders only | decorative |
| `--nav` | `#0f1a2c` | Sidebar | `--nav-ink` 14.2:1, `--nav-muted` 6.9:1 |
| `--accent` | `#0b6e99` | Primary actions, focus, selection | 5.4:1 |
| `--error` / `--warning` / `--success` / `--info` | `#b42318` / `#93370d` / `#067647` / `#175cd3` | Status text on their `-bg` tints | all ≥ 4.5:1 |
| `--under` / `--over` | `#93370d` / `#175cd3` | Variance direction | always paired with a text label |

Status never relies on color alone: `StatusBadge` always renders a word, and variance columns carry a "Direction" column with text.

### Typography

Inter for UI, JetBrains Mono for codes (GL accounts, rule refs, hashes). Scale: 11, 12, 13, 14 (base), 16, 20, 24 px. Numbers use `.num` (tabular lining figures, right aligned, no wrap). Page titles 20/600 with −0.01em tracking.

### Spacing, radius, shadow

Tailwind 4 px spacing. Radius `4 / 6 / 8 px`. Shadows `xs` (panels), `sm`, `pop` (menus, dialogs). Panels use a 1 px border plus `shadow-xs`.

### Motion

`--dur-fast 120ms`, `--dur-base 180ms`, `--ease cubic-bezier(0.2,0,0,1)`. Fade for overlays, short slide for sheets, pop for menus. `prefers-reduced-motion` disables all of it.

### Density

`--row-h 36px`, `--row-h-compact 30px`, `--cell-x 12px`. Mapping and rules tables use compact rows.

### Layering

`--z-sticky 10` (table headers), `--z-sidebar 30`, `--z-popover 40`, `--z-dialog 50`, `--z-toast 60`.

### Breakpoints

Tailwind defaults: `sm 640`, `md 768` (sidebar becomes persistent), `lg 1024` (master-detail layouts), `xl 1280`.

## Components

| Component | File | Notes |
| --- | --- | --- |
| Button | `ui/button.tsx` | `primary`, `secondary`, `ghost`, `danger`, `link`; `xs/sm/md/icon`; `loading` sets `aria-busy` |
| Badge, StatusBadge | `ui/badge.tsx` | One mapping from status to tone and label |
| Input, Select, Textarea, Field | `ui/input.tsx` | `Field` wires label, hint and error with `aria-describedby` and `aria-invalid` |
| Panel | `ui/panel.tsx` | Section container with header, description and actions |
| Dialog, Sheet | `ui/dialog.tsx` | Radix: focus trap, Escape, labelled title and description |
| Menu | `ui/menu.tsx` | Radix dropdown with checkbox items |
| Tooltip, Kbd, Skeleton | `ui/*` | Skeletons use a shimmer disabled by reduced motion |
| DataTable | `ui/data-table.tsx` | See below |
| PageHeader, Stat, EmptyState, ErrorBox, ProvisionalBanner, Stepper, KeyValue | `app/page.tsx` | Page-level building blocks |
| useNoteDialog, ConfirmDialog | `app/note-dialog.tsx` | Reviewer notes and destructive confirmation |
| CommandPalette | `app/command-palette.tsx` | cmdk, Ctrl/Cmd+K |

### DataTable

TanStack Table v8. Sorting with `aria-sort`, global search, faceted select filters, column visibility menu, pagination, row selection with a bulk action bar, sticky header, grouped column headers (`colgroup`), CSV export of the filtered rows, money-safe sorting via `compareDecimal`, keyboard rows (Tab to a row, Arrow keys move, Enter or Space opens), empty and filtered-empty states, skeleton loading.

## Patterns

- **Provisional language.** Any screen that shows calculated amounts carries `ProvisionalBanner`. No screen shows savings or recovered revenue.
- **Reviewer actions** always collect a note in a dialog. The note is part of the record.
- **Destructive actions** use `ConfirmDialog` and say what cannot be undone.
- **Unsaved edits** set `useUnsavedChanges`, which warns on page unload, and show a "Unsaved changes" marker next to Save.
- **Toasts** confirm completed saves. Errors appear inline next to the action, with the request ID for server errors.
- **Master-detail** (mapping, rules): list on the left, decision panel on the right, "Save and review next" to keep moving.

## Not included

Dark mode (light is the default and only theme in v0.2). Charts: none on purpose; readiness is shown as a bar with a text percentage.
