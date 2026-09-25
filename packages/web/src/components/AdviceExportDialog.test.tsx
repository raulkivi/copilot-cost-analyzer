import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@copilot-cost-analyzer/domain";
import { buildAdviceBundle } from "../lib/build-advice-bundle.js";
import { makeTurn } from "../test-support/turn-fixture.js";
import { AdviceExportDialog } from "./AdviceExportDialog.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    mode: "analyze",
    title: "Refactor auth module",
    model: "gpt-4o",
    turns: [makeTurn({ index: 0 })],
    turnCount: 1,
    costAiCredits: { known: true, value: 1.5 },
    usageDataAvailable: true,
    ...overrides,
  };
}

describe("AdviceExportDialog", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <AdviceExportDialog sessions={[makeSession()]} open={false} onClose={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the selected session count, pluralized, when open", () => {
    const { rerender } = render(
      <AdviceExportDialog sessions={[makeSession({ id: "s1" })]} open onClose={vi.fn()} />,
    );
    expect(screen.getByText("1 session selected for advice")).toBeInTheDocument();

    rerender(
      <AdviceExportDialog
        sessions={[makeSession({ id: "s1" }), makeSession({ id: "s2" })]}
        open
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("2 sessions selected for advice")).toBeInTheDocument();
  });

  it("reveals the generated bundle in a preview when Preview is clicked", () => {
    render(
      <AdviceExportDialog sessions={[makeSession({ title: "Refactor auth module" })]} open onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByTestId("advice-preview")).toHaveTextContent("Refactor auth module");
  });

  it("excludes tool argsSummary from the preview by default, and includes it once 'Include tool call args' is checked", () => {
    const sessions = [
      makeSession({
        turns: [makeTurn({ index: 0, toolCalls: [{ name: "search_text", argsSummary: "SECRET_SNIPPET" }] })],
      }),
    ];
    render(<AdviceExportDialog sessions={sessions} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByTestId("advice-preview")).not.toHaveTextContent("SECRET_SNIPPET");

    fireEvent.click(screen.getByRole("checkbox", { name: /include tool call args/i }));

    expect(screen.getByTestId("advice-preview")).toHaveTextContent("SECRET_SNIPPET");
  });

  it("warns when a selected session hasn't been opened yet, so its turn-level detail is missing", () => {
    const notYetOpened = makeSession({ id: "s1", title: "Not opened", turnCount: 5, turns: [] });
    render(<AdviceExportDialog sessions={[notYetOpened]} open onClose={vi.fn()} />);

    expect(screen.getByText(/1 selected session hasn't been opened yet/i)).toBeInTheDocument();
  });

  it("does not warn when every selected session's turns are already loaded", () => {
    render(
      <AdviceExportDialog sessions={[makeSession({ turnCount: 1, turns: [makeTurn()] })]} open onClose={vi.fn()} />,
    );

    expect(screen.queryByText(/hasn't been opened yet/i)).not.toBeInTheDocument();
  });

  it("copies the generated bundle to the clipboard and shows a confirmation", async () => {
    const sessions = [makeSession()];
    render(<AdviceExportDialog sessions={sessions} open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy advice prompt" }));

    expect(writeText).toHaveBeenCalledWith(buildAdviceBundle(sessions, { includeToolArgs: false }));
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("calls onClose when the Close button is clicked", () => {
    const onClose = vi.fn();
    render(<AdviceExportDialog sessions={[makeSession()]} open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked, but not when the dialog body is clicked", () => {
    const onClose = vi.fn();
    render(<AdviceExportDialog sessions={[makeSession()]} open onClose={onClose} />);

    fireEvent.click(screen.getByText("Export advice bundle"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("advice-dialog-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });
});
