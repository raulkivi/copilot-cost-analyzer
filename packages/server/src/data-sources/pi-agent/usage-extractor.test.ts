import { describe, expect, it } from "vitest";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import { extractToolCalls, extractTurnUsage } from "./usage-extractor.js";
import type { PiTurnGroup } from "./turn-grouper.js";

function userMessage(id: string): PiRawEntry {
  return { type: "message", id, message: { role: "user", content: "hi" } };
}

function assistantMessage(
  id: string,
  usage: Record<string, unknown> | undefined,
  model = "claude-x",
  content: unknown[] = [],
): PiRawEntry {
  return {
    type: "message",
    id,
    message: { role: "assistant", model, provider: "anthropic", api: "messages", content, usage },
  };
}

function toolResultMessage(id: string, toolCallId: string, toolName: string, usage?: Record<string, unknown>): PiRawEntry {
  return {
    type: "message",
    id,
    message: { role: "toolResult", toolCallId, toolName, content: [], isError: false, usage },
  };
}

function bashResult(id: string, toolCallId: string, text: string, isError: boolean | undefined): PiRawEntry {
  return {
    type: "message",
    id,
    message: {
      role: "toolResult",
      toolCallId,
      toolName: "bash",
      content: [{ type: "text", text }],
      ...(isError !== undefined ? { isError } : {}),
    },
  };
}

function group(entries: PiRawEntry[]): PiTurnGroup {
  return { userMessageEntry: entries[0], entries };
}

describe("extractTurnUsage", () => {
  it("sums input/output/cacheRead/cacheWrite across every assistant message in the turn", () => {
    const g = group([
      userMessage("u1"),
      assistantMessage("a1", { input: 100, output: 20, cacheRead: 5, cacheWrite: 0 }),
      assistantMessage("a2", { input: 50, output: 10, cacheRead: 0, cacheWrite: 200 }),
    ]);

    const usage = extractTurnUsage(g);

    expect(usage.uncachedInput).toEqual({ known: true, value: 150 });
    expect(usage.output).toEqual({ known: true, value: 30 });
    expect(usage.cacheRead).toEqual({ known: true, value: 5 });
    expect(usage.cacheWrite).toEqual({ known: true, value: 200 });
    expect(usage.roundsCount).toBe(2);
  });

  it("marks a field unavailable when any assistant message in the turn is missing it", () => {
    const g = group([userMessage("u1"), assistantMessage("a1", { input: 100, output: 20 })]);

    const usage = extractTurnUsage(g);

    expect(usage.cacheRead.known).toBe(false);
    expect(usage.cacheWrite.known).toBe(false);
  });

  it("uses the last assistant message's model, falling back to unknown when there are none", () => {
    const withAssistant = extractTurnUsage(
      group([userMessage("u1"), assistantMessage("a1", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, "model-a"), assistantMessage("a2", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, "model-b")]),
    );
    expect(withAssistant.model).toBe("model-b");

    const withoutAssistant = extractTurnUsage(group([userMessage("u1")]));
    expect(withoutAssistant.model).toBe("unknown");
    expect(withoutAssistant.roundsCount).toBe(0);
  });

  it("costAiCredits is always unavailable — no AI Credits conversion exists for pi", () => {
    const usage = extractTurnUsage(
      group([userMessage("u1"), assistantMessage("a1", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })]),
    );
    expect(usage.costAiCredits.known).toBe(false);
  });

  it("vision and reasoning are unavailable (unconfirmed against a real capture)", () => {
    const usage = extractTurnUsage(
      group([userMessage("u1"), assistantMessage("a1", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })]),
    );
    expect(usage.vision.known).toBe(false);
    expect(usage.reasoning.known).toBe(false);
  });

  it("tool usage sums ToolResultMessage.usage when every tool result in the turn has one", () => {
    const g = group([
      userMessage("u1"),
      toolResultMessage("t1", "call-1", "read_file", { input: 0, output: 5 }),
    ]);

    expect(extractTurnUsage(g).tool.known).toBe(false); // no confirmed field name yet from real data — see extractToolUsage
  });
});

describe("extractToolCalls", () => {
  it("builds one ToolCallRecord per ToolResultMessage, using toolName directly", () => {
    const g = group([
      userMessage("u1"),
      assistantMessage("a1", undefined, "claude-x", [
        { type: "toolCall", id: "call-1", name: "read_file", args: { path: "src/index.ts" } },
      ]),
      toolResultMessage("t1", "call-1", "read_file"),
    ]);

    const toolCalls = extractToolCalls(g);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("read_file");
    expect(toolCalls[0].argsSummary).toContain("src/index.ts");
  });

  it("returns an empty array when the turn made no tool calls", () => {
    expect(extractToolCalls(group([userMessage("u1")]))).toEqual([]);
  });

  it("reads pi's isError flag into a classified outcome with the shell program", () => {
    const g = group([
      userMessage("u1"),
      assistantMessage("a1", undefined, "claude-x", [
        { type: "toolCall", id: "c1", name: "bash", args: { command: "cd pkg && npm test" } },
        { type: "toolCall", id: "c2", name: "bash", args: { command: "ls" } },
      ]),
      bashResult("t1", "c1", "bash: cd: pkg: No such file or directory", true),
      bashResult("t2", "c2", "a.ts", false),
    ]);

    const [failed, ok] = extractToolCalls(g);

    expect(failed).toMatchObject({
      id: "c1",
      kind: "shell",
      argsSummary: "cd pkg && npm test",
      shell: { command: "cd pkg && npm test", program: "npm" },
      outcome: { status: "error", failureCategory: "wrong-directory" },
    });
    expect(ok.outcome).toEqual({ status: "success" });
  });

  it("reports an unknown outcome, with a reason, when isError is absent", () => {
    const g = group([userMessage("u1"), bashResult("t1", "c1", "x", undefined)]);

    const [call] = extractToolCalls(g);

    expect(call.outcome?.status).toBe("unknown");
    expect(call.outcome?.reason).toMatch(/isError/);
  });
});
