import { describe, expect, it } from "vitest";
import { auditRollupSchema, sessionAuditSchema } from "./session-audit.js";

const totals = { toolCalls: 3, succeeded: 1, failed: 1, interrupted: 1, denied: 0, unknown: 0 };

function sampleAudit() {
  return {
    sessionId: "s1",
    providerId: "claude-code",
    title: "Bash failures",
    totals,
    failureRate: 2 / 3,
    byTool: [{ name: "Bash", calls: 3, failed: 2, totalDurationMs: 300 }],
    byShellProgram: [{ program: "npm", calls: 3, failed: 2 }],
    byFailureCategory: [{ category: "timeout", count: 1 }],
    perTurn: [{ turnIndex: 0, succeeded: 1, failed: 1, interrupted: 1, denied: 0, unknown: 0 }],
    calls: [{ turnIndex: 0, call: { name: "Bash", argsSummary: "npm test", outcome: { status: "success" } } }],
    retries: [{ command: "npm test", attempts: 2, eventuallySucceeded: true, turnIndexes: [0] }],
    failureRecoveryCost: {
      recoveryRounds: 1,
      affectedTurns: [0],
      affectedTurnsOutputTokens: { known: true, value: 40 },
      affectedTurnsInputTokens: { known: false, reason: "no usage" },
    },
    outcomeCoverage: { known: 3, unknown: 0, unknownReasons: [] },
  };
}

describe("sessionAuditSchema", () => {
  it("accepts a full session audit", () => {
    expect(sessionAuditSchema.parse(sampleAudit())).toEqual(sampleAudit());
  });

  it("accepts a null failure rate when no outcome is known", () => {
    expect(sessionAuditSchema.parse({ ...sampleAudit(), failureRate: null }).failureRate).toBeNull();
  });

  it("rejects a failure rate outside 0..1", () => {
    expect(() => sessionAuditSchema.parse({ ...sampleAudit(), failureRate: 1.5 })).toThrow();
  });
});

describe("auditRollupSchema", () => {
  it("accepts a cross-session rollup", () => {
    const rollup = {
      providerId: "claude-code",
      since: "2026-09-01",
      sessionCount: 2,
      totals,
      failureRate: 0.5,
      byTool: [],
      byShellProgram: [],
      byFailureCategory: [{ category: "command-not-found", count: 2 }],
      topFailingCommands: [
        { command: "foo --version", program: "foo", failures: 2, sessions: 1, failureCategory: "command-not-found" },
      ],
      daily: [{ date: "2026-09-27", toolCalls: 3, failed: 2 }],
      sessions: [{ sessionId: "s1", title: "t", startedAt: "2026-09-27T12:00:00Z", toolCalls: 3, failed: 2 }],
      outcomeCoverage: { known: 3, unknown: 0, unknownReasons: [] },
    };
    expect(auditRollupSchema.parse(rollup)).toEqual(rollup);
  });
});
