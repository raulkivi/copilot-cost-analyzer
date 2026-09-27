import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeAuditRollup } from "../test-support/audit-fixture.js";
import { AuditRollupPanel } from "./AuditRollupPanel.js";

const NOW = new Date("2026-09-27T12:00:00.000Z");

function renderPanel(loadRollup = vi.fn().mockResolvedValue(makeAuditRollup())) {
  const onOpenSession = vi.fn();
  render(<AuditRollupPanel loadRollup={loadRollup} onOpenSession={onOpenSession} now={NOW} />);
  return { loadRollup, onOpenSession };
}

describe("AuditRollupPanel", () => {
  it("defaults to the last 30 days and shows headline tiles", async () => {
    const { loadRollup } = renderPanel();

    expect(await screen.findByRole("group", { name: "Sessions" })).toHaveTextContent("2");
    expect(loadRollup).toHaveBeenCalledWith({ since: "2026-08-28" });
    expect(screen.getByRole("group", { name: "Failure rate" })).toHaveTextContent("40%");
    expect(screen.getByRole("group", { name: "Most failing program" })).toHaveTextContent("npm");
  });

  it("loads exactly once without an injected clock (regression: re-render loop)", async () => {
    const loadRollup = vi.fn().mockResolvedValue(makeAuditRollup());
    render(<AuditRollupPanel loadRollup={loadRollup} onOpenSession={vi.fn()} />);

    expect(await screen.findByRole("group", { name: "Sessions" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loadRollup).toHaveBeenCalledTimes(1);
  });

  it("reloads for another range preset", async () => {
    const { loadRollup } = renderPanel();
    await screen.findByRole("group", { name: "Sessions" });

    fireEvent.click(screen.getByLabelText("7 days"));
    await waitFor(() => expect(loadRollup).toHaveBeenLastCalledWith({ since: "2026-09-20" }));

    fireEvent.click(screen.getByLabelText("All time"));
    await waitFor(() => expect(loadRollup).toHaveBeenLastCalledWith({}));
  });

  it("charts outcomes per day", async () => {
    renderPanel();
    expect(await screen.findByRole("button", { name: "Day 09-27: 3 succeeded, 2 failed, 1 interrupted" })).toBeInTheDocument();
  });

  it("ranks the top failing commands with their category", async () => {
    renderPanel();

    const table = await screen.findByRole("table", { name: "Top failing commands" });
    const [first] = within(table).getAllByRole("row").slice(1);
    expect(first).toHaveTextContent("npm run build");
    expect(first).toHaveTextContent("Wrong directory");
    expect(first).toHaveTextContent("2");
  });

  it("opens a session's audit from the sessions table", async () => {
    const { onOpenSession } = renderPanel();

    const table = await screen.findByRole("table", { name: "Sessions" });
    fireEvent.click(within(table).getByRole("button", { name: "Fix the build" }));

    expect(onOpenSession).toHaveBeenCalledWith("a");
  });

  it("never shows a 0% failure rate for a session whose outcomes are all unknown", async () => {
    renderPanel(
      vi.fn().mockResolvedValue(
        makeAuditRollup({ sessions: [{ sessionId: "v", title: "VS Code session", toolCalls: 5, failed: 0, unknown: 5 }] }),
      ),
    );
    const table = await screen.findByRole("table", { name: "Sessions" });
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent(/—$/);
  });

  it("shows an empty state when no session falls in the range", async () => {
    renderPanel(vi.fn().mockResolvedValue(makeAuditRollup({ sessionCount: 0, sessions: [], daily: [], failureRate: null })));
    expect(await screen.findByText("No sessions in this date range.")).toBeInTheDocument();
  });

  it("reports a load error", async () => {
    renderPanel(vi.fn().mockRejectedValue(new Error("offline")));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });
});
