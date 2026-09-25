import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TurnInspectorDetail } from "@copilot-cost-analyzer/domain";
import { TurnInspector } from "./TurnInspector.js";

const TWO_ROUND_DETAIL: TurnInspectorDetail = {
  turnIndex: 3,
  userMessage: [{ kind: "text", text: "Fix the flaky test." }],
  rounds: [
    {
      request: {
        index: 0,
        addedMessages: [
          { kind: "text", text: "system: you are an agent" },
          { placeholder: true, kind: "file", sizeBytes: 7168 },
        ],
        toolCalls: [
          {
            name: "read_file",
            args: [{ kind: "text", text: "src/foo.ts" }],
            result: [{ placeholder: true, kind: "file", path: "src/foo.ts", sizeBytes: 14540 }],
          },
        ],
      },
      response: {
        index: 0,
        response: [{ kind: "text", text: "I read the file." }],
        reasoning: [{ kind: "text", text: "Let me check the file first." }],
      },
    },
    {
      request: { index: 1, addedMessages: [{ kind: "text", text: "tool result" }], toolCalls: [] },
      response: { index: 1, response: [{ kind: "text", text: "Done." }] },
    },
  ],
};

const ONE_ROUND_DETAIL: TurnInspectorDetail = {
  turnIndex: 0,
  userMessage: [{ kind: "text", text: "What does this do?" }],
  rounds: [
    {
      request: { index: 0, addedMessages: [], toolCalls: [] },
      response: { index: 0, response: [{ kind: "text", text: "It does the thing." }] },
    },
  ],
};

const ENCRYPTED_REASONING_DETAIL: TurnInspectorDetail = {
  turnIndex: 0,
  userMessage: [],
  rounds: [
    {
      request: { index: 0, addedMessages: [], toolCalls: [] },
      response: {
        index: 0,
        response: [{ kind: "text", text: "Working on it." }],
        reasoning: [{ kind: "text", text: "[encrypted]" }],
      },
    },
  ],
};

const JSON_PAYLOAD_DETAIL: TurnInspectorDetail = {
  turnIndex: 0,
  userMessage: [],
  rounds: [
    {
      request: { index: 0, addedMessages: [], toolCalls: [] },
      response: {
        index: 0,
        response: [
          {
            kind: "text",
            text: '{"type":"tool_call","name":"read_file","arguments":"{\\"filePath\\":\\"src/foo.ts\\"}"}',
          },
        ],
      },
    },
  ],
};

function stubFetchJson(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) }),
  );
}

