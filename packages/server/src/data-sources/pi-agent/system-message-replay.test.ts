import { describe, expect, it } from "vitest";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import { replaySystemMessages } from "./system-message-replay.js";

function systemMessage(id: string, message: Record<string, unknown>): PiRawEntry {
  return { type: "message", id, message: { role: "system", content: "", timestamp: 0, ...message } };
}
function userMessage(id: string): PiRawEntry {
  return { type: "message", id, message: { role: "user", content: "hi" } };
}
const tool = (name: string) => ({ name, description: `${name} tool`, parameters: { type: "object" } });

// Mirrors pi-ai's getCurrentSystemMessage/getSystemMessageText
// (dist/utils/transcript.js, dist/utils/text.js) and the replay rules in
// docs/session-format.md "SessionMessageEntry" / docs/message-types.md
// "SystemMessage".
describe("replaySystemMessages", () => {
  it("returns null when the branch carries no system message", () => {
    expect(replaySystemMessages([userMessage("u1")])).toBeNull();
  });

  it("renders the leading system message as content followed by its sections", () => {
    const state = replaySystemMessages([
      systemMessage("s0", {
        content: "You are an expert coding assistant.",
        sections: { tools: "<tools>read</tools>", cwd: "cwd: /p" },
        toolsAdded: [tool("read"), tool("bash")],
      }),
      userMessage("u1"),
    ]);

    expect(state).toEqual({
      baseContent: "You are an expert coding assistant.",
      sections: [
        { name: "tools", text: "<tools>read</tools>" },
        { name: "cwd", text: "cwd: /p" },
      ],
      text: "You are an expert coding assistant.\n\n<tools>read</tools>\n\ncwd: /p",
      tools: [tool("read"), tool("bash")],
      declaredToolNames: ["read", "bash"],
    });
  });

  it("appends later content, patches sections by name (null removes) and applies tool add/remove", () => {
    const state = replaySystemMessages([
      systemMessage("s0", { content: "Base.", sections: { a: "A1", b: "B1" }, toolsAdded: [tool("read"), tool("write")] }),
      userMessage("u1"),
      systemMessage("s1", { content: [{ type: "text", text: "Extra." }], sections: { a: "A2", b: null, c: "C1" }, toolsRemoved: [{ name: "write" }], toolsAdded: [tool("grep")] }),
    ]);

    expect(state?.baseContent).toBe("Base.\n\nExtra.");
    expect(state?.sections).toEqual([
      { name: "a", text: "A2" },
      { name: "c", text: "C1" },
    ]);
    expect(state?.text).toBe("Base.\n\nExtra.\n\nA2\n\nC1");
    expect(state?.tools.map((t) => t.name)).toEqual(["read", "grep"]);
    expect(state?.declaredToolNames).toEqual(["read", "write", "grep"]);
  });

  it("a system message with replace: true discards the earlier prompt and tools", () => {
    const state = replaySystemMessages([
      systemMessage("s0", { content: "Old.", sections: { a: "A" }, toolsAdded: [tool("read")] }),
      systemMessage("s1", { content: "New.", replace: true, toolsAdded: [tool("bash")] }),
    ]);

    expect(state?.text).toBe("New.");
    expect(state?.tools.map((t) => t.name)).toEqual(["bash"]);
    expect(state?.declaredToolNames).toEqual(["read", "bash"]);
  });

  it("a compaction entry's systemMessage checkpoint becomes the new complete baseline", () => {
    const state = replaySystemMessages([
      systemMessage("s0", { content: "Base.", sections: { a: "A" }, toolsAdded: [tool("read"), tool("write")] }),
      userMessage("u1"),
      {
        type: "compaction",
        id: "c1",
        summary: "...",
        firstKeptEntryId: "u1",
        tokensBefore: 1,
        systemMessage: { role: "system", content: "Checkpoint.", sections: { b: "B" }, toolsAdded: [tool("read")], timestamp: 0 },
      },
    ]);

    expect(state?.text).toBe("Checkpoint.\n\nB");
    expect(state?.tools.map((t) => t.name)).toEqual(["read"]);
  });

  it("ignores a compaction entry without a systemMessage (older sessions)", () => {
    const state = replaySystemMessages([
      systemMessage("s0", { content: "Base." }),
      { type: "compaction", id: "c1", summary: "...", firstKeptEntryId: "c1", tokensBefore: 1 },
    ]);

    expect(state?.text).toBe("Base.");
  });

  it("skips malformed sections/tools rather than throwing", () => {
    const state = replaySystemMessages([
      systemMessage("s0", { content: 42, sections: "nope", toolsAdded: [null, { description: "no name" }, tool("read")] }),
    ]);

    expect(state).toEqual({ baseContent: "", sections: [], text: "", tools: [tool("read")], declaredToolNames: ["read"] });
  });
});
