import { describe, expect, it } from "vitest";
import { resolveToolKind } from "./tool-kind-resolver.js";

describe("resolveToolKind", () => {
  it.each([
    ["Bash", "shell"],
    ["run_in_terminal", "shell"],
    ["bash", "shell"],
    ["exec_command", "shell"],
    ["Read", "file-read"],
    ["read_file", "file-read"],
    ["Write", "file-write"],
    ["Edit", "file-write"],
    ["replace_string_in_file", "file-write"],
    ["Grep", "search"],
    ["Glob", "search"],
    ["WebFetch", "web"],
    ["mcp__github__get_me", "mcp"],
    ["Task", "subagent"],
    ["Agent", "subagent"],
    ["manage_todo_list", "other"],
  ])("maps %s to %s", (name, kind) => {
    expect(resolveToolKind(name)).toBe(kind);
  });
});
