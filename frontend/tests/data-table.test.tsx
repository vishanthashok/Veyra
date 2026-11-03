import type { ColumnDef } from "@tanstack/react-table";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "@/components/ui/data-table";
import { compareDecimal, money } from "@/lib/utils";

type Row = { id: string; name: string; amount: string; status: string };
const rows: Row[] = [
  { id: "a", name: "Alamo Cellular", amount: "5795.57", status: "calculated" },
  { id: "b", name: "Bluebonnet Nail Spa", amount: "-12.00", status: "unresolved" },
  { id: "c", name: "Lone Star Grocery", amount: "71019.74", status: "calculated" },
];
const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Tenant" },
  {
    accessorKey: "amount",
    header: "Amount",
    meta: { align: "right" },
    sortingFn: (a, b) => compareDecimal(a.original.amount, b.original.amount),
    cell: ({ getValue }) => money(getValue() as string),
  },
  { accessorKey: "status", header: "Status", filterFn: "equals" },
];
const names = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].textContent);

describe("DataTable", () => {
  it("sorts money columns numerically, not as text", async () => {
    render(<DataTable caption="t" data={rows} columns={columns} getRowId={(r) => r.id} />);
    await userEvent.click(screen.getByRole("button", { name: /Amount/ }));
    expect(names()).toEqual(["Bluebonnet Nail Spa", "Alamo Cellular", "Lone Star Grocery"]);
    expect(screen.getByRole("columnheader", { name: /Amount/ })).toHaveAttribute("aria-sort", "ascending");
  });

  it("filters by search text and by facet", async () => {
    render(
      <DataTable caption="t" data={rows} columns={columns} getRowId={(r) => r.id} facets={[{ columnId: "status", label: "Status" }]} />,
    );
    await userEvent.type(screen.getByLabelText("Search"), "lone");
    expect(names()).toEqual(["Lone Star Grocery"]);
    await userEvent.clear(screen.getByLabelText("Search"));
    await userEvent.selectOptions(screen.getByLabelText("Filter by Status"), "unresolved");
    expect(names()).toEqual(["Bluebonnet Nail Spa"]);
  });

  it("shows bulk actions for selected rows", async () => {
    const onBulk = vi.fn();
    render(
      <DataTable
        caption="t"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        selectable
        bulkActions={(sel) => <button onClick={() => onBulk(sel.map((r) => r.id))}>Apply</button>}
      />,
    );
    const boxes = screen.getAllByRole("checkbox", { name: "Select row" });
    await userEvent.click(boxes[0]);
    await userEvent.click(boxes[2]);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onBulk).toHaveBeenCalledWith(["a", "c"]);
  });

  it("activates rows from the keyboard", async () => {
    const onRow = vi.fn();
    render(<DataTable caption="t" data={rows} columns={columns} getRowId={(r) => r.id} onRowClick={onRow} />);
    const first = screen.getAllByRole("row")[1];
    first.focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onRow).toHaveBeenCalledWith(rows[1]);
  });

  it("explains an empty filter result", async () => {
    render(<DataTable caption="t" data={rows} columns={columns} getRowId={(r) => r.id} />);
    await userEvent.type(screen.getByLabelText("Search"), "zzz");
    expect(screen.getByText("No rows match these filters.")).toBeInTheDocument();
  });
});
