import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { findToolResultFor, groupTurnEntriesByRound } from "./round-grouper.js";

function assistantBlock(uuid: string, messageId: string, block: Record<string, unknown>): ClaudeCodeRawEntry {
  return { type: "assistant", uuid, message: { id: messageId, role: "assistant", model: "claude-x", content: [block] } };
}
function toolResult(uuid: string, toolUseId: string, content: unknown = "ok"): ClaudeCodeRawEntry {
  return { type: "user", uuid, message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content }] } };
}
function userText(uuid: string, text = "hi"): ClaudeCodeRawEntry {
  return { type: "user", uuid, message: { role: "user", content: [{ type: "text", text }] } };
}

describe("groupTurnEntriesByRound", () => {
  it("groups every assistant content-block entry sharing one message.id into a single round, reuniting blocks interleaved by tool-result lines under parallel tool calls", () => {
    // Mirrors a real captured shape: one response = thinking + 4 tool_use
    // blocks all sharing message.id "m1", each tool_use's own tool_result
    // line appearing directly after it (interleaved), before the next
    // tool_use block of the *same* response.
    const entries = [
      userText("u1"),
      assistantBlock("a1", "m1", { type: "thinking", thinking: "let's look around" }),
      assistantBlock("a2", "m1", { type: "tool_use", id: "call-1", name: "Bash", input: { command: "ls" } }),
      toolResult("tr1", "call-1", "file1.txt"),
      assistantBlock("a3", "m1", { type: "tool_use", id: "call-2", name: "Bash", input: { command: "pwd" } }),
      toolResult("tr2", "call-2", "/home"),
    ];

    const rounds = groupTurnEntriesByRound(entries);

    expect(rounds).toHaveLength(1);
    expect(rounds[0].messageId).toBe("m1");
    expect(rounds[0].entries.map((e) => e.uuid)).toEqual(["a1", "a2", "a3"]);
  });

  it("produces one round per distinct message.id, in order of first appearance", () => {
    const entries = [
      userText("u1"),
      assistantBlock("a1", "m1", { type: "tool_use", id: "call-1", name: "Bash", input: {} }),
      toolResult("tr1", "call-1"),
      assistantBlock("a2", "m2", { type: "text", text: "done" }),
    ];

    const rounds = groupTurnEntriesByRound(entries);

    expect(rounds.map((r) => r.messageId)).toEqual(["m1", "m2"]);
  });

  it("returns an empty array when the turn has no assistant entries", () => {
    expect(groupTurnEntriesByRound([userText("u1")])).toEqual([]);
  });
});

describe("findToolResultFor", () => {
  it("finds the tool_result user entry matching a tool_use_id among interleaved entries", () => {
    const entries = [
      userText("u1"),
      assistantBlock("a1", "m1", { type: "tool_use", id: "call-1", name: "Bash", input: {} }),
      toolResult("tr1", "call-1", "result-1"),
      assistantBlock("a2", "m1", { type: "tool_use", id: "call-2", name: "Bash", input: {} }),
      toolResult("tr2", "call-2", "result-2"),
    ];

    const found = findToolResultFor(entries, "call-2");

    expect(found?.uuid).toBe("tr2");
  });

  it("returns undefined when no matching tool_result exists", () => {
    expect(findToolResultFor([userText("u1")], "does-not-exist")).toBeUndefined();
  });
});
