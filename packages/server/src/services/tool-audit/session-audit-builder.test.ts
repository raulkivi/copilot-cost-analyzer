import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  sessionAuditSchema,
  unavailableTokenCount,
  type Session,
  type ToolCallRecord,
  type Turn,
} from "@copilot-cost-analyzer/domain";
import { ClaudeCodeLogProvider } from "../../data-sources/claude-code/claude-code-log-provider.js";
import { computeClaudeCodeFileHash } from "../../data-sources/claude-code/session-id.js";
import { buildSessionAudit } from "./session-audit-builder.js";

const known = (value: number) => ({ known: true as const, value });

function usage(output = 10, input = 100) {
  return {
    uncachedInput: known(input),
    cacheWrite: known(0),
    cacheRead: known(0),
    tool: unavailableTokenCount("n/a"),
    vision: unavailableTokenCount("n/a"),
    reasoning: unavailableTokenCount("n/a"),
    output: known(output),
    costAiCredits: unavailableTokenCount("n/a"),
    model: "m",
  };
}

function turn(index: number, toolCalls: ToolCallRecord[], output = 10): Turn {
  return { index, userMessage: "", assistantResponse: "", toolCalls, usage: usage(output), explanation: "" };
}

function shell(command: string, status: "success" | "error" | "interrupted", extra: Partial<ToolCallRecord> = {}): ToolCallRecord {
  const program = command.split(" ")[0];
  return {
    name: "Bash",
    kind: "shell",
    argsSummary: command,
    shell: { command, program },
    outcome:
      status === "success"
        ? { status }
        : { status, failureCategory: status === "interrupted" ? "timeout" : "command-not-found" },
    roundIndex: 0,
    ...extra,
  };
}

function session(turns: Turn[]): Session {
  return {
    id: "s1",
    mode: "analyze",
    providerId: "claude-code",
    title: "t",
    model: "m",
    turns,
    turnCount: turns.length,
    costAiCredits: unavailableTokenCount("n/a"),
    usageDataAvailable: true,
    startedAt: "2026-09-27T12:00:00.000Z",
  };
}

describe("buildSessionAudit", () => {
  it("counts outcomes and computes the failure rate over known outcomes", () => {
    const audit = buildSessionAudit(
      session([turn(0, [shell("npm test", "success"), shell("foo", "error"), shell("sleep 9", "interrupted")])]),
    );

    expect(audit.totals).toEqual({ toolCalls: 3, succeeded: 1, failed: 1, interrupted: 1, denied: 0, unknown: 0 });
    expect(audit.failureRate).toBeCloseTo(2 / 3);
    expect(() => sessionAuditSchema.parse(audit)).not.toThrow();
  });

  it("treats calls without an outcome as unknown and never reports a fabricated 0% failure rate", () => {
    const audit = buildSessionAudit(session([turn(0, [{ name: "read_file", argsSummary: "" }])]));

    expect(audit.totals.unknown).toBe(1);
    expect(audit.failureRate).toBeNull();
    expect(audit.outcomeCoverage.known).toBe(0);
    expect(audit.outcomeCoverage.unknownReasons[0]).toMatch(/does not record/);
  });

  it("breaks down by tool, shell program and failure category, most frequent first", () => {
    const audit = buildSessionAudit(
      session([
        turn(0, [
          shell("git status", "success"),
          shell("foo", "error"),
          shell("foo", "error"),
          { name: "Read", kind: "file-read", argsSummary: "/x", outcome: { status: "error", failureCategory: "file-not-found" } },
        ]),
      ]),
    );

    expect(audit.byTool).toEqual([
      { name: "Bash", calls: 3, failed: 2 },
      { name: "Read", calls: 1, failed: 1 },
    ]);
    expect(audit.byShellProgram).toEqual([
      { program: "foo", calls: 2, failed: 2 },
      { program: "git", calls: 1, failed: 0 },
    ]);
    expect(audit.byFailureCategory).toEqual([
      { category: "command-not-found", count: 2 },
      { category: "file-not-found", count: 1 },
    ]);
  });

  it("sums tool durations when known", () => {
    const audit = buildSessionAudit(
      session([turn(0, [shell("a", "success", { durationMs: 100 }), shell("a", "success", { durationMs: 50 })])]),
    );
    expect(audit.byTool[0].totalDurationMs).toBe(150);
  });

  it("reports one perTurn row per turn, including turns with no tool calls", () => {
    const audit = buildSessionAudit(session([turn(0, [shell("foo", "error")]), turn(1, [])]));

    expect(audit.perTurn).toEqual([
      { turnIndex: 0, succeeded: 0, failed: 1, interrupted: 0, denied: 0, unknown: 0 },
      { turnIndex: 1, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 0 },
    ]);
  });

  it("detects a retry: the same command re-issued after a failure", () => {
    const audit = buildSessionAudit(
      session([
        turn(0, [shell("npm  test", "error")]),
        turn(1, [shell("npm test", "success"), shell("ls", "success"), shell("ls", "success")]),
      ]),
    );

    expect(audit.retries).toEqual([{ command: "npm test", attempts: 2, eventuallySucceeded: true, turnIndexes: [0, 1] }]);
  });

  it("counts recovery rounds and the exact token totals of affected turns", () => {
    const audit = buildSessionAudit(
      session([
        turn(0, [shell("foo", "error", { roundIndex: 0 }), shell("bar", "error", { roundIndex: 0 }), shell("x", "error", { roundIndex: 1 })], 30),
        turn(1, [shell("ok", "success")], 1000),
      ]),
    );

    expect(audit.failureRecoveryCost).toEqual({
      recoveryRounds: 2,
      affectedTurns: [0],
      affectedTurnsOutputTokens: known(30),
      affectedTurnsInputTokens: known(100),
    });
  });

  it("lists every call with its turn index", () => {
    const audit = buildSessionAudit(session([turn(0, [shell("a", "success")]), turn(1, [shell("b", "error")])]));
    expect(audit.calls.map((c) => [c.turnIndex, c.call.argsSummary])).toEqual([
      [0, "a"],
      [1, "b"],
    ]);
  });
});

describe("buildSessionAudit on the real-capture Claude Code fixture", () => {
  it("reports totals, categories and the retried missing command", async () => {
    const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/claude-code-audit");
    const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "bash-failures-session.jsonl"));
    const fixture = await new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir }).readSession(id);

    const audit = buildSessionAudit(fixture!);

    expect(audit.totals).toEqual({ toolCalls: 13, succeeded: 2, failed: 10, interrupted: 1, denied: 0, unknown: 0 });
    expect(audit.byFailureCategory.find((c) => c.category === "command-not-found")?.count).toBe(2);
    expect(audit.retries).toEqual([
      { command: "definitely-not-installed-tool --version", attempts: 2, eventuallySucceeded: false, turnIndexes: [0, 1] },
    ]);
    expect(() => sessionAuditSchema.parse(audit)).not.toThrow();
  });
});
