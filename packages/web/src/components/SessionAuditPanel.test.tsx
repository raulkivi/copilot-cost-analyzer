import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeSessionAudit } from "../test-support/audit-fixture.js";
import { SessionAuditPanel } from "./SessionAuditPanel.js";

function renderPanel(overrides: Partial<Parameters<typeof SessionAuditPanel>[0]> = {}) {
  const props = {
    sessionId: "s1",
    selectedTurnIndex: 0,
    onSelectTurn: vi.fn(),
    onInspectTurn: vi.fn(),
    loadAudit: vi.fn().mockResolvedValue(makeSessionAudit()),
    ...overrides,
  };
  render(<SessionAuditPanel {...props} />);
  return props;
}

describe("SessionAuditPanel", () => {
  it("loads the audit for the session and shows headline stat tiles", async () => {
    const props = renderPanel();

    expect(await screen.findByRole("group", { name: "Tool calls" })).toHaveTextContent("4");
    expect(props.loadAudit).toHaveBeenCalledWith("s1");
    expect(screen.getByRole("group", { name: "Failure rate" })).toHaveTextContent("75%");
    expect(screen.getByRole("group", { name: "Failure rate" })).toHaveTextContent("3 of 4 with a known outcome");
    expect(screen.getByRole("group", { name: "Retried commands" })).toHaveTextContent("1");
    // Output tokens lead; input (dominated by cache reads) is the note.
    const tokens = screen.getByRole("group", { name: "Output tokens in affected turns" });
    expect(tokens).toHaveTextContent("900");
    expect(tokens).toHaveTextContent("+42K input incl. cache");
  });

  it("shows a loading state, then an error if the audit fails to load", async () => {
    renderPanel({ loadAudit: vi.fn().mockRejectedValue(new Error("boom")) });
    expect(screen.getByText("Loading tool-call audit…")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });

  it("warns when outcome coverage is incomplete instead of implying zero failures", async () => {
    renderPanel({
      loadAudit: vi.fn().mockResolvedValue(
        makeSessionAudit({
          totals: { toolCalls: 3, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 3 },
          failureRate: null,
          outcomeCoverage: { known: 0, unknown: 3, unknownReasons: ["This provider does not record tool-call outcomes."] },
        }),
      ),
    });

    expect(await screen.findByText(/Outcome unknown for 3 of 3 tool calls/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Failure rate" })).toHaveTextContent("—");
  });

  it("selects a turn from the per-turn outcome chart", async () => {
    const props = renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /^Turn 1:/ }));

    expect(props.onSelectTurn).toHaveBeenCalledWith(1);
  });

  it("lists failures by default with command, category, exit code and evidence", async () => {
    renderPanel();

    const table = await screen.findByRole("table", { name: "Tool calls" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("definitely-not-installed-tool --version");
    expect(rows[0]).toHaveTextContent("Command not found");
    expect(rows[0]).toHaveTextContent("127");
    expect(rows[0]).toHaveTextContent("command not found");
  });

  it("filters the table by clicking a failure-category bar, and clears the filter", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Timeout: 1 Failed" }));

    const table = screen.getByRole("table", { name: "Tool calls" });
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(1);
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("sleep 8");

    fireEvent.click(screen.getByRole("button", { name: "Clear category filter: Timeout" }));
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(3);
  });

  it("filters by shell program from the program chart", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "sleep: 0 Succeeded, 1 Failed" }));

    const table = screen.getByRole("table", { name: "Tool calls" });
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(1);
  });

  it("toggles status chips to include successful calls", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /^Succeeded/, pressed: false }));

    const table = screen.getByRole("table", { name: "Tool calls" });
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(4);
  });

  it("opens the turn inspector from a row", async () => {
    const props = renderPanel();

    const table = await screen.findByRole("table", { name: "Tool calls" });
    fireEvent.click(within(within(table).getAllByRole("row")[2]).getByRole("button", { name: "Inspect turn 1" }));

    expect(props.onInspectTurn).toHaveBeenCalledWith(1);
  });

  it("lists retried commands", async () => {
    renderPanel();

    const retries = await screen.findByRole("list", { name: "Retried commands" });
    expect(retries).toHaveTextContent("definitely-not-installed-tool --version");
    expect(retries).toHaveTextContent("2 attempts");
    expect(retries).toHaveTextContent("never succeeded");
  });

  it("reloads when the session changes", async () => {
    const loadAudit = vi.fn().mockResolvedValue(makeSessionAudit());
    const { rerender } = render(
      <SessionAuditPanel sessionId="s1" selectedTurnIndex={0} onSelectTurn={vi.fn()} onInspectTurn={vi.fn()} loadAudit={loadAudit} />,
    );
    rerender(
      <SessionAuditPanel sessionId="s2" selectedTurnIndex={0} onSelectTurn={vi.fn()} onInspectTurn={vi.fn()} loadAudit={loadAudit} />,
    );
    await waitFor(() => expect(loadAudit).toHaveBeenCalledWith("s2"));
  });
});
