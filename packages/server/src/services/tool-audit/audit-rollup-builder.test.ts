import { describe, expect, it } from "vitest";
import { auditRollupSchema, unavailableTokenCount, type SessionAudit, type ToolCallRecord } from "@copilot-cost-analyzer/domain";
import { buildAuditRollup } from "./audit-rollup-builder.js";

function call(command: string, status: "success" | "error", startedAt: string, category?: "command-not-found"): ToolCallRecord {
  return {
    name: "Bash",
    kind: "shell",
    argsSummary: command,
    shell: { command, program: command.split(" ")[0] },
    startedAt,
    outcome: status === "success" ? { status } : { status, failureCategory: category ?? "command-not-found" },
  };
}

function audit(sessionId: string, calls: ToolCallRecord[], unknown = 0): SessionAudit {
  const failed = calls.filter((c) => c.outcome?.status === "error").length;
  return {
    sessionId,
    title: `Session ${sessionId}`,
    startedAt: "2026-09-26T10:00:00.000Z",
    totals: { toolCalls: calls.length + unknown, succeeded: calls.length - failed, failed, interrupted: 0, denied: 0, unknown },
    failureRate: calls.length ? failed / calls.length : null,
    byTool: [{ name: "Bash", calls: calls.length, failed }],
    byShellProgram: [{ program: "foo", calls: failed, failed }],
    byFailureCategory: failed ? [{ category: "command-not-found", count: failed }] : [],
    perTurn: [],
    calls: calls.map((c) => ({ turnIndex: 0, call: c })),
    retries: [],
    failureRecoveryCost: {
      recoveryRounds: 0,
      affectedTurns: [],
      affectedTurnsOutputTokens: unavailableTokenCount("x"),
      affectedTurnsInputTokens: unavailableTokenCount("x"),
    },
    outcomeCoverage: { known: calls.length, unknown, unknownReasons: unknown ? ["no outcomes"] : [] },
  };
}

describe("buildAuditRollup", () => {
  const audits = [
    audit("a", [call("foo --v", "error", "2026-09-26T10:00:00Z"), call("git status", "success", "2026-09-26T11:00:00Z")]),
    audit("b", [call("foo --v", "error", "2026-09-27T09:00:00Z"), call("foo --v", "error", "2026-09-27T09:05:00Z")], 1),
  ];

  it("sums totals and recomputes the failure rate over known outcomes", () => {
    const rollup = buildAuditRollup(audits, { providerId: "claude-code" });

    expect(rollup.sessionCount).toBe(2);
    expect(rollup.totals).toEqual({ toolCalls: 5, succeeded: 1, failed: 3, interrupted: 0, denied: 0, unknown: 1 });
    expect(rollup.failureRate).toBeCloseTo(3 / 4);
    expect(rollup.outcomeCoverage).toEqual({ known: 4, unknown: 1, unknownReasons: ["no outcomes"] });
    expect(() => auditRollupSchema.parse(rollup)).not.toThrow();
  });

  it("ranks the top failing commands with the number of sessions they failed in", () => {
    const rollup = buildAuditRollup(audits, {});

    expect(rollup.topFailingCommands).toEqual([
      { command: "foo --v", program: "foo", failures: 3, sessions: 2, failureCategory: "command-not-found" },
    ]);
  });

  it("buckets calls per day", () => {
    expect(buildAuditRollup(audits, {}).daily).toEqual([
      { date: "2026-09-26", toolCalls: 2, failed: 1 },
      { date: "2026-09-27", toolCalls: 2, failed: 2 },
    ]);
  });

  it("merges per-program and per-category breakdowns", () => {
    const rollup = buildAuditRollup(audits, {});
    expect(rollup.byShellProgram).toEqual([{ program: "foo", calls: 3, failed: 3 }]);
    expect(rollup.byFailureCategory).toEqual([{ category: "command-not-found", count: 3 }]);
  });

  it("summarizes each session", () => {
    expect(buildAuditRollup(audits, {}).sessions.map((s) => [s.sessionId, s.toolCalls, s.failed])).toEqual([
      ["a", 2, 1],
      ["b", 3, 2],
    ]);
  });

  it("handles no sessions", () => {
    const rollup = buildAuditRollup([], {});
    expect(rollup.failureRate).toBeNull();
    expect(rollup.sessionCount).toBe(0);
  });
});
