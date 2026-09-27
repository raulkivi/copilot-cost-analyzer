import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { indexToolResults, interpretToolResult } from "./tool-result-index.js";

function resultEntry(toolUseId: string, block: Record<string, unknown>, toolUseResult?: unknown, uuid = `tr-${toolUseId}`): ClaudeCodeRawEntry {
  return {
    type: "user",
    uuid,
    timestamp: "2026-09-27T12:02:25.190Z",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, ...block }] },
    ...(toolUseResult !== undefined ? { toolUseResult } : {}),
  };
}

describe("indexToolResults", () => {
  it("indexes every tool_result in the file by tool_use_id, including off-branch ones", () => {
    const entries = [
      resultEntry("t1", { content: "ok", is_error: false }),
      { type: "assistant", uuid: "a1" },
      resultEntry("t2", { content: "Exit code 1\nboom", is_error: true }),
    ];
    const index = indexToolResults(entries);
    expect([...index.keys()]).toEqual(["t1", "t2"]);
    expect(index.get("t2")?.entry.uuid).toBe("tr-t2");
  });
});

// Shapes below are verbatim from a real Claude Code v2.1.x capture.
describe("interpretToolResult", () => {
  it("reads an error: is_error, 'Exit code N' first line, string toolUseResult", () => {
    const entry = resultEntry(
      "t",
      { content: "Exit code 127\n/bin/bash: line 1: foo: command not found", is_error: true },
      "Error: Exit code 127\n/bin/bash: line 1: foo: command not found",
    );
    expect(interpretToolResult(indexToolResults([entry]).get("t")!)).toEqual({
      status: "error",
      exitCode: 127,
      text: "/bin/bash: line 1: foo: command not found",
    });
  });

  it("reads a success with the structured toolUseResult", () => {
    const entry = resultEntry(
      "t",
      { content: "hi", is_error: false },
      { stdout: "hi", stderr: "", interrupted: false, isImage: false, noOutputExpected: false },
    );
    expect(interpretToolResult(indexToolResults([entry]).get("t")!)).toEqual({ status: "success", text: "hi" });
  });

  it("treats a harness timeout as interrupted", () => {
    const entry = resultEntry("t", { content: "Exit code 143\nCommand timed out after 2s", is_error: true });
    expect(interpretToolResult(indexToolResults([entry]).get("t")!)).toMatchObject({ status: "interrupted", exitCode: 143 });
  });

  it("treats toolUseResult.interrupted as interrupted", () => {
    const entry = resultEntry("t", { content: "partial", is_error: false }, { stdout: "partial", stderr: "", interrupted: true });
    expect(interpretToolResult(indexToolResults([entry]).get("t")!).status).toBe("interrupted");
  });

  it("treats a user rejection as denied", () => {
    const entry = resultEntry("t", {
      content:
        "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).",
      is_error: true,
    });
    expect(interpretToolResult(indexToolResults([entry]).get("t")!).status).toBe("denied");
  });

  it("reads a non-shell error without an exit code", () => {
    const entry = resultEntry("t", { content: "File does not exist. Note: your current working directory is /x.", is_error: true });
    expect(interpretToolResult(indexToolResults([entry]).get("t")!)).toEqual({
      status: "error",
      text: "File does not exist. Note: your current working directory is /x.",
    });
  });

  it("joins array content text blocks", () => {
    const entry = resultEntry("t", { content: [{ type: "text", text: "line a" }, { type: "text", text: "line b" }], is_error: true });
    expect(interpretToolResult(indexToolResults([entry]).get("t")!).text).toBe("line a\nline b");
  });

  it("treats a missing is_error as success (API default), per older captures", () => {
    const entry = resultEntry("t", { content: "1\texport const x = 1;" });
    expect(interpretToolResult(indexToolResults([entry]).get("t")!).status).toBe("success");
  });
});
