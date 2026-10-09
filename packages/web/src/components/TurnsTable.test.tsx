import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeTurn } from "../test-support/turn-fixture.js";
import { TurnsTable } from "./TurnsTable.js";

describe("TurnsTable", () => {
  it("renders the 14-column header spec in order", () => {
    render(<TurnsTable turns={[]} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual([
      "Turn",
      "Trigger",
      "Rounds",
      "Calls",
      "Uncached in",
      "Cache read",
      "Cache write",
      "Tool",
      "Vision",
      "Reasoning",
      "Output",
      "AI Credits",
      "Cumulative",
      "Model",
    ]);
  });

  it("renders one row per turn plus a header row", () => {
    const turns = [makeTurn({ index: 1 }), makeTurn({ index: 2 })];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getAllByRole("row")).toHaveLength(turns.length + 1);
  });

  it("shows an em dash for an unknown token count instead of a number or the word 'unavailable'", () => {
    const turns = [
      makeTurn({
        usage: { ...makeTurn().usage, cacheWrite: { known: false, reason: "no data" } },
      }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it("renders a trigger tag when triggeredEvent is set, else a muted em dash", () => {
    const turns = [
      makeTurn({ index: 0, triggeredEvent: "compaction" }),
      makeTurn({ index: 1 }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getByText("compaction")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("maps each triggeredEvent value to its display label", () => {
    const turns = [
      makeTurn({ index: 0, triggeredEvent: "model-switch" }),
      makeTurn({ index: 1, triggeredEvent: "tool-change" }),
      makeTurn({ index: 2, triggeredEvent: "clear" }),
      makeTurn({ index: 3, triggeredEvent: "rewind" }),
      makeTurn({ index: 4, triggeredEvent: "fork" }),
      makeTurn({ index: 5, triggeredEvent: "cache-expiry" }),
      makeTurn({ index: 6, triggeredEvent: "instructions-change" }),
      makeTurn({ index: 7, triggeredEvent: "image-change" }),
      makeTurn({ index: 8, triggeredEvent: "reasoning-toggle" }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getByText("model switch")).toBeInTheDocument();
    expect(screen.getByText("tool change")).toBeInTheDocument();
    expect(screen.getByText("/clear")).toBeInTheDocument();
    expect(screen.getByText("/rewind")).toBeInTheDocument();
    expect(screen.getByText("fork")).toBeInTheDocument();
    expect(screen.getByText("cache expiry")).toBeInTheDocument();
    expect(screen.getByText("instructions change")).toBeInTheDocument();
    expect(screen.getByText("image change")).toBeInTheDocument();
    expect(screen.getByText("reasoning toggle")).toBeInTheDocument();
  });

  it("renders the turn's rounds count", () => {
    const turns = [makeTurn({ usage: { ...makeTurn().usage, roundsCount: 4 } })];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows an em dash for rounds count when unknown", () => {
    const turns = [
      makeTurn({ usage: { ...makeTurn().usage, roundsCount: undefined } }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    const rows = screen.getAllByRole("row");
    const roundsCellOf = (row: HTMLElement) => row.querySelectorAll("td")[2].textContent;
    expect(roundsCellOf(rows[1])).toBe("—");
  });

  it("renders the turn's model, muted", () => {
    const turns = [makeTurn({ usage: { ...makeTurn().usage, model: "claude-sonnet-5" } })];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
  });

  it("renders AI Credits without a dollar sign, rounded to 2 decimal places", () => {
    const turns = [
      makeTurn({
        usage: {
          ...makeTurn().usage,
          costAiCredits: { known: true, value: 2.79598 },
        },
      }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    // Single turn, so AI Credits and Cumulative both show "2.80".
    expect(screen.getAllByText("2.80")).toHaveLength(2);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("renders a running cumulative AI Credits total per row", () => {
    const turns = [
      makeTurn({
        index: 0,
        usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 1.5 } },
      }),
      makeTurn({
        index: 1,
        usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 2.25 } },
      }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    const rows = screen.getAllByRole("row");
    // Cumulative is the last cell before Model.
    const cumulativeCellOf = (row: HTMLElement) => {
      const cells = row.querySelectorAll("td");
      return cells[cells.length - 2].textContent;
    };
    expect(cumulativeCellOf(rows[1])).toBe("1.50");
    expect(cumulativeCellOf(rows[2])).toBe("3.75");
  });

  it("shows an em dash for cumulative AI Credits on and after a row whose own cost is unknown", () => {
    const turns = [
      makeTurn({
        index: 0,
        usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 1.5 } },
      }),
      makeTurn({
        index: 1,
        usage: { ...makeTurn().usage, costAiCredits: { known: false, reason: "no data" } },
      }),
      makeTurn({
        index: 2,
        usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 2.25 } },
      }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    const rows = screen.getAllByRole("row");
    const cumulativeCellOf = (row: HTMLElement) => {
      const cells = row.querySelectorAll("td");
      return cells[cells.length - 2].textContent;
    };
    expect(cumulativeCellOf(rows[1])).toBe("1.50");
    expect(cumulativeCellOf(rows[2])).toBe("—");
    expect(cumulativeCellOf(rows[3])).toBe("—");
  });

  it("calls onSelectTurn with the clicked row's array index", () => {
    const onSelectTurn = vi.fn();
    const turns = [makeTurn({ index: 1 }), makeTurn({ index: 2 })];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={onSelectTurn} />);
    const rows = screen.getAllByRole("row");
    fireEvent.click(rows[2]); // header row + turn 0's row + turn 1's row

    expect(onSelectTurn).toHaveBeenCalledWith(1);
  });

  it("calls onSelectTurn when a row is activated via Enter/Space keydown", () => {
    const onSelectTurn = vi.fn();
    const turns = [makeTurn({ index: 1 }), makeTurn({ index: 2 })];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={onSelectTurn} />);
    const rows = screen.getAllByRole("row");
    fireEvent.keyDown(rows[2], { key: "Enter" });

    expect(onSelectTurn).toHaveBeenCalledWith(1);
  });

  it("marks the selected row via aria-selected", () => {
    const turns = [makeTurn({ index: 1 }), makeTurn({ index: 2 })];

    render(<TurnsTable turns={turns} selectedTurnIndex={1} onSelectTurn={() => {}} />);
    const rows = screen.getAllByRole("row");

    expect(rows[1]).toHaveAttribute("aria-selected", "false");
    expect(rows[2]).toHaveAttribute("aria-selected", "true");
  });

  it("shows each turn's tool-call count with a failure badge when calls failed", () => {
    const turns = [
      makeTurn({
        index: 0,
        toolCalls: [
          { name: "Bash", argsSummary: "ls", outcome: { status: "success" } },
          { name: "Bash", argsSummary: "foo", outcome: { status: "error", failureCategory: "command-not-found" } },
          { name: "Bash", argsSummary: "sleep 9", outcome: { status: "interrupted", failureCategory: "timeout" } },
        ],
      }),
      makeTurn({ index: 1, toolCalls: [{ name: "Bash", argsSummary: "ls", outcome: { status: "success" } }] }),
    ];

    render(<TurnsTable turns={turns} selectedTurnIndex={0} onSelectTurn={() => {}} />);

    expect(screen.getByLabelText("2 of 3 tool calls failed")).toHaveTextContent("✕2");
    expect(screen.queryByLabelText(/of 1 tool calls failed/)).not.toBeInTheDocument();
  });
});
