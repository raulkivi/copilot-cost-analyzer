import { describe, expect, it } from "vitest";
import type { Session } from "@copilot-cost-analyzer/domain";
import { makeTurn } from "../test-support/turn-fixture.js";
import { buildAdviceBundle } from "./build-advice-bundle.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    mode: "analyze",
    title: "Refactor auth module",
    model: "gpt-4o",
    turns: [makeTurn({ index: 0 })],
    turnCount: 1,
    costAiCredits: { known: true, value: 1.5 },
    usageDataAvailable: true,
    ...overrides,
  };
}

function jsonPayload(markdown: string): unknown[] {
  const match = markdown.match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw new Error("no json block found in advice bundle markdown");
  return JSON.parse(match[1]);
}

describe("buildAdviceBundle", () => {
  it("never includes raw message text (userMessage/assistantResponse) in the output", () => {
    const sessions = [
      makeSession({
        turns: [
          makeTurn({
            index: 0,
            userMessage: "SECRET_USER_TEXT how do I fix the login bug",
            assistantResponse: "SECRET_ASSISTANT_TEXT here is the fix",
          }),
        ],
      }),
    ];

    const bundle = buildAdviceBundle(sessions);

    expect(bundle).not.toContain("SECRET_USER_TEXT");
    expect(bundle).not.toContain("SECRET_ASSISTANT_TEXT");
  });

  it("excludes tool call argsSummary by default", () => {
    const sessions = [
      makeSession({
        turns: [
          makeTurn({
            index: 0,
            toolCalls: [{ name: "search_text", argsSummary: "SECRET_ARGS_SNIPPET" }],
          }),
        ],
      }),
    ];

    const bundle = buildAdviceBundle(sessions);

    expect(bundle).not.toContain("SECRET_ARGS_SNIPPET");
  });

  it("includes tool call argsSummary when includeToolArgs is true", () => {
    const sessions = [
      makeSession({
        turns: [
          makeTurn({
            index: 0,
            toolCalls: [{ name: "search_text", argsSummary: "VISIBLE_ARGS_SNIPPET" }],
          }),
        ],
      }),
    ];

    const bundle = buildAdviceBundle(sessions, { includeToolArgs: true });

    expect(bundle).toContain("VISIBLE_ARGS_SNIPPET");
  });

  it("opens with an instruction preamble noting no message content is included, pluralized by session count", () => {
    const bundle = buildAdviceBundle([makeSession(), makeSession({ id: "s2" })]);

    expect(bundle).toMatch(/2 sessions/);
    expect(bundle).toMatch(/no chat message content/i);
  });

  it("singularizes the preamble for exactly one session", () => {
    const bundle = buildAdviceBundle([makeSession()]);

    expect(bundle).toMatch(/1 session\b/);
    expect(bundle).not.toMatch(/1 sessions/);
  });

  it("includes session-level metadata fields", () => {
    const [entry] = jsonPayload(
      buildAdviceBundle([
        makeSession({
          title: "Refactor auth module",
          model: "gpt-4o",
          turnCount: 3,
          costAiCredits: { known: true, value: 4.5678 },
          startedAt: "2026-08-01T00:00:00.000Z",
          category: undefined,
        }),
      ]),
    ) as Array<Record<string, unknown>>;

    expect(entry.title).toBe("Refactor auth module");
    expect(entry.model).toBe("gpt-4o");
    expect(entry.turnCount).toBe(3);
    expect(entry.costAiCredits).toBe(4.5678);
    expect(entry.startedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("represents an unknown token count as the string 'unknown' rather than a fabricated number", () => {
    const [entry] = jsonPayload(
      buildAdviceBundle([makeSession({ costAiCredits: { known: false, reason: "not extracted" } })]),
    ) as Array<Record<string, unknown>>;

    expect(entry.costAiCredits).toBe("unknown");
  });

  it("includes the system-prompt component breakdown without any raw prompt text field", () => {
    const [entry] = jsonPayload(
      buildAdviceBundle([
        makeSession({
          systemPrompt: [{ kind: "tool-definitions", label: "Tool definitions", tokenCount: { known: true, value: 800 } }],
        }),
      ]),
    ) as Array<{ systemPrompt: Array<Record<string, unknown>> }>;

    expect(entry.systemPrompt).toEqual([{ kind: "tool-definitions", label: "Tool definitions", tokenCount: 800 }]);
  });

  it("summarizes tool inventory as an invoked-turn count rather than the raw turn-index array", () => {
    const [entry] = jsonPayload(
      buildAdviceBundle([
        makeSession({
          toolInventory: [
            { name: "search_text", loaded: true, invokedInTurns: [0, 2, 5] },
            { name: "unused_tool", loaded: true, invokedInTurns: [] },
          ],
        }),
      ]),
    ) as Array<{ toolInventory: Array<Record<string, unknown>>; stats: Record<string, unknown> }>;

    expect(entry.toolInventory).toEqual([
      { name: "search_text", loaded: true, invokedTurnCount: 3 },
      { name: "unused_tool", loaded: true, invokedTurnCount: 0 },
    ]);
    expect(entry.stats.unusedToolCount).toBe(1);
  });

  it("computes a cache hit rate from cacheRead vs. uncachedInput across turns", () => {
    const [entry] = jsonPayload(
      buildAdviceBundle([
        makeSession({
          turns: [
            makeTurn({
              index: 0,
              usage: {
                uncachedInput: { known: true, value: 100 },
                cacheWrite: { known: true, value: 0 },
                cacheRead: { known: true, value: 300 },
                tool: { known: true, value: 0 },
                vision: { known: true, value: 0 },
                reasoning: { known: true, value: 0 },
                output: { known: true, value: 0 },
                costAiCredits: { known: true, value: 0.01 },
                model: "gpt-4o",
              },
            }),
          ],
        }),
      ]),
    ) as Array<{ stats: Record<string, unknown> }>;

    expect(entry.stats.cacheHitRate).toBe(0.75);
  });

  it("counts triggered events per session", () => {
    const [entry] = jsonPayload(
      buildAdviceBundle([
        makeSession({
          turns: [
            makeTurn({ index: 0, triggeredEvent: "compaction" }),
            makeTurn({ index: 1, triggeredEvent: "compaction" }),
            makeTurn({ index: 2, triggeredEvent: "rewind" }),
          ],
        }),
      ]),
    ) as Array<{ turns: Array<Record<string, unknown>>; stats: Record<string, unknown> }>;

    expect(entry.stats.eventCounts).toEqual({ compaction: 2, rewind: 1 });
    expect(entry.turns[0].triggeredEvent).toBe("compaction");
    expect(entry.turns[2].triggeredEvent).toBe("rewind");
  });

  it("includes one payload entry per session, in order", () => {
    const payload = jsonPayload(
      buildAdviceBundle([makeSession({ id: "s1", title: "First" }), makeSession({ id: "s2", title: "Second" })]),
    ) as Array<{ title: string }>;

    expect(payload.map((entry) => entry.title)).toEqual(["First", "Second"]);
  });
});
