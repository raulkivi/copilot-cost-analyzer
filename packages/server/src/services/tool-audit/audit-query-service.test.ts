import { describe, expect, it } from "vitest";
import { unavailableTokenCount, type Session, type ToolCallRecord } from "@copilot-cost-analyzer/domain";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { UnknownLogProviderIdError } from "../../data-sources/log-providers/registry.js";
import { AuditQueryService, type ProviderLookup } from "./audit-query-service.js";
import { parseShellCommand } from "./shell-command-parser.js";

function shell(command: string, status: "success" | "error", category?: "command-not-found" | "wrong-directory"): ToolCallRecord {
  return {
    name: "Bash",
    kind: "shell",
    argsSummary: command,
    shell: { command, program: parseShellCommand(command).program },
    outcome: status === "success" ? { status } : { status, failureCategory: category ?? "command-not-found" },
    startedAt: "2026-09-27T10:00:00.000Z",
  };
}

function session(id: string, startedAt: string, toolCalls: ToolCallRecord[][]): Session {
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

class FakeProvider implements LogProvider {
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

const sessions = [
  session("old", "2026-09-01T08:00:00.000Z", [[shell("foo", "error")]]),
  session("mid", "2026-09-20T08:00:00.000Z", [[shell("ls", "success"), shell("cd x && ls", "error", "wrong-directory")]]),
  session("new", "2026-09-27T08:00:00.000Z", [[shell("foo", "error")], [shell("npm test", "success")]]),
];

function lookup(provider: LogProvider, other?: LogProvider): ProviderLookup {
  return {
    getActiveProvider: () => provider,
    getProvider: (id: string) => {
      if (id === provider.id) return provider;
      if (other && id === other.id) return other;
      throw new UnknownLogProviderIdError(id);
    },
  };
}

describe("AuditQueryService", () => {
  it("lists sessions most recent first, filtered by date range and limit", async () => {
    const service = new AuditQueryService(lookup(new FakeProvider("fake", sessions)));

    expect((await service.listSessions({})).map((s) => s.id)).toEqual(["new", "mid", "old"]);
    expect((await service.listSessions({ since: "2026-09-15" })).map((s) => s.id)).toEqual(["new", "mid"]);
    expect((await service.listSessions({ until: "2026-09-20" })).map((s) => s.id)).toEqual(["mid", "old"]);
    expect((await service.listSessions({ limit: 1 })).map((s) => s.id)).toEqual(["new"]);
  });

  it("reads through a named provider instead of the active one", async () => {
    const other = new FakeProvider("other", [session("x", "2026-09-27T00:00:00Z", [])]);
    const service = new AuditQueryService(lookup(new FakeProvider("fake", sessions), other));

    expect((await service.listSessions({ providerId: "other" })).map((s) => s.id)).toEqual(["x"]);
  });

  it("returns a session audit, or null for an unknown session", async () => {
    const service = new AuditQueryService(lookup(new FakeProvider("fake", sessions)));

    expect((await service.getSessionAudit("new"))?.totals.failed).toBe(1);
    expect(await service.getSessionAudit("missing")).toBeNull();
  });

  it("filters a session's tool calls by status, category, tool, program and turn", async () => {
    const service = new AuditQueryService(lookup(new FakeProvider("fake", sessions)));

    const failed = await service.listToolCalls("mid", { status: ["error"] });
    expect(failed?.total).toBe(1);
    expect(failed?.calls[0].call.outcome?.failureCategory).toBe("wrong-directory");

    expect((await service.listToolCalls("mid", { failureCategory: ["command-not-found"] }))?.total).toBe(0);
    expect((await service.listToolCalls("mid", { program: "ls" }))?.total).toBe(2);
    expect((await service.listToolCalls("new", { turnIndex: 1 }))?.calls.map((c) => c.call.argsSummary)).toEqual(["npm test"]);
    expect((await service.listToolCalls("new", { tool: "Read" }))?.total).toBe(0);
    expect((await service.listToolCalls("new", { limit: 1 }))?.calls).toHaveLength(1);
    expect((await service.listToolCalls("new", { limit: 1 }))?.total).toBe(2);
    expect(await service.listToolCalls("missing", {})).toBeNull();
  });

  it("builds a rollup over the most recent sessions in range", async () => {
    const provider = new FakeProvider("fake", sessions);
    const service = new AuditQueryService(lookup(provider));

    const rollup = await service.getRollup({ since: "2026-09-15" });

    expect(rollup.providerId).toBe("fake");
    expect(rollup.sessionCount).toBe(2);
    expect(rollup.totals.failed).toBe(2);
    expect(rollup.topFailingCommands.map((c) => c.command)).toEqual(["cd x && ls", "foo"]);
    expect(provider.reads).toBe(2);
  });

  it("caps the rollup's session count", async () => {
    const service = new AuditQueryService(lookup(new FakeProvider("fake", sessions)));
    expect((await service.getRollup({ limit: 1 })).sessionCount).toBe(1);
  });
});
