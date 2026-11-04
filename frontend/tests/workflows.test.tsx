import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ConfigForm } from "@/components/workflows/config-form";
import { DataPreview } from "@/components/workflows/data-preview";
import { type NodeSpec, defaultConfig, duration, newNodeId } from "@/lib/workflows";

const cleaner: NodeSpec = {
  type: "data_cleaner",
  label: "Data cleaner",
  category: "transform",
  description: "",
  inputs: [{ name: "in", label: "Rows", required: true, multi: false }],
  outputs: ["out", "rejected"],
  fields: [
    { key: "trim", label: "Trim whitespace", type: "bool", required: false, default: true, options: [], help: "", show_if: null },
    {
      key: "amount_columns",
      label: "Amount columns",
      type: "columns",
      required: false,
      default: null,
      options: [],
      help: "",
      show_if: null,
    },
    {
      key: "source",
      label: "Source",
      type: "select",
      required: false,
      default: "property",
      options: [
        { value: "property", label: "Property" },
        { value: "table", label: "Table" },
      ],
      help: "",
      show_if: null,
    },
    {
      key: "table_col",
      label: "Table column",
      type: "text",
      required: false,
      default: "",
      options: [],
      help: "",
      show_if: ["source", "table"],
    },
  ],
};

describe("workflow helpers", () => {
  it("gives new steps unique, readable ids", () => {
    expect(newNodeId("filter_rows", new Set(["filter1", "filter2"]))).toBe("filter3");
    expect(newNodeId("csv_export", new Set(["csv"]))).toBe("csv1");
  });
  it("fills defaults from the catalog", () => {
    expect(defaultConfig(cleaner)).toEqual({ trim: true, source: "property", table_col: "" });
  });
  it("formats durations", () => {
    expect(duration("2026-11-04T10:00:00Z", "2026-11-04T10:01:05Z")).toBe("1m 5s");
    expect(duration(null, null)).toBe("");
  });
});

describe("DataPreview", () => {
  it("shows source row numbers and the remaining count", () => {
    render(
      <DataPreview
        caption="t"
        data={{
          columns: ["amount", "error"],
          rows: [
            ["1200.00", ""],
            ["x", "not a number"],
          ],
          source_rows: [2, 9],
          row_count: 40,
        }}
      />,
    );
    expect(screen.getByRole("table", { name: "t" })).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("not a number")).toHaveClass("text-error");
    expect(screen.getByText("Showing 2 of 40 rows.")).toBeInTheDocument();
  });
});

function Harness() {
  const [c, setC] = useState<Record<string, unknown>>(defaultConfig(cleaner));
  return (
    <>
      <ConfigForm spec={cleaner} config={c} onChange={setC} columns={["amount", "memo"]} errors={["Key columns is required."]} />
      <pre data-testid="cfg">{JSON.stringify(c)}</pre>
    </>
  );
}

describe("ConfigForm", () => {
  it("edits columns with suggestions, shows conditional fields and errors", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "+ amount" }));
    const input = screen.getByLabelText("Add amount columns");
    fireEvent.change(input, { target: { value: "net" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(JSON.parse(screen.getByTestId("cfg").textContent!).amount_columns).toEqual(["amount", "net"]);
    expect(screen.queryByLabelText("Table column")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "table" } });
    expect(screen.getByLabelText("Table column")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Key columns is required.");
    fireEvent.click(screen.getByRole("button", { name: "Remove amount" }));
    expect(JSON.parse(screen.getByTestId("cfg").textContent!).amount_columns).toEqual(["net"]);
  });
});
