import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseClaudeCodeJsonlLine, readClaudeCodeSessionFile } from "./claude-code-jsonl-reader.js";

describe("parseClaudeCodeJsonlLine", () => {
  it("parses a user entry, keeping the nested message payload intact", () => {
    const line = JSON.stringify({
      parentUuid: null,
      type: "user",
      uuid: "u1",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
      sessionId: "s1",
    });

    const parsed = parseClaudeCodeJsonlLine(line);

    expect(parsed?.type).toBe("user");
    expect(parsed?.uuid).toBe("u1");
    expect((parsed?.message as { role: string }).role).toBe("user");
  });

  it("parses an entry whose parentUuid is null", () => {
    const line = JSON.stringify({ type: "user", uuid: "u1", parentUuid: null });

    expect(parseClaudeCodeJsonlLine(line)?.parentUuid).toBeNull();
  });

  it("returns null for a malformed line rather than throwing", () => {
    expect(parseClaudeCodeJsonlLine("{not json")).toBeNull();
  });

  it("returns null for a line without a string type field", () => {
    expect(parseClaudeCodeJsonlLine(JSON.stringify({ uuid: "u1" }))).toBeNull();
  });

  it("returns null for a blank line", () => {
    expect(parseClaudeCodeJsonlLine("   ")).toBeNull();
  });
});

describe("readClaudeCodeSessionFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "claude-code-jsonl-reader-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty result for a missing file", async () => {
    const result = await readClaudeCodeSessionFile(path.join(dir, "missing.jsonl"));

    expect(result).toEqual({ entries: [], rawLineCount: 0 });
  });

  it("collects every recognized entry and skips malformed lines, counting all raw lines", async () => {
    const filePath = path.join(dir, "session.jsonl");
    writeFileSync(
      filePath,
      [
        JSON.stringify({ type: "user", uuid: "u1", parentUuid: null, message: { role: "user", content: "hi" } }),
        "{not json at all",
        JSON.stringify({ type: "assistant", uuid: "a1", parentUuid: "u1", message: { id: "m1", role: "assistant" } }),
        "",
      ].join("\n"),
    );

    const result = await readClaudeCodeSessionFile(filePath);

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].uuid).toBe("u1");
    expect(result.entries[1].type).toBe("assistant");
    expect(result.rawLineCount).toBe(3);
  });

  it("streams the file rather than buffering it whole (a very large file does not throw)", async () => {
    const filePath = path.join(dir, "large.jsonl");
    const line = JSON.stringify({ type: "attachment", uuid: "x", parentUuid: null });
    writeFileSync(filePath, `${Array(5000).fill(line).join("\n")}\n`);

    const result = await readClaudeCodeSessionFile(filePath);

    expect(result.entries).toHaveLength(5000);
  });
});
