import type { ToolKind } from "@copilot-cost-analyzer/domain";

// Maps each harness's own tool names (Claude Code, VS Code Copilot Chat,
// pi, Codex-style) onto one provider-neutral kind. Table-driven so adding a
// harness means adding rows, not branches (open/closed).
const KIND_BY_NAME: Record<string, ToolKind> = {
  bash: "shell",
  run_in_terminal: "shell",
  exec_command: "shell",
  shell: "shell",
  powershell: "shell",
  bashoutput: "shell",
  read: "file-read",
  read_file: "file-read",
  view: "file-read",
  notebookread: "file-read",
  write: "file-write",
  edit: "file-write",
  multiedit: "file-write",
  notebookedit: "file-write",
  create_file: "file-write",
  replace_string_in_file: "file-write",
  insert_edit_into_file: "file-write",
  apply_patch: "file-write",
  grep: "search",
  glob: "search",
  ls: "search",
  find: "search",
  grep_search: "search",
  file_search: "search",
  semantic_search: "search",
  list_dir: "search",
  webfetch: "web",
  websearch: "web",
  fetch_webpage: "web",
  task: "subagent",
  agent: "subagent",
  runsubagent: "subagent",
};

export function resolveToolKind(toolName: string): ToolKind {
  if (toolName.startsWith("mcp__") || toolName.startsWith("mcp_")) {
    return "mcp";
  }
  return KIND_BY_NAME[toolName.toLowerCase()] ?? "other";
}
