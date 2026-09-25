import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigStatus } from "@copilot-cost-analyzer/domain";
import { App } from "./App.js";
import { makeTurn } from "./test-support/turn-fixture.js";

const scenario = {
  id: "cache-basics",
  mode: "learn" as const,
  title: "Cache Basics",
  model: "example-model",
  usageDataAvailable: true,
  turns: [
    makeTurn({ index: 1, explanation: "first turn explanation" }),
    makeTurn({ index: 2, explanation: "second turn explanation" }),
  ],
  turnCount: 2,
  costAiCredits: { known: false as const, reason: "not extracted" },
};

const sessionSummary = {
  id: "session-1",
  mode: "analyze" as const,
  title: "Fix the bug",
  model: "unknown",
  usageDataAvailable: false,
  turns: [],
  turnCount: 0,
  costAiCredits: { known: false as const, reason: "not extracted" },
};

const fullSession = {
  ...sessionSummary,
  turns: [
    makeTurn({
      index: 0,
      explanation: "analyze turn explanation",
      toolCalls: [
        {
          name: "read_file",
          argsSummary: "src/a.ts",
          filesTouched: ["src/a.ts"],
          tokenCount: { known: false, reason: "not recorded" },
        },
      ],
    }),
  ],
  turnCount: 1,
  systemPrompt: [
    {
      kind: "built-in" as const,
      label: "Base system prompt (100 characters)",
      tokenCount: { known: false, reason: "not broken down" },
    },
  ],
  toolInventory: [{ name: "read_file", loaded: true, invokedInTurns: [0] }],
};

// A session whose main.jsonl never parsed (toolInventory empty), but whose
// turn's toolCalls came from SQLite session_files independently — finding
// #4: toolCallsAvailable must not gate solely on toolInventory.
const sessionSummaryNoInventory = {
  id: "session-2",
  mode: "analyze" as const,
  title: "No system-prompt data",
  model: "unknown",
  usageDataAvailable: false,
  turns: [],
  turnCount: 1,
  costAiCredits: { known: false as const, reason: "not extracted" },
};

const fullSessionNoInventory = {
  ...sessionSummaryNoInventory,
  turns: [
    makeTurn({
      index: 0,
      explanation: "no-inventory turn explanation",
      toolCalls: [
        {
          name: "run_in_terminal",
          argsSummary: "",
          tokenCount: { known: false, reason: "not recorded" },
        },
      ],
    }),
  ],
  systemPrompt: [],
  toolInventory: [],
};

const sessionSummaryError = {
  id: "session-error",
  mode: "analyze" as const,
  title: "Broken session",
  model: "unknown",
  usageDataAvailable: false,
  turns: [],
  turnCount: 0,
  costAiCredits: { known: false as const, reason: "not extracted" },
};

const cleanConfigStatus = {
  checkedAt: "2026-08-08T00:00:00.000Z",
  vscodeUserSettingsPath: "/home/user/.config/Code/User/settings.json",
  loggingEnabled: true,
  maxRetainedSessionLogs: 200,
  minRetainedSessionLogsThreshold: 200,
  warnings: [],
};

let configStatus: ConfigStatus = cleanConfigStatus;
let logProviderStatus = {
  providers: [
    { id: "vscode", label: "VS Code", available: true },
    { id: "mitmproxy", label: "mitmproxy", available: true },
  ],
  activeProviderId: "vscode",
};

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  if (url === "/api/health") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ status: "ok", version: "0.1.0" }),
    });
  }
  if (url === "/api/learn/scenarios") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve([scenario]) });
  }
  if (url === "/api/log-providers") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(logProviderStatus) });
  }
  if (url === "/api/log-providers/active") {
    const { id } = JSON.parse(init?.body ?? "{}") as { id: string };
    logProviderStatus = { ...logProviderStatus, activeProviderId: id };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(logProviderStatus) });
  }
  if (url === "/api/sessions") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([sessionSummary, sessionSummaryNoInventory, sessionSummaryError]),
    });
  }
  if (url === "/api/sessions/session-1") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(fullSession) });
  }
  if (url === "/api/sessions/session-2") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(fullSessionNoInventory) });
  }
  if (url === "/api/sessions/session-error") {
    return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) });
  }
  if (url === "/api/config/status") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(configStatus) });
  }
  if (url === "/api/config/retention-threshold") {
    const { value } = JSON.parse(init?.body ?? "{}") as { value: number };
    const warnings =
      value > (configStatus.maxRetainedSessionLogs ?? 0)
        ? [
            {
              code: "retention-too-low" as const,
              severity: "required" as const,
              settingId: "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
              currentValue: configStatus.maxRetainedSessionLogs,
              recommendedValue: value,
              message: `Only the last ${configStatus.maxRetainedSessionLogs} sessions' logs are retained on disk.`,
              helpSteps: [`Set maxRetainedSessionLogs to ${value} in settings.json`],
            },
          ]
        : [];
    configStatus = { ...configStatus, minRetainedSessionLogsThreshold: value, warnings };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(configStatus) });
  }
  return Promise.reject(new Error(`Unhandled fetch url in test: ${url}`));
}

