# UI critique of v0.2 (before the overhaul)

Based on the v0.2 screenshots in `docs/screenshots` (captured 2026-11-03) and the code in `frontend/`.

## Why it feels unfinished

The v0.2 UI is functional and consistent, but it reads as a component library assembled into pages. Every surface is the same white bordered box, every section starts with the same uppercase table header, and almost nothing tells the user what to do next. The product's point of view (provisional review, traceability, next action) is stated in text banners instead of being expressed by the layout.

## Problems by category

| Category | Where | What is wrong |
| --- | --- | --- |
| Information hierarchy | Dashboard (`02-dashboard.png`) | Five equal stat cards carry the same weight as the main table. Nothing is primary. The most useful fact ("3 blocking errors on Mesquite Crossing") is a small badge in the 5th table column. |
| Repetition | Dashboard | Readiness appears three times: the "Ready for year-end inputs" card, the readiness bar in the table, and a 7-row checklist table below. |
| Missing primary action | Dashboard, Overview | The dashboard has no button. Import and Run audit live two levels down inside a property. |
| Excessive whitespace | Stat cards (`02`, `08`) | Each card is about 110 px tall to show one number. Five of them take a full row on the audit page before any financial data appears. |
| Unnecessary scrolling | Audit workspace (`08`) | Banner, run card, five stat cards and a pool table push the tenant table, which is the point of the screen, below the fold at 1440×900. |
| Repetitive cards | All property pages | Panel, panel, panel. Pools, tenants, readiness, details are all the same rounded box with the same header style, so nothing groups. |
| Weak typography | Global | Page titles are 20 px, barely larger than section titles (14 px semibold). Every table header is 11 px uppercase with tracking, which turns tables into a wall of small caps. Mono font is used for category codes inside body text and fights the sans. |
| Inconsistent spacing | Global | Panel headers use 12 px vertical padding, bodies 16 px, tables 12 px cell padding, stat cards 12 px. Gaps between sections alternate between 20 and 24 px. |
| Unnecessary borders | Global | Borders around the page header area, around every panel, around every badge, around table toolbars and between every row. The eye has no rest. |
| Generic components | Tables, badges | Badges have a border, a tinted fill and a dot, three signals for one status. The DataTable toolbar shows "Columns" and "CSV" on every table including 1-row ones. |
| Awkward layouts | Mapping, Rules (`06`, `07`) | Left lists are squeezed to about 420 px, so names wrap and toolbars break onto two lines. The detail side is mostly empty form space. |
| Weak navigation | Sidebar | Flat list: Dashboard, Properties, then eight property links under an uppercase property name. No grouping by job (setup, review, output). The property switcher looks like an input. The empty area below the links is half the sidebar. |
| Poor use of color | Global | The accent teal-blue is used for buttons, active nav, focus, selected rows, links and badges, so it signals nothing. Status colors are fine but appear as heavy tinted boxes. |
| Confusing workflows | Exceptions (`10`, `11`) | Exceptions are a generic table. Opening one covers the list with a sheet, so you cannot move through the queue. Supporting numbers are not shown, only text. |
| Confusing workflows | Import (`05`, `13`) | Step 1 is "Import type" with three big radio cards before you can even pick a file. The preview is a plain table without spreadsheet cues (row numbers, column letters, mapped columns). Errors are listed in a separate table instead of on the rows. |
| Banners | Audit, Exceptions, Reports | A full-width amber banner on each page. The provisional status matters, but repeating a paragraph is noise; it belongs in the page context. |

## Redesign principles

1. **One primary action per page,** placed top right.
2. **Next action first.** The dashboard leads with an action center built from real exceptions, mappings and rules.
3. **Fewer boxes.** Group with spacing and section headers; use borders for tables and drawers only.
4. **Compact metrics.** One metric strip with dividers instead of cards.
5. **Typography carries hierarchy.** 28 px page titles, 15 px section headings, 13 px body, sentence-case table headers, tabular numbers.
6. **Color means something.** Accent only for primary actions, current selection and focus. Status colors only for status.
7. **Lists stay visible.** Exceptions and mapping use a persistent split view, not overlays.
8. **Provisional status is context,** shown once in the page header, not as a banner on every page.