describe("TurnInspector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a loading state, then round 0's card pair once the fetch resolves", async () => {
    stubFetchJson(TWO_ROUND_DETAIL);

    render(
      <TurnInspector
        sessionId="session-1"
        turnIndex={3}
        usageDataAvailable={true}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    expect(await screen.findByText("Request · round 0")).toBeInTheDocument();
    expect(screen.getByText("Response · round 0")).toBeInTheDocument();
    expect(screen.queryByText("Request · round 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Response · round 1")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/sessions/session-1/turns/3");
  });

  it("switches rounds via the round selector without refetching", async () => {
    stubFetchJson(TWO_ROUND_DETAIL);

    render(
      <TurnInspector sessionId="session-1" turnIndex={3} usageDataAvailable={true} onClose={() => {}} />,
    );
    await screen.findByText("Request · round 0");

    expect(screen.getByText("2 rounds in this turn")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Round 1" }));

    expect(screen.getByText("Request · round 1")).toBeInTheDocument();
    expect(screen.getByText("Response · round 1")).toBeInTheDocument();
    expect(screen.queryByText("Request · round 0")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("hides the round selector when the turn made only one round-trip", async () => {
    stubFetchJson(ONE_ROUND_DETAIL);

    render(
      <TurnInspector sessionId="session-1" turnIndex={0} usageDataAvailable={true} onClose={() => {}} />,
    );
    await screen.findByText("Request · round 0");

    expect(screen.queryByText(/round in this turn/)).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Round 0" })).not.toBeInTheDocument();
  });

  it("shows a header with the 1-indexed turn number, trigger tag, session title, and back button", async () => {
    stubFetchJson(TWO_ROUND_DETAIL);

    render(
      <TurnInspector
        sessionId="session-1"
        turnIndex={3}
        sessionTitle="Phase 9.5 build"
        triggeredEvent="compaction"
        usageDataAvailable={true}
        onClose={() => {}}
      />,
    );
    await screen.findByText("Request · round 0");

    expect(screen.getByText("Turn 4 inspector")).toBeInTheDocument();
    expect(screen.getByText("Phase 9.5 build")).toBeInTheDocument();
    expect(screen.getByText("compaction")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to session/i })).toBeInTheDocument();
  });

  it("shows a Pretty/Raw format control in the header", async () => {
    stubFetchJson(TWO_ROUND_DETAIL);

    render(
      <TurnInspector sessionId="session-1" turnIndex={3} usageDataAvailable={true} onClose={() => {}} />,
    );
    await screen.findByText("Request · round 0");

    expect(screen.getByRole("radio", { name: "Pretty" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Raw" })).toBeInTheDocument();
  });

  it("shows the turn's originating user message above the rounds", async () => {
    stubFetchJson(TWO_ROUND_DETAIL);

    render(
      <TurnInspector sessionId="session-1" turnIndex={3} usageDataAvailable={true} onClose={() => {}} />,
    );
    await screen.findByText("Request · round 0");

    expect(screen.getByText("User message")).toBeInTheDocument();
    expect(screen.getByText("Fix the flaky test.")).toBeInTheDocument();
  });

  it("labels a tool call's args and result sub-sections", async () => {
    stubFetchJson(TWO_ROUND_DETAIL);

    render(
      <TurnInspector sessionId="session-1" turnIndex={3} usageDataAvailable={true} onClose={() => {}} />,
    );
    await screen.findByText("Request · round 0");

    expect(screen.getByText("Args")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("renders attachment chips without emoji, falling back to size-only when there's no path", async () => {
    stubFetchJson(TWO_ROUND_DETAIL);

    const { container } = render(
      <TurnInspector sessionId="session-1" turnIndex={3} usageDataAvailable={true} onClose={() => {}} />,
    );
    await screen.findByText("Request · round 0");

    expect(container.textContent).not.toMatch(/🖼️|📄/);
    expect(screen.getAllByText(/src\/foo\.ts/).length).toBeGreaterThan(0);
    expect(screen.getByText(/14\.2 KB/)).toBeInTheDocument();
    expect(screen.getByText("7.0 KB")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/undefined/);
  });

  it("shows reasoning inline under the response when present, with no toggle needed", async () => {
    stubFetchJson(TWO_ROUND_DETAIL);

    render(
      <TurnInspector sessionId="session-1" turnIndex={3} usageDataAvailable={true} onClose={() => {}} />,
    );
    await screen.findByText("Request · round 0");

    expect(screen.getByText("Let me check the file first.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reasoning/i })).not.toBeInTheDocument();
  });

  it("renders encrypted reasoning as a labeled state, not the literal string", async () => {
    stubFetchJson(ENCRYPTED_REASONING_DETAIL);

    const { container } = render(
      <TurnInspector sessionId="session-1" turnIndex={0} usageDataAvailable={true} onClose={() => {}} />,
    );
    await screen.findByText("Request · round 0");

    expect(screen.getByText("encrypted")).toBeInTheDocument();
    expect(screen.getByText(/withheld by the provider/i)).toBeInTheDocument();
    expect(container.querySelector("pre")?.textContent).not.toContain("[encrypted]");
  });

  it("pretty-prints JSON payloads by default, and shows the raw bytes when Raw is selected", async () => {
    stubFetchJson(JSON_PAYLOAD_DETAIL);

    const { container } = render(
      <TurnInspector sessionId="session-1" turnIndex={0} usageDataAvailable={true} onClose={() => {}} />,
    );
    await screen.findByText("Request · round 0");

    expect(container.textContent).toContain('"filePath": "src/foo.ts"');

    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));

    expect(container.textContent).toContain(
      '{"type":"tool_call","name":"read_file","arguments":"{\\"filePath\\":\\"src/foo.ts\\"}"}',
    );
  });

  it("shows the actionable logging-disabled message, without fetching, when the session has no usage data at all", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <TurnInspector sessionId="session-1" turnIndex={0} usageDataAvailable={false} onClose={() => {}} />,
    );

    expect(screen.getByText(/enable agentDebugLog\.fileLogging\.enabled/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the no-round-trip message when usage data exists but this turn made no request", async () => {
    stubFetchJson({ turnIndex: 0, userMessage: [], rounds: [] });

    render(
      <TurnInspector sessionId="session-1" turnIndex={0} usageDataAvailable={true} onClose={() => {}} />,
    );

    expect(await screen.findByText(/made no request to the model/i)).toBeInTheDocument();
  });

  it("calls onClose when the back button is activated", async () => {
    stubFetchJson(TWO_ROUND_DETAIL);
    const onClose = vi.fn();

    render(
      <TurnInspector sessionId="session-1" turnIndex={3} usageDataAvailable={true} onClose={onClose} />,
    );
    await screen.findByText("Request · round 0");

    fireEvent.click(screen.getByRole("button", { name: /back to session/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
