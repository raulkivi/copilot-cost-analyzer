import type { AuditRollup, SessionAudit, ToolCallRecord } from "@copilot-cost-analyzer/domain";

function bash(command: string, program: string, outcome: ToolCallRecord["outcome"]): ToolCallRecord {
  return { name: "Bash", kind: "shell", argsSummary: command, shell: { command, program }, outcome };
}

// Mirrors the server's real-capture Claude Code fixture in shape (a few of
// its calls), so UI tests exercise realistic categories and evidence.
export function makeSessionAudit(overrides: Partial<SessionAudit> = {}): SessionAudit {
  return {
    sessionId: "s1",
    providerId: "claude-code",
    title: "Bash failure audit",
    totals: { toolCalls: 4, succeeded: 1, failed: 2, interrupted: 1, denied: 0, unknown: 0 },
    failureRate: 0.75,
    byTool: [{ name: "Bash", calls: 4, failed: 3, totalDurationMs: 4200 }],
    byShellProgram: [
      { program: "definitely-not-installed-tool", calls: 2, failed: 2 },
      { program: "sleep", calls: 1, failed: 1 },
      { program: "ls", calls: 1, failed: 0 },
    ],
    byFailureCategory: [
      { category: "command-not-found", count: 2 },
      { category: "timeout", count: 1 },
    ],
    perTurn: [
      { turnIndex: 0, succeeded: 1, failed: 1, interrupted: 0, denied: 0, unknown: 0 },
      { turnIndex: 1, succeeded: 0, failed: 1, interrupted: 1, denied: 0, unknown: 0 },
    ],
    calls: [
      { turnIndex: 0, call: bash("ls", "ls", { status: "success" }) },
      {
        turnIndex: 0,
        call: bash("definitely-not-installed-tool --version", "definitely-not-installed-tool", {
          status: "error",
          exitCode: 127,
          failureCategory: "command-not-found",
          classificationEvidence: {
            ruleId: "text.command-not-found",
            excerpt: "/bin/bash: line 1: definitely-not-installed-tool: command not found",
          },
        }),
      },
      {
        turnIndex: 1,
        call: bash("sleep 8", "sleep", {
          status: "interrupted",
          exitCode: 143,
          failureCategory: "timeout",
          classificationEvidence: { ruleId: "text.timeout", excerpt: "Command timed out after 2s" },
        }),
      },
      {
        turnIndex: 1,
        call: bash("definitely-not-installed-tool --version", "definitely-not-installed-tool", {
          status: "error",
          exitCode: 127,
          failureCategory: "command-not-found",
          classificationEvidence: { ruleId: "text.command-not-found", excerpt: "command not found" },
        }),
      },
    ],
    retries: [
      { command: "definitely-not-installed-tool --version", attempts: 2, eventuallySucceeded: false, turnIndexes: [0, 1] },
    ],
    failureRecoveryCost: {
      recoveryRounds: 3,
      affectedTurns: [0, 1],
      affectedTurnsOutputTokens: { known: true, value: 900 },
      affectedTurnsInputTokens: { known: true, value: 42_000 },
    },
    outcomeCoverage: { known: 4, unknown: 0, unknownReasons: [] },
    ...overrides,
  };
}

export function makeAuditRollup(overrides: Partial<AuditRollup> = {}): AuditRollup {
  return {
    providerId: "claude-code",
    sessionCount: 2,
    totals: { toolCalls: 10, succeeded: 6, failed: 3, interrupted: 1, denied: 0, unknown: 0 },
    failureRate: 0.4,
    byTool: [{ name: "Bash", calls: 10, failed: 4 }],
    byShellProgram: [
      { program: "npm", calls: 6, failed: 2 },
      { program: "git", calls: 4, failed: 2 },
    ],
    byFailureCategory: [
      { category: "wrong-directory", count: 2 },
      { category: "git-state", count: 2 },
    ],
    topFailingCommands: [
      { command: "npm run build", program: "npm", failures: 2, sessions: 2, failureCategory: "wrong-directory" },
      { command: "git push", program: "git", failures: 2, sessions: 1, failureCategory: "git-state" },
    ],
    daily: [
      { date: "2026-09-26", toolCalls: 4, succeeded: 3, failed: 1, interrupted: 0, denied: 0, unknown: 0 },
      { date: "2026-09-27", toolCalls: 6, succeeded: 3, failed: 2, interrupted: 1, denied: 0, unknown: 0 },
    ],
    sessions: [
      { sessionId: "a", title: "Fix the build", startedAt: "2026-09-27T08:00:00.000Z", toolCalls: 6, failed: 3, unknown: 0 },
      { sessionId: "b", title: "Push release", startedAt: "2026-09-26T08:00:00.000Z", toolCalls: 4, failed: 1, unknown: 0 },
    ],
    outcomeCoverage: { known: 10, unknown: 0, unknownReasons: [] },
    ...overrides,
  };
}
