import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StackedColumns, type StackedColumn } from "./StackedColumns.js";

const zero = { success: 0, error: 0, interrupted: 0, denied: 0, unknown: 0 };
const columns: StackedColumn[] = [
  { key: "0", label: "0", counts: { ...zero, success: 1, error: 9 } },
  { key: "1", label: "1", counts: { ...zero, success: 1, error: 1, interrupted: 1 } },
  { key: "2", label: "2", counts: zero },
];

describe("StackedColumns", () => {
  it("renders one focusable column per entry with an accessible summary", () => {
    render(<StackedColumns ariaLabel="Tool outcomes per turn" columns={columns} axisLabel="Turn" />);

    const column = screen.getByRole("button", { name: "Turn 1: 1 succeeded, 1 failed, 1 interrupted" });
    expect(column).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn 2: no tool calls" })).toBeInTheDocument();
  });

  it("draws one segment per non-zero status", () => {
    const { container } = render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" />);
    const firstColumn = container.querySelector('[data-column="0"]')!;
    expect([...firstColumn.querySelectorAll("[data-status]")].map((el) => el.getAttribute("data-status"))).toEqual([
      "success",
      "error",
    ]);
  });

  it("shows a legend with icon + label for each status present", () => {
    render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" />);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "✓Succeeded",
      "✕Failed",
      "⏸Interrupted",
    ]);
  });

  it("selects a column by click and by keyboard", () => {
    const onSelect = vi.fn();
    render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /^Turn 0:/ }));
    fireEvent.keyDown(screen.getByRole("button", { name: /^Turn 1:/ }), { key: "Enter" });

    expect(onSelect.mock.calls).toEqual([["0"], ["1"]]);
  });

  it("marks the selected column", () => {
    render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" selectedKey="1" />);
    expect(screen.getByRole("button", { name: /^Turn 1:/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a tooltip with counts on hover and focus", () => {
    render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Turn 0:/ }));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Turn 0");
    expect(tooltip).toHaveTextContent("Failed9");
  });

  it("offers a table view of the same data", () => {
    render(<StackedColumns ariaLabel="x" columns={columns} axisLabel="Turn" />);

    fireEvent.click(screen.getByRole("button", { name: "Show table" }));

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("columnheader", { name: "Failed" })).toBeInTheDocument();
  });

  it("renders an empty state with no columns", () => {
    render(<StackedColumns ariaLabel="x" columns={[]} axisLabel="Turn" emptyText="No turns." />);
    expect(screen.getByText("No turns.")).toBeInTheDocument();
  });
});
