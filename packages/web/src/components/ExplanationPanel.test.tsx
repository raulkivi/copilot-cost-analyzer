import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeTurn } from "../test-support/turn-fixture.js";
import { ExplanationPanel } from "./ExplanationPanel.js";

describe("ExplanationPanel", () => {
  it("renders the explanation for the given turn", () => {
    render(<ExplanationPanel turn={makeTurn({ explanation: "why this happened" })} mode="learn" />);

    expect(screen.getByText("why this happened")).toBeInTheDocument();
  });

  it("renders a placeholder when no turn is selected", () => {
    render(<ExplanationPanel turn={null} mode="learn" />);

    expect(screen.getByText(/no turn selected/i)).toBeInTheDocument();
  });

  it("renders the turn's trigger tag when set", () => {
    render(<ExplanationPanel turn={makeTurn({ triggeredEvent: "compaction" })} mode="learn" />);

    expect(screen.getByText("compaction")).toBeInTheDocument();
  });

  it("does not render a 'Tool calls this turn' section in learn mode", () => {
    render(<ExplanationPanel turn={makeTurn()} mode="learn" />);

    expect(screen.queryByText("Tool calls this turn")).not.toBeInTheDocument();
  });

  it("shows an unavailable message in analyze mode when the session has no tool-call artifacts", () => {
    render(
      <ExplanationPanel turn={makeTurn()} mode="analyze" toolCallsAvailable={false} />,
    );

    expect(screen.getByText("Tool calls this turn")).toBeInTheDocument();
    expect(
      screen.getByText("Tool-call detail unavailable for this session."),
    ).toBeInTheDocument();
  });

  it("shows a 'no tools called' message in analyze mode when this turn made no tool calls", () => {
    render(
      <ExplanationPanel
        turn={makeTurn({ toolCalls: [] })}
        mode="analyze"
        toolCallsAvailable={true}
      />,
    );

    expect(screen.getByText("No tools called this turn.")).toBeInTheDocument();
  });

  it("does not render an inspect-request/response button in learn mode", () => {
    render(
      <ExplanationPanel turn={makeTurn()} mode="learn" onOpenTurnInspector={() => {}} />,
    );

    expect(screen.queryByRole("button", { name: /inspect request\/response/i })).not.toBeInTheDocument();
  });

  it("renders an inspect-request/response button in analyze mode and calls onOpenTurnInspector when clicked", () => {
    const onOpenTurnInspector = vi.fn();

    render(
      <ExplanationPanel
        turn={makeTurn()}
        mode="analyze"
        toolCallsAvailable={true}
        onOpenTurnInspector={onOpenTurnInspector}
      />,
    );

    const button = screen.getByRole("button", { name: /inspect request\/response/i });
    fireEvent.click(button);

    expect(onOpenTurnInspector).toHaveBeenCalled();
  });

  it("lists each tool call's name and touched files in analyze mode", () => {
    const turn = makeTurn({
      toolCalls: [
        { name: "read_file", argsSummary: "src/a.ts", filesTouched: ["src/a.ts", "src/b.ts"] },
      ],
    });

    render(<ExplanationPanel turn={turn} mode="analyze" toolCallsAvailable={true} />);

    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
  });

  it("shows each tool call's outcome and shell command in analyze mode", () => {
    const turn = makeTurn({
      toolCalls: [
        {
          name: "Bash",
          argsSummary: "foo --version",
          shell: { command: "foo --version", program: "foo" },
          outcome: { status: "error", exitCode: 127, failureCategory: "command-not-found" },
        },
      ],
    });

    render(<ExplanationPanel turn={turn} mode="analyze" toolCallsAvailable={true} />);

    expect(screen.getByText("Failed · Command not found")).toBeInTheDocument();
    expect(screen.getByText("foo --version")).toBeInTheDocument();
  });
});
