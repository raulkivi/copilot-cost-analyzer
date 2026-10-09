import { describe, expect, it } from "vitest";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import type { PiTurnGroup } from "./turn-grouper.js";
import { buildTurnInspectorDetail } from "./turn-inspector-builder.js";

function userMessage(id: string, content: unknown = "hello"): PiRawEntry {
  return { type: "message", id, message: { role: "user", content } };
}
function assistantMessage(id: string, content: unknown[]): PiRawEntry {
  return { type: "message", id, message: { role: "assistant", model: "claude-x", content } };
}
function toolResultMessage(id: string, toolCallId: string, toolName: string, content: unknown = "ok"): PiRawEntry {
  return { type: "message", id, message: { role: "toolResult", toolCallId, toolName, content, isError: false } };
}

function group(entries: PiRawEntry[]): PiTurnGroup {
  return { userMessageEntry: entries[0], precedingEntries: [], entries };
}

describe("buildTurnInspectorDetail", () => {
  it("returns one round per assistant message, with the user message as round 0's added content", () => {
    const g = group([
      userMessage("u1", "please read the file"),
      assistantMessage("a1", [{ type: "text", text: "sure, reading it" }]),
    ]);

    const detail = buildTurnInspectorDetail(0, g);

    expect(detail.turnIndex).toBe(0);
    expect(detail.rounds).toHaveLength(1);
    expect(detail.rounds[0].request.addedMessages).toEqual([{ kind: "text", text: "please read the file" }]);
    expect(detail.rounds[0].response.response).toEqual([{ kind: "text", text: "sure, reading it" }]);
  });

  it("a turn with no assistant messages returns rounds: []", () => {
    const detail = buildTurnInspectorDetail(2, group([userMessage("u1")]));

    expect(detail).toEqual({ turnIndex: 2, userMessage: [], rounds: [] });
  });

  it("separates thinking blocks into the response's reasoning field", () => {
    const g = group([
      userMessage("u1"),
      assistantMessage("a1", [
        { type: "thinking", text: "let me think" },
        { type: "text", text: "here's the answer" },
      ]),
    ]);

    const detail = buildTurnInspectorDetail(0, g);

    expect(detail.rounds[0].response.reasoning).toEqual([{ kind: "text", text: "let me think" }]);
    expect(detail.rounds[0].response.response).toEqual([{ kind: "text", text: "here's the answer" }]);
  });

  it("a second round's addedMessages contains only the tool result added since round 1, not the original user message again", () => {
    const g = group([
      userMessage("u1", "read then summarize"),
      assistantMessage("a1", [{ type: "toolCall", id: "call-1", name: "read_file", args: { path: "a.ts" } }]),
      toolResultMessage("t1", "call-1", "read_file", "file contents"),
      assistantMessage("a2", [{ type: "text", text: "summary" }]),
    ]);

    const detail = buildTurnInspectorDetail(0, g);

    expect(detail.rounds).toHaveLength(2);
    expect(detail.rounds[0].request.addedMessages).toEqual([{ kind: "text", text: "read then summarize" }]);
    expect(detail.rounds[1].request.addedMessages).toEqual([]);
    expect(detail.rounds[1].request.toolCalls).toHaveLength(1);
    expect(detail.rounds[1].request.toolCalls[0].name).toBe("read_file");
  });

  // message-types.md "ThinkingContent" / "ToolCall": thinking text lives in
  // `thinking`, tool arguments in `arguments`.
  it("reads ThinkingContent.thinking and ToolCall.arguments per pi's published schema", () => {
    const g = group([
      userMessage("u1"),
      assistantMessage("a1", [
        { type: "thinking", thinking: "check the file", thinkingSignature: "opaque" },
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
      ]),
      toolResultMessage("t1", "call-1", "read", [{ type: "text", text: "file contents" }]),
      assistantMessage("a2", [{ type: "text", text: "done" }]),
    ]);

    const detail = buildTurnInspectorDetail(0, g);

    expect(detail.rounds[0].response.reasoning).toEqual([{ kind: "text", text: "check the file" }]);
    expect(detail.rounds[1].request.toolCalls[0].args).toEqual([{ kind: "text", text: expect.stringContaining("a.ts") }]);
  });
});
