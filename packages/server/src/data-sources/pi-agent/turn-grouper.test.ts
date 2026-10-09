import { describe, expect, it } from "vitest";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import { groupBranchEntriesByUserMessage } from "./turn-grouper.js";

function userMessage(id: string): PiRawEntry {
  return { type: "message", id, message: { role: "user", content: "hi" } };
}
function assistantMessage(id: string): PiRawEntry {
  return { type: "message", id, message: { role: "assistant", content: [] } };
}
function modelChange(id: string): PiRawEntry {
  return { type: "model_change", id, provider: "anthropic", modelId: "claude" };
}

describe("groupBranchEntriesByUserMessage", () => {
  it("groups everything up to (not including) the next user message into one turn", () => {
    const entries = [userMessage("u1"), assistantMessage("a1"), userMessage("u2"), assistantMessage("a2")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups).toHaveLength(2);
    expect(groups[0].userMessageEntry.id).toBe("u1");
    expect(groups[0].entries.map((e) => e.id)).toEqual(["u1", "a1"]);
    expect(groups[1].userMessageEntry.id).toBe("u2");
    expect(groups[1].entries.map((e) => e.id)).toEqual(["u2", "a2"]);
  });

  it("attributes a non-message entry (e.g. model_change) to the turn whose span it falls within", () => {
    const entries = [userMessage("u1"), modelChange("m1"), assistantMessage("a1")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["u1", "m1", "a1"]);
  });

  it("attributes entries that precede the first user message (leading system message, an early usage entry) to the first turn's precedingEntries", () => {
    const entries = [modelChange("m0"), userMessage("u1"), assistantMessage("a1"), userMessage("u2")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups).toHaveLength(2);
    expect(groups[0].precedingEntries.map((e) => e.id)).toEqual(["m0"]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["u1", "a1"]);
    expect(groups[1].precedingEntries).toEqual([]);
  });

  it("returns an empty array when there are no user messages at all", () => {
    expect(groupBranchEntriesByUserMessage([assistantMessage("a1")])).toEqual([]);
  });

  it("returns an empty array for an empty branch", () => {
    expect(groupBranchEntriesByUserMessage([])).toEqual([]);
  });
});
