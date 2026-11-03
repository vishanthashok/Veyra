"use client";
import {
  type Cell, type ColumnDef, type ColumnFiltersState, type Row, type RowSelectionState, type SortingState,
  type VisibilityState, flexRender, getCoreRowModel, getFacetedUniqueValues, getFilteredRowModel,
  getPaginationRowModel, getSortedRowModel, useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3, Download, Search, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuTrigger } from "./menu";
import { TableSkeleton } from "./skeleton";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?: "left" | "right";
    label?: string;
    /** Value written to CSV export. Defaults to the accessor value. */
    exportValue?: (row: TData) => string | number | null | undefined;
    cellClassName?: string;
    headerClassName?: string;
  }
}

export type Facet = { columnId: string; label: string; options?: { value: string; label: string }[] };

type Props<T> = {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getRowId: (row: T) => string;
  loading?: boolean;
  searchPlaceholder?: string;
  facets?: Facet[];
  selectable?: boolean;
  bulkActions?: (rows: T[], clear: () => void) => React.ReactNode;
  onRowClick?: (row: T) => void;
  activeRowId?: string | null;
  pageSize?: number;
  exportName?: string;
  toolbar?: React.ReactNode;
  empty?: React.ReactNode;
  initialSorting?: SortingState;
  initialHidden?: string[];
  maxHeight?: string;
  compact?: boolean;
  caption: string;
  rowClassName?: (row: T) => string | undefined;
  hideColumnsMenu?: boolean;
};

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function DataTable<T>({
  data, columns, getRowId, loading, searchPlaceholder = "Search", facets = [], selectable, bulkActions, onRowClick,
  activeRowId, pageSize = 50, exportName, toolbar, empty, initialSorting = [], initialHidden = [], maxHeight,
  compact, caption, rowClassName, hideColumnsMenu,
}: Props<T>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    Object.fromEntries(initialHidden.map((c) => [c, false])),
  );

  const allColumns = React.useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!selectable) return columns;
    return [
      {
        id: "_select",
        enableSorting: false,
        enableHiding: false,
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all rows on this page"
            className="size-3.5 accent-[var(--accent)]"
            checked={table.getIsAllPageRowsSelected()}
            ref={(el) => { if (el) el.indeterminate = table.getIsSomePageRowsSelected(); }}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label="Select row"
            className="size-3.5 accent-[var(--accent)]"
            checked={row.getIsSelected()}
            onClick={(e) => e.stopPropagation()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
        meta: { headerClassName: "w-8", cellClassName: "w-8" },
      },
      ...columns,
    ];
  }, [columns, selectable]);

  // TanStack Table manages its own memoization; React Compiler skips this component by design.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data, columns: allColumns, getRowId,
    state: { sorting, globalFilter, columnFilters, rowSelection, columnVisibility },
    onSortingChange: setSorting, onGlobalFilterChange: setGlobalFilter, onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection, onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    initialState: { pagination: { pageSize } },
    enableRowSelection: !!selectable,
    globalFilterFn: "includesString",
  });

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;

  function exportCsv() {
    const cols = table.getVisibleLeafColumns().filter((c) => c.id !== "_select");
    const header = cols.map((c) => c.columnDef.meta?.label ?? (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id));
    const lines = table.getFilteredRowModel().rows.map((r) =>
      cols.map((c) => csvEscape(c.columnDef.meta?.exportValue ? c.columnDef.meta.exportValue(r.original) : r.getValue(c.id))).join(","),
    );
    const blob = new Blob([[header.map(csvEscape).join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function onRowKey(e: React.KeyboardEvent<HTMLTableRowElement>, row: Row<T>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick?.(row.original);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const sib = e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
      (sib as HTMLElement | null)?.focus();
    }
  }

  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide() && c.id !== "_select");

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {selected.length > 0 && bulkActions ? (
          <div className="flex flex-1 flex-wrap items-center gap-2" role="region" aria-label="Bulk actions">
            <span className="text-sm font-medium">{selected.length} selected</span>
            {bulkActions(selected, () => setRowSelection({}))}
            <Button size="xs" variant="ghost" onClick={() => setRowSelection({})}><X />Clear</Button>
          </div>
        ) : (
          <>
            <div className="relative w-full max-w-60">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
              <input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-7 w-full rounded-md border border-line-strong bg-surface pl-7 pr-2 text-xs outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]"
              />
            </div>
            {facets.map((f) => {
              const col = table.getColumn(f.columnId);
              if (!col) return null;
              const opts = f.options ?? [...col.getFacetedUniqueValues().keys()].filter((v) => v != null && v !== "").sort().map((v) => ({ value: String(v), label: String(v) }));
              return (
                <select
                  key={f.columnId}
                  aria-label={`Filter by ${f.label}`}
                  value={(col.getFilterValue() as string) ?? ""}
                  onChange={(e) => col.setFilterValue(e.target.value || undefined)}
                  className="h-7 rounded-md border border-line-strong bg-surface px-2 text-xs text-ink-2 outline-none focus-visible:border-accent"
                >
                  <option value="">{f.label}: all</option>
                  {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              );
            })}
            <div className="ml-auto flex items-center gap-1.5">
              {toolbar}
              {hideable.length > 0 && !hideColumnsMenu && (
                <Menu>
                  <MenuTrigger asChild><Button size="xs" variant="ghost" aria-label="Choose columns"><Columns3 />Columns</Button></MenuTrigger>
                  <MenuContent>
                    <MenuLabel>Visible columns</MenuLabel>
                    {hideable.map((c) => (
                      <MenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}>
                        {c.columnDef.meta?.label ?? (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id)}
                      </MenuCheckboxItem>
                    ))}
                  </MenuContent>
                </Menu>
              )}
              {exportName && <Button size="xs" variant="ghost" onClick={exportCsv}><Download />CSV</Button>}
            </div>
          </>
        )}
      </div>

      {loading ? <TableSkeleton cols={Math.min(6, columns.length)} /> : (
        <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 z-[var(--z-sticky)] bg-surface-2 shadow-[inset_0_-1px_0_var(--line)]">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const meta = h.column.columnDef.meta;
                    const sorted = h.column.getIsSorted();
                    return (
                      <th
                        key={h.id}
                        colSpan={h.colSpan}
                        scope={h.colSpan > 1 ? "colgroup" : "col"}
                        aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                        className={cn("h-8 whitespace-nowrap px-[var(--cell-x)] text-2xs font-semibold uppercase tracking-wide text-muted",
                          meta?.align === "right" ? "text-right" : "text-left", h.colSpan > 1 && "border-l border-line text-center", meta?.headerClassName)}
                      >
                        {h.isPlaceholder ? null : h.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={h.column.getToggleSortingHandler()}
                            className={cn("inline-flex items-center gap-1 uppercase hover:text-ink", meta?.align === "right" && "flex-row-reverse")}
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                          </button>
                        ) : flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = row.id;
                return (
                  <tr
                    key={id}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-selected={selectable ? row.getIsSelected() : undefined}
                    data-active={activeRowId === id || undefined}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    onKeyDown={onRowClick ? (e) => onRowKey(e, row) : undefined}
                    className={cn(
                      "border-b border-line transition-colors duration-[var(--dur-fast)] last:border-0",
                      onRowClick && "cursor-pointer hover:bg-surface-2 focus-visible:bg-accent-soft focus-visible:outline-none",
                      row.getIsSelected() && "bg-accent-soft/60",
                      activeRowId === id && "bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]",
                      rowClassName?.(row.original),
                    )}
                  >
                    {row.getVisibleCells().map((cell: Cell<T, unknown>) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <td
                          key={cell.id}
                          className={cn("px-[var(--cell-x)] align-middle text-ink", compact ? "h-[var(--row-h-compact)] py-1" : "h-[var(--row-h)] py-1.5",
                            meta?.align === "right" && "num", meta?.cellClassName)}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted">
              {globalFilter || columnFilters.length ? "No rows match these filters." : empty ?? "Nothing here yet."}
            </div>
          )}
        </div>
      )}

      {!loading && filteredCount > table.getState().pagination.pageSize && (
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-muted">
          <span className="tabular">
            {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}–
            {Math.min(filteredCount, (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize)} of {filteredCount}
          </span>
          <div className="flex gap-1">
            <Button size="xs" variant="ghost" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page"><ChevronLeft /></Button>
            <Button size="xs" variant="ghost" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page"><ChevronRight /></Button>
          </div>
        </div>
      )}
      {!loading && filteredCount <= table.getState().pagination.pageSize && filteredCount > 0 && (
        <div className="border-t border-line px-3 py-1.5 text-2xs text-muted tabular">{filteredCount} {filteredCount === 1 ? "row" : "rows"}</div>
      )}
    </div>
  );
}
