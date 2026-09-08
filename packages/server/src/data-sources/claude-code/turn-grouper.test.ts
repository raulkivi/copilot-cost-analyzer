import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { groupBranchEntriesByUserMessage, isRealUserMessage } from "./turn-grouper.js";

function realUserMessage(uuid: string, text = "hi"): ClaudeCodeRawEntry {
  return { type: "user", uuid, message: { role: "user", content: [{ type: "text", text }] } };
}
function toolResultUserMessage(uuid: string, toolUseId: string): ClaudeCodeRawEntry {
  return {
    type: "user",
    uuid,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }] },
  };
}
function assistantEntry(uuid: string): ClaudeCodeRawEntry {
  return { type: "assistant", uuid, message: { id: "m1", role: "assistant", content: [{ type: "text", text: "hey" }] } };
}
function attachmentEntry(uuid: string): ClaudeCodeRawEntry {
  return { type: "attachment", uuid };
}

describe("isRealUserMessage", () => {
  it("is true for a user entry with text content", () => {
    expect(isRealUserMessage(realUserMessage("u1"))).toBe(true);
  });

  it("is false for a user entry whose content is purely tool_result blocks", () => {
    expect(isRealUserMessage(toolResultUserMessage("u1", "call-1"))).toBe(false);
  });

  it("is false for a non-user entry", () => {
    expect(isRealUserMessage(assistantEntry("a1"))).toBe(false);
    expect(isRealUserMessage(attachmentEntry("x1"))).toBe(false);
  });

  it("is true for a user entry whose content is a plain string", () => {
    expect(isRealUserMessage({ type: "user", uuid: "u1", message: { role: "user", content: "hi" } })).toBe(true);
  });
});

describe("groupBranchEntriesByUserMessage", () => {
  it("groups everything up to (not including) the next real user message into one turn", () => {
    const entries = [realUserMessage("u1"), assistantEntry("a1"), realUserMessage("u2"), assistantEntry("a2")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups).toHaveLength(2);
    expect(groups[0].userMessageEntry.uuid).toBe("u1");
    expect(groups[0].entries.map((e) => e.uuid)).toEqual(["u1", "a1"]);
    expect(groups[1].userMessageEntry.uuid).toBe("u2");
    expect(groups[1].entries.map((e) => e.uuid)).toEqual(["u2", "a2"]);
  });

  it("does not start a new turn on a tool-result-delivery 'user' entry", () => {
    const entries = [realUserMessage("u1"), assistantEntry("a1"), toolResultUserMessage("tr1", "call-1"), assistantEntry("a2")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.uuid)).toEqual(["u1", "a1", "tr1", "a2"]);
  });

  it("attributes a non-message entry (e.g. attachment) to the turn whose span it falls within", () => {
    const entries = [realUserMessage("u1"), attachmentEntry("att1"), assistantEntry("a1")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.uuid)).toEqual(["u1", "att1", "a1"]);
  });

  it("drops entries that precede the first real user message", () => {
    const entries = [attachmentEntry("att0"), realUserMessage("u1"), assistantEntry("a1")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.uuid)).toEqual(["u1", "a1"]);
  });

  it("returns an empty array for an empty branch", () => {
    expect(groupBranchEntriesByUserMessage([])).toEqual([]);
  });
});
