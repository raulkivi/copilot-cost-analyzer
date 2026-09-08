import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";
import { buildTurnInspectorDetail } from "./turn-inspector-builder.js";

function userText(uuid: string, text = "hello"): ClaudeCodeRawEntry {
  return { type: "user", uuid, message: { role: "user", content: [{ type: "text", text }] } };
}
function assistantBlock(uuid: string, messageId: string, block: Record<string, unknown>): ClaudeCodeRawEntry {
  return { type: "assistant", uuid, message: { id: messageId, role: "assistant", model: "claude-x", content: [block] } };
}
function toolResult(uuid: string, toolUseId: string, content: unknown, toolUseResult?: unknown): ClaudeCodeRawEntry {
  return {
    type: "user",
    uuid,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
    ...(toolUseResult !== undefined ? { toolUseResult } : {}),
  };
}
function attachment(uuid: string, content: unknown): ClaudeCodeRawEntry {
  return { type: "attachment", uuid, attachment: { type: "file", filename: "note.md", content: { type: "text", file: { filePath: "/x/note.md", content } } } };
}

function group(entries: ClaudeCodeRawEntry[]): ClaudeCodeTurnGroup {
  return { userMessageEntry: entries[0], entries };
}

describe("buildTurnInspectorDetail", () => {
  it("populates the top-level userMessage from the turn's real user message", () => {
    const g = group([userText("u1", "please read the file"), assistantBlock("a1", "m1", { type: "text", text: "sure" })]);

    const detail = buildTurnInspectorDetail(0, g);

    expect(detail.turnIndex).toBe(0);
    expect(detail.userMessage).toEqual([{ kind: "text", text: "please read the file" }]);
    expect(detail.rounds[0].response.response).toEqual([{ kind: "text", text: "sure" }]);
  });

  it("a turn with no assistant rounds returns rounds: [] but still populates userMessage", () => {
    const detail = buildTurnInspectorDetail(2, group([userText("u1", "hi")]));

    expect(detail).toEqual({ turnIndex: 2, userMessage: [{ kind: "text", text: "hi" }], rounds: [] });
  });

  it("separates thinking blocks into the response's reasoning field", () => {
    const g = group([
      userText("u1"),
      assistantBlock("a1", "m1", { type: "thinking", thinking: "let me think" }),
      assistantBlock("a2", "m1", { type: "text", text: "the answer" }),
    ]);

    const detail = buildTurnInspectorDetail(0, g);

    expect(detail.rounds[0].response.reasoning).toEqual([{ kind: "text", text: "let me think" }]);
    expect(detail.rounds[0].response.response).toEqual([{ kind: "text", text: "the answer" }]);
  });

  it("pairs a tool_use block with its tool_result, preferring the richer toolUseResult sibling field when present", () => {
    const g = group([
      userText("u1", "read the file"),
      assistantBlock("a1", "m1", { type: "tool_use", id: "call-1", name: "Read", input: { file_path: "/a.ts" } }),
      toolResult("tr1", "call-1", "raw preview", { type: "text", file: { filePath: "/a.ts", content: "full file contents" } }),
    ]);

    const detail = buildTurnInspectorDetail(0, g);

    expect(detail.rounds[0].request.toolCalls).toHaveLength(1);
    const toolCall = detail.rounds[0].request.toolCalls[0];
    expect(toolCall.name).toBe("Read");
    expect(toolCall.args).toEqual([{ kind: "text", text: JSON.stringify({ file_path: "/a.ts" }) }]);
    expect(toolCall.result).toEqual([
      { kind: "text", text: JSON.stringify({ type: "text", file: { filePath: "/a.ts", content: "full file contents" } }) },
    ]);
  });

  it("falls back to the raw tool_result content when no toolUseResult sibling field is present", () => {
    const g = group([
      userText("u1"),
      assistantBlock("a1", "m1", { type: "tool_use", id: "call-1", name: "Bash", input: { command: "ls" } }),
      toolResult("tr1", "call-1", "file1.txt"),
    ]);

    const detail = buildTurnInspectorDetail(0, g);

    expect(detail.rounds[0].request.toolCalls[0].result).toEqual([{ kind: "text", text: "file1.txt" }]);
  });

  it("reunites a second round's tool call with its result even when interleaved with a prior round's parallel calls (round-grouper's core scenario)", () => {
    const g = group([
      userText("u1"),
      assistantBlock("a1", "m1", { type: "tool_use", id: "call-1", name: "Bash", input: { command: "ls" } }),
      toolResult("tr1", "call-1", "file1.txt"),
      assistantBlock("a2", "m1", { type: "tool_use", id: "call-2", name: "Bash", input: { command: "pwd" } }),
      toolResult("tr2", "call-2", "/home"),
      assistantBlock("a3", "m2", { type: "text", text: "done" }),
    ]);

    const detail = buildTurnInspectorDetail(0, g);

    expect(detail.rounds).toHaveLength(2);
    expect(detail.rounds[0].request.toolCalls).toHaveLength(2);
    expect(detail.rounds[0].request.toolCalls.map((t) => t.name)).toEqual(["Bash", "Bash"]);
    expect(detail.rounds[0].request.toolCalls[1].result).toEqual([{ kind: "text", text: "/home" }]);
    expect(detail.rounds[1].response.response).toEqual([{ kind: "text", text: "done" }]);
  });

  it("includes an attachment injected between the user message and the first round as that round's addedMessages", () => {
    const g = group([
      userText("u1", "see the attached doc"),
      attachment("att1", "attached file contents"),
      assistantBlock("a1", "m1", { type: "text", text: "got it" }),
    ]);

    const detail = buildTurnInspectorDetail(0, g);

    expect(detail.rounds[0].request.addedMessages).toEqual([{ kind: "text", text: "attached file contents" }]);
  });
});