function switchToAnalyze() {
  fireEvent.click(screen.getByLabelText("Analyze"));
}

describe("App", () => {
  beforeEach(() => {
    configStatus = cleanConfigStatus;
    logProviderStatus = {
      providers: [
        { id: "vscode", label: "VS Code", available: true },
        { id: "mitmproxy", label: "mitmproxy", available: true },
      ],
      activeProviderId: "vscode",
    };
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a successful health check from the server, including the app version", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText(/status: ok/i)).toBeInTheDocument());
    expect(screen.getByText(/v0\.1\.0/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/health");
  });

  it("lets the user pick a learn scenario and renders the shared layout", async () => {
    render(<App />);

    const scenarioCard = await screen.findByRole("button", { name: "Cache Basics" });
    fireEvent.click(scenarioCard);

    expect(await screen.findByText("first turn explanation")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 turns
  });

  it("moving the scrubber updates both the turns table selection and the explanation panel", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Cache Basics" }));
    await screen.findByText("first turn explanation");

    fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });

    expect(await screen.findByText("second turn explanation")).toBeInTheDocument();
    expect(screen.getAllByRole("row")[2]).toHaveAttribute("aria-selected", "true");
  });

  it("switching to Analyze mode shows the sessions list instead of scenarios", async () => {
    render(<App />);

    await screen.findByRole("button", { name: "Cache Basics" });
    switchToAnalyze();

    expect(await screen.findByRole("button", { name: "Fix the bug" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cache Basics" })).not.toBeInTheDocument();
  });

  it("selecting a different log provider clears the selected session and refetches the session list", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    const providerSelect = await screen.findByLabelText("Log provider");
    const fetchCallsBefore = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;

    fireEvent.change(providerSelect, { target: { value: "mitmproxy" } });

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/log-providers/active",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    await waitFor(() => {
      const fetchCallsAfter = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
      expect(fetchCallsAfter).toBeGreaterThan(fetchCallsBefore);
    });
    expect(screen.queryByText("analyze turn explanation")).not.toBeInTheDocument();
  });

  it("does not render a provider select in Learn mode", async () => {
    render(<App />);

    await screen.findByRole("button", { name: "Cache Basics" });

    expect(screen.queryByLabelText("Log provider")).not.toBeInTheDocument();
  });

  it("lets the user pick a real Analyze session and renders the shared layout", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));

    expect(await screen.findByText("analyze turn explanation")).toBeInTheDocument();
  });

  it("folds tool-call detail for the selected turn into the Explanation tab in Analyze mode", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
  });

  it("shows a visible error message instead of failing silently when fetching a session fails", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    fireEvent.click(await screen.findByRole("button", { name: "Broken session" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed/i);
  });

  it("shows only the most-recently-selected session when an earlier session's fetch resolves after a later one", async () => {
    let resolveFirst: () => void = () => {};
    let resolveSecond: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/sessions/session-1") {
          return firstGate.then(() => ({ ok: true, json: () => Promise.resolve(fullSession) }));
        }
        if (url === "/api/sessions/session-2") {
          return secondGate.then(() => ({
            ok: true,
            json: () => Promise.resolve(fullSessionNoInventory),
          }));
        }
        return fakeFetch(url);
      }),
    );

    render(<App />);
    switchToAnalyze();

    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    fireEvent.click(await screen.findByRole("button", { name: "No system-prompt data" }));

    // Resolve out of order: the earlier click's request (session-1) settles
    // last, after the later click's request (session-2) already settled.
    await act(async () => {
      resolveSecond();
      await Promise.resolve();
    });
    await screen.findByText("no-inventory turn explanation");

    await act(async () => {
      resolveFirst();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText("no-inventory turn explanation")).toBeInTheDocument();
    expect(screen.queryByText("analyze turn explanation")).not.toBeInTheDocument();
  });

  it("renders tool-call detail from the turn's own toolCalls even when the session's toolInventory is empty", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "No system-prompt data" }));
    await screen.findByText("no-inventory turn explanation");

    expect(screen.getByText("run_in_terminal")).toBeInTheDocument();
    expect(screen.queryByText("Tool-call detail unavailable for this session.")).not.toBeInTheDocument();
  });

  it("renders the system prompt breakdown when that tab is selected", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    fireEvent.click(screen.getByLabelText("System prompt"));

    expect(screen.getByText("Base system prompt (100 characters)")).toBeInTheDocument();
  });

  it("renders the tool inventory when that tab is selected", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    fireEvent.click(screen.getByLabelText("Tools"));

    expect(screen.getByText("Tools: loaded vs. used")).toBeInTheDocument();
    expect(screen.getAllByText("read_file").length).toBeGreaterThan(0);
  });

  it("does not render a tab switcher or Analyze-only panels for a Learn scenario", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Cache Basics" }));
    await screen.findByText("first turn explanation");

    expect(screen.queryByLabelText("System prompt")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tools")).not.toBeInTheDocument();
    expect(screen.queryByText(/system prompt breakdown/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tools: loaded vs\. used/i)).not.toBeInTheDocument();
  });

  it("renders the config warning banner when prerequisites aren't met", async () => {
    configStatus = {
      ...cleanConfigStatus,
      loggingEnabled: false,
      maxRetainedSessionLogs: null,
      warnings: [
        {
          code: "retention-too-low",
          settingId: "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
          currentValue: 50,
          recommendedValue: 200,
          message: "Only the last 50 sessions' logs are retained on disk.",
          helpSteps: ["Set maxRetainedSessionLogs to 200 in settings.json"],
        },
      ],
    };
    render(<App />);

    expect(
      await screen.findByText("Only the last 50 sessions' logs are retained on disk."),
    ).toBeInTheDocument();
  });

  it("shows the fetched retention threshold in the header on load", async () => {
    configStatus = { ...cleanConfigStatus, minRetainedSessionLogsThreshold: 300 };
    render(<App />);

    expect(await screen.findByLabelText("Retention threshold")).toHaveValue(300);
  });

  it("changing the retention threshold triggers the PUT and updates the header and warning state", async () => {
    configStatus = { ...cleanConfigStatus, maxRetainedSessionLogs: 250, warnings: [] };
    render(<App />);

    const input = await screen.findByLabelText("Retention threshold");
    expect(input).toHaveValue(200);
    expect(screen.queryByText(/sessions' logs are retained on disk/)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "300" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/config/retention-threshold",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ value: 300 }) }),
      ),
    );
    expect(await screen.findByLabelText("Retention threshold")).toHaveValue(300);
    expect(
      await screen.findByText("Only the last 250 sessions' logs are retained on disk."),
    ).toBeInTheDocument();
  });

  it("dismisses the config warning banner via its Dismiss button and can reopen it via the Config button", async () => {
    configStatus = {
      ...cleanConfigStatus,
      warnings: [
        {
          code: "retention-too-low",
          settingId: "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
          currentValue: 50,
          recommendedValue: 200,
          message: "Only the last 50 sessions' logs are retained on disk.",
          helpSteps: ["Set maxRetainedSessionLogs to 200 in settings.json"],
        },
      ],
    };
    render(<App />);

    await screen.findByText("Only the last 50 sessions' logs are retained on disk.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Config" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows a static Config ✓ tag instead of a button when there are no warnings", async () => {
    render(<App />);

    expect(await screen.findByText("Config ✓")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Config" })).not.toBeInTheDocument();
  });

  it("lets the user select sessions for an AI advice bundle, open the export dialog, and copy it", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Fix the bug/ }));

    expect(await screen.findByText("1 session selected for advice")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export advice" }));

    expect(screen.getByText("Export advice bundle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy advice prompt" })).toBeInTheDocument();
  });

  it("uses the fully-fetched session detail (turns, system prompt) for the advice bundle, not the lightweight list summary", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    fireEvent.click(screen.getByRole("checkbox", { name: /Fix the bug/ }));
    fireEvent.click(screen.getByRole("button", { name: "Export advice" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview", exact: true }));

    expect(screen.getByTestId("advice-preview")).toHaveTextContent("Base system prompt (100 characters)");
  });

  it("clears the advice selection when switching modes", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("checkbox", { name: /Cache Basics/ }));
    expect(await screen.findByText("1 session selected for advice")).toBeInTheDocument();

    switchToAnalyze();

    await screen.findByRole("button", { name: "Fix the bug" });
    expect(screen.queryByText(/selected for advice/)).not.toBeInTheDocument();
  });
});
