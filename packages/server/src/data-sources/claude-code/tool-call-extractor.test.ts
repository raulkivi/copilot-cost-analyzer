import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";
import { extractToolCalls } from "./tool-call-extractor.js";
import { indexToolResults } from "./tool-result-index.js";

function userText(uuid: string, text = "hi"): ClaudeCodeRawEntry {
  return { type: "user", uuid, message: { role: "user", content: [{ type: "text", text }] } };
}

function assistantBlock(uuid: string, messageId: string, block: Record<string, unknown>, timestamp?: string): ClaudeCodeRawEntry {
  return {
    type: "assistant",
    uuid,
    cwd: "/home/dev/project",
    ...(timestamp ? { timestamp } : {}),
    message: { id: messageId, role: "assistant", model: "claude-sonnet-5", content: [block] },
  };
}

function toolResult(
  uuid: string,
  toolUseId: string,
  content: unknown = "ok",
  extra: { is_error?: boolean; timestamp?: string } = {},
): ClaudeCodeRawEntry {
  const { timestamp, ...block } = extra;
  return {
    type: "user",
    uuid,
    ...(timestamp ? { timestamp } : {}),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content, ...block }] },
  };
}

function group(entries: ClaudeCodeRawEntry[]): ClaudeCodeTurnGroup {
  return { userMessageEntry: entries[0], entries };
}

describe("extractToolCalls (Claude Code)", () => {
  it("builds one ToolCallRecord per tool_use content block, reading name/input directly off the block", () => {
    const g = group([
      userText("u1"),
      assistantBlock("a1", "m1", { type: "tool_use", id: "call-1", name: "Read", input: { file_path: "/a.ts" } }),
      toolResult("tr1", "call-1", "file contents"),
    ]);

    const toolCalls = extractToolCalls(g);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ id: "call-1", name: "Read", kind: "file-read", argsSummary: "/a.ts", roundIndex: 0 });
    expect(toolCalls[0].outcome).toEqual({ status: "success" });
  });

  it("returns one record per tool_use block even under parallel tool calls interleaved with results", () => {
    const g = group([
      userText("u1"),
      assistantBlock("a1", "m1", { type: "tool_use", id: "call-1", name: "Bash", input: { command: "ls" } }),
      toolResult("tr1", "call-1"),
      assistantBlock("a2", "m1", { type: "tool_use", id: "call-2", name: "Bash", input: { command: "pwd" } }),
      toolResult("tr2", "call-2"),
    ]);

    expect(extractToolCalls(g).map((t) => t.name)).toEqual(["Bash", "Bash"]);
  });

  it("returns an empty array when the turn made no tool calls", () => {
    expect(extractToolCalls(group([userText("u1")]))).toEqual([]);
  });

  it("describes a failed shell call: program, cwd, exit code, classified category, duration", () => {
    const g = group([
      userText("u1"),
      assistantBlock(
        "a1",
        "m1",
        { type: "tool_use", id: "call-1", name: "Bash", input: { command: "cd pkg && npm run build" } },
        "2026-09-27T12:00:00.000Z",
      ),
      toolResult("tr1", "call-1", "Exit code 1\n/bin/bash: line 1: cd: pkg: No such file or directory", {
        is_error: true,
        timestamp: "2026-09-27T12:00:01.500Z",
      }),
    ]);

    const [call] = extractToolCalls(g);

    expect(call.shell).toEqual({ command: "cd pkg && npm run build", program: "npm", cwd: "/home/dev/project" });
    expect(call.outcome).toMatchObject({ status: "error", exitCode: 1, failureCategory: "wrong-directory" });
    expect(call.startedAt).toBe("2026-09-27T12:00:00.000Z");
    expect(call.durationMs).toBe(1500);
  });

  it("pairs results from the whole-file index, since parallel results can sit off the active branch", () => {
    const branchOnly = group([
      userText("u1"),
      assistantBlock("a1", "m1", { type: "tool_use", id: "call-1", name: "Bash", input: { command: "foo" } }),
      assistantBlock("a2", "m1", { type: "tool_use", id: "call-2", name: "Bash", input: { command: "ls" } }),
      toolResult("tr2", "call-2"),
    ]);
    const offBranch = toolResult("tr1", "call-1", "Exit code 127\n/bin/bash: line 1: foo: command not found", { is_error: true });
    const index = indexToolResults([...branchOnly.entries, offBranch]);

    const calls = extractToolCalls(branchOnly, index);

    expect(calls[0].outcome).toMatchObject({ status: "error", failureCategory: "command-not-found" });
  });

  it("marks a call with no result anywhere as unknown, with a reason", () => {
    const g = group([userText("u1"), assistantBlock("a1", "m1", { type: "tool_use", id: "call-1", name: "Bash", input: { command: "x" } })]);

    const [call] = extractToolCalls(g);

    expect(call.outcome?.status).toBe("unknown");
    expect(call.outcome?.reason).toMatch(/no tool_result/i);
  });

  it("numbers rounds by message.id order", () => {
    const g = group([
      userText("u1"),
      assistantBlock("a1", "m1", { type: "tool_use", id: "c1", name: "Bash", input: { command: "a" } }),
      toolResult("tr1", "c1"),
      assistantBlock("a2", "m2", { type: "tool_use", id: "c2", name: "Bash", input: { command: "b" } }),
      toolResult("tr2", "c2"),
    ]);

    expect(extractToolCalls(g).map((c) => c.roundIndex)).toEqual([0, 1]);
  });
});
