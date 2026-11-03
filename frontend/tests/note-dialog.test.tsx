import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useNoteDialog } from "@/components/app/note-dialog";
import { StatusBadge } from "@/components/ui/badge";

function Harness({ onSubmit }: { onSubmit: (n: string) => Promise<unknown> }) {
  const { ask, dialog } = useNoteDialog();
  return (
    <>
      <button onClick={() => ask({ title: "Accept exception", confirm: "Accept", onSubmit })}>open</button>
      {dialog}
    </>
  );
}

describe("useNoteDialog", () => {
  it("requires a note before submitting and closes on success", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.click(screen.getByText("open"));
    const dialog = screen.getByRole("dialog", { name: "Accept exception" });
    expect(dialog).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Write at least a few words");
    await userEvent.type(screen.getByLabelText(/Reviewer note/), "Owner agreed, vacated suite");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onSubmit).toHaveBeenCalledWith("Owner agreed, vacated suite");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and shows the server error", async () => {
    render(<Harness onSubmit={() => Promise.reject(new Error("Cannot move an exception from resolved to accepted."))} />);
    await userEvent.click(screen.getByText("open"));
    await userEvent.type(screen.getByLabelText(/Reviewer note/), "trying anyway");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot move an exception");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("always carries a text label, not color alone", () => {
    render(<StatusBadge status="unresolved" />);
    expect(screen.getByText("Unresolved")).toBeInTheDocument();
  });
});
