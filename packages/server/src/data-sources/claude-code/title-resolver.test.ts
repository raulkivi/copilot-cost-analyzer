import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { resolveClaudeCodeTitle } from "./title-resolver.js";

function realUserEntry(overrides: Partial<ClaudeCodeRawEntry> = {}): ClaudeCodeRawEntry {
  return {
    type: "user",
    uuid: "u1",
    message: { role: "user", content: [{ type: "text", text: "hi" }] },
    cwd: "/home/dev/my-project",
    slug: "fix-the-thing",
    ...overrides,
  };
}

describe("resolveClaudeCodeTitle", () => {
  it("prefers the latest ai-title entry's aiTitle", () => {
    const entries: ClaudeCodeRawEntry[] = [
      realUserEntry(),
      { type: "ai-title", aiTitle: "First title" },
      { type: "ai-title", aiTitle: "Second, more recent title" },
    ];

    expect(resolveClaudeCodeTitle(entries)).toBe("Second, more recent title");
  });

  it("falls back to the first real user entry's slug when there is no ai-title entry", () => {
    expect(resolveClaudeCodeTitle([realUserEntry()])).toBe("fix-the-thing");
  });

  it("falls back to path.basename(cwd) when there is no slug either", () => {
    const entry = realUserEntry();
    delete (entry as Record<string, unknown>).slug;

    expect(resolveClaudeCodeTitle([entry])).toBe("my-project");
  });

  it("falls back to a generic title when nothing else is available", () => {
    expect(resolveClaudeCodeTitle([])).toBe("Claude Code session");
  });

  it("ignores a tool-result-delivery 'user' entry when looking for the first real user entry", () => {
    const toolResultEntry: ClaudeCodeRawEntry = {
      type: "user",
      uuid: "tr1",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "ok" }] },
      cwd: "/should/not/be/used",
    };

    expect(resolveClaudeCodeTitle([toolResultEntry, realUserEntry()])).toBe("fix-the-thing");
  });
});
