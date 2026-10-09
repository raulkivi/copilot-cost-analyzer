import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ClaudeCodeLogProvider } from "./claude-code-log-provider.js";
import { computeClaudeCodeFileHash } from "./session-id.js";

// Real-capture-derived fixture (fixtures/claude-code-audit/README.md): ten
// parallel tool calls with deliberately triggered failures, nine of whose
// results sit off the active branch, then a retry turn.
const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/claude-code-audit");
const sessionId = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "bash-failures-session.jsonl"));

async function readFixtureSession() {
  const session = await new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir }).readSession(sessionId);
  if (!session) {
    throw new Error("fixture session not found");
  }
  return session;
}

describe("ClaudeCodeLogProvider tool-call outcomes (real-capture fixture)", () => {
  it("pairs every parallel call with its result, including the off-branch ones", async () => {
    const session = await readFixtureSession();
    const turn0 = session.turns[0].toolCalls;

    expect(turn0).toHaveLength(10);
    expect(turn0.every((call) => call.outcome && call.outcome.status !== "unknown")).toBe(true);
  });

  it("classifies each deliberately triggered failure", async () => {
    const session = await readFixtureSession();

    const summary = session.turns[0].toolCalls.map((call) => [
      call.shell?.program ?? call.name,
      call.outcome?.status,
      call.outcome?.exitCode,
      call.outcome?.failureCategory,
    ]);

    expect(summary).toEqual([
      ["definitely-not-installed-tool", "error", 127, "command-not-found"],
      ["ls", "error", 1, "wrong-directory"],
      ["ls", "error", 2, "invalid-arguments"],
      ["git", "error", 128, "git-state"],
      ["Read", "error", undefined, "file-not-found"],
      ["sleep", "success", undefined, undefined],
      ["touch", "error", 126, "permission-denied"],
      ["python3", "error", 1, "dependency-missing"],
      ["node", "error", 1, "dependency-missing"],
      ["curl", "error", 6, "network"],
    ]);
  });

  it("reads the harness timeout and the retry in the second turn", async () => {
    const session = await readFixtureSession();

    expect(session.turns[1].toolCalls.map((call) => [call.outcome?.status, call.outcome?.failureCategory])).toEqual([
      ["interrupted", "timeout"],
      ["error", "command-not-found"],
      ["success", undefined],
    ]);
  });

  it("keeps argsSummary bounded to the command line", async () => {
    const session = await readFixtureSession();

    expect(session.turns[0].toolCalls[0].argsSummary).toBe("definitely-not-installed-tool --version");
  });

  it("shows off-branch parallel results in the turn inspector too", async () => {
    const detail = await new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir }).readTurnDetail(sessionId, 0);
    const toolCalls = detail?.rounds.flatMap((round) => round.request.toolCalls) ?? [];

    expect(toolCalls).toHaveLength(10);
    const firstResult = toolCalls[0].result[0];
    expect(firstResult.kind === "text" ? firstResult.text : "").toContain("command not found");
  });
});
