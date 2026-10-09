import { unavailableTokenCount, type Session, type ToolCallRecord } from "@copilot-cost-analyzer/domain";
import type { LogProvider } from "../data-sources/log-providers/log-provider.js";
import { UnknownLogProviderIdError } from "../data-sources/log-providers/registry.js";
import type { ProviderLookup } from "../services/tool-audit/audit-query-service.js";
import { parseShellCommand } from "../services/tool-audit/shell-command-parser.js";

// In-memory LogProvider + session builders for tool-audit tests (query
// service, MCP server) — no filesystem, so each test states its own data.
export function shell(command: string, status: "success" | "error", category?: "command-not-found" | "wrong-directory"): ToolCallRecord {
  return {
    name: "Bash",
    kind: "shell",
    argsSummary: command,
    shell: { command, program: parseShellCommand(command).program },
    outcome: status === "success" ? { status } : { status, failureCategory: category ?? "command-not-found" },
    startedAt: "2026-09-27T10:00:00.000Z",
  };
}

export function session(id: string, startedAt: string, toolCalls: ToolCallRecord[][]): Session {
  return {
    id,
    mode: "analyze",
    providerId: "fake",
    title: `Session ${id}`,
    model: "m",
    turns: toolCalls.map((calls, index) => ({
      index,
      userMessage: "",
      assistantResponse: "",
      toolCalls: calls,
      usage: {
        uncachedInput: { known: true, value: 1 },
        cacheWrite: { known: true, value: 0 },
        cacheRead: { known: true, value: 0 },
        tool: unavailableTokenCount("x"),
        vision: unavailableTokenCount("x"),
        reasoning: unavailableTokenCount("x"),
        output: { known: true, value: 1 },
        costAiCredits: unavailableTokenCount("x"),
        model: "m",
      },
      explanation: "",
    })),
    turnCount: toolCalls.length,
    costAiCredits: unavailableTokenCount("x"),
    usageDataAvailable: true,
    startedAt,
  };
}

export class FakeProvider implements LogProvider {
  readonly label = "Fake";
  reads = 0;
  constructor(
    readonly id: string,
    private readonly sessions: Session[],
  ) {}
  async checkAvailability() {
    return { available: true };
  }
  async listSessions() {
    return this.sessions.map((s) => ({ ...s, turns: [] }));
  }
  async readSession(id: string) {
    this.reads += 1;
    return this.sessions.find((s) => s.id === id) ?? null;
  }
  async readTurnDetail() {
    return null;
  }
}

export const sampleSessions = [
  session("old", "2026-09-01T08:00:00.000Z", [[shell("foo", "error")]]),
  session("mid", "2026-09-20T08:00:00.000Z", [[shell("ls", "success"), shell("cd x && ls", "error", "wrong-directory")]]),
  session("new", "2026-09-27T08:00:00.000Z", [[shell("foo", "error")], [shell("npm test", "success")]]),
];

export function lookup(provider: LogProvider, other?: LogProvider): ProviderLookup {
  return {
    getActiveProvider: () => provider,
    getProvider: (id: string) => {
      if (id === provider.id) return provider;
      if (other && id === other.id) return other;
      throw new UnknownLogProviderIdError(id);
    },
  };
}

