import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeLogProviderContract } from "../log-providers/contract.js";
import { ClaudeCodeLogProvider } from "./claude-code-log-provider.js";
import { computeClaudeCodeFileHash } from "./session-id.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/claude-code",
);

describe("ClaudeCodeLogProvider", () => {
  it("checkAvailability reports unavailable when no projects directory is configured", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: null });

    await expect(provider.checkAvailability()).resolves.toEqual({
      available: false,
      unavailableReason: "No Claude Code projects directory is configured.",
    });
  });

  it("checkAvailability reports unavailable when the configured directory does not exist", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: path.join(fixturesDir, "-home-dev-project", "does-not-exist") });

    const availability = await provider.checkAvailability();

    expect(availability.available).toBe(false);
    expect(availability.unavailableReason).toContain("does not exist");
  });

  it("checkAvailability reports available when at least one session file is present", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

    await expect(provider.checkAvailability()).resolves.toEqual({ available: true });
  });

  it("lists one session per file, with providerId set and turns empty", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

    const sessions = await provider.listSessions();
    const normal = sessions.find((s) => s.id === computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "normal-session.jsonl")));

    expect(normal).toBeDefined();
    expect(normal?.providerId).toBe("claude-code");
    expect(normal?.turns).toEqual([]);
    expect(normal?.mode).toBe("analyze");
    expect(normal?.title).toBe("Add widget form validation");
  });

  it("lists sessions ordered from most recent to oldest by startedAt", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

    const sessions = await provider.listSessions();
    const startedAts = sessions.map((s) => s.startedAt);

    expect(startedAts).toEqual([...startedAts].sort().reverse());
  });

  it("readSession returns real per-turn usage numbers for the normal fixture, summed once per round rather than per content-block entry", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
    const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "normal-session.jsonl"));

    const session = await provider.readSession(id);

    expect(session?.usageDataAvailable).toBe(true);
    expect(session?.turns).toHaveLength(2);
    // Turn 0 spans two rounds (msg_turn0 + msg_turn0b): 1250+15 input, etc.
    expect(session?.turns[0].usage.uncachedInput).toEqual({ known: true, value: 1265 });
    expect(session?.turns[0].usage.output).toEqual({ known: true, value: 460 });
    expect(session?.turns[0].usage.cacheRead).toEqual({ known: true, value: 3300 });
    expect(session?.turns[0].usage.cacheWrite).toEqual({ known: true, value: 300 });
    expect(session?.turns[0].usage.reasoning).toEqual({ known: true, value: 40 });
    expect(session?.turns[0].usage.roundsCount).toBe(2);
    expect(session?.turns[0].toolCalls).toHaveLength(1);
    expect(session?.turns[0].toolCalls[0].name).toBe("Read");
    expect(session?.turns[0].usage.costAiCredits.known).toBe(false);
    expect(session?.turns[0].usage.tool.known).toBe(false);
    expect(session?.turns[1].usage.roundsCount).toBe(1);
    expect(session?.model).toBe("claude-sonnet-5");
  });

  it("readSession marks usageDataAvailable false when the assistant message carries no usage data at all", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
    const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "no-usage-session.jsonl"));

    const session = await provider.readSession(id);

    expect(session?.usageDataAvailable).toBe(false);
    expect(session?.turns[0].usage.output.known).toBe(false);
  });

  it("readSession skips malformed lines without throwing", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
    const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "malformed-lines-session.jsonl"));

    const session = await provider.readSession(id);

    expect(session?.turns).toHaveLength(1);
    expect(session?.turns[0].usage.output).toEqual({ known: true, value: 15 });
  });

  it("readSession returns null for an unknown id", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

    await expect(provider.readSession("does-not-exist")).resolves.toBeNull();
  });

  it("readSession follows the active leaf named by last-prompt for a forked file, tagging the resent turn as triggeredEvent: fork", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
    const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "forked-session.jsonl"));

    const session = await provider.readSession(id);

    expect(session?.turns).toHaveLength(2);
    expect(session?.turns[0].triggeredEvent).toBeUndefined();
    expect(session?.turns[1].triggeredEvent).toBe("fork");
    // The active branch is the *resent* instruction, not the original one
    // it superseded.
    expect(session?.turns[1].userMessage).toContain("go ahead with the full codebase rename");
    expect(session?.turns[1].assistantResponse).toContain("Renamed");
  });

  it("readSession returns real per-round tool calls for the parallel-tool-calls fixture (round-grouper's core scenario)", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
    const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "tool-results-and-image-session.jsonl"));

    const session = await provider.readSession(id);

    expect(session?.turns).toHaveLength(1);
    expect(session?.turns[0].usage.roundsCount).toBe(3);
    expect(session?.turns[0].toolCalls.map((t) => t.name)).toEqual([
      "Read",
      "Read",
      "mcp__playwright__browser_take_screenshot",
    ]);
  });

  describe("readTurnDetail", () => {
    it("returns rounds for a known session/turn", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
      const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "normal-session.jsonl"));

      const detail = await provider.readTurnDetail(id, 0);

      expect(detail).not.toBeNull();
      expect(detail!.rounds).toHaveLength(2);
      expect(detail!.rounds[0].request.toolCalls).toHaveLength(1);
      expect(detail!.userMessage.length).toBeGreaterThan(0);
    });

    it("returns null for an unknown session id", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });

      await expect(provider.readTurnDetail("does-not-exist", 0)).resolves.toBeNull();
    });

    it("returns null for a turnIndex beyond the session's turn count", async () => {
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir });
      const id = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "normal-session.jsonl"));

      await expect(provider.readTurnDetail(id, 999)).resolves.toBeNull();
    });
  });
});

describeLogProviderContract("ClaudeCodeLogProvider", {
  buildAvailableProvider: () => new ClaudeCodeLogProvider({ projectsDirPath: fixturesDir }),
  knownSessionId: computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "normal-session.jsonl")),
  unknownSessionId: "does-not-exist",
  buildUnavailableProvider: () => new ClaudeCodeLogProvider({ projectsDirPath: null }),
  turnIndexWithRoundTrip: 0,
});
