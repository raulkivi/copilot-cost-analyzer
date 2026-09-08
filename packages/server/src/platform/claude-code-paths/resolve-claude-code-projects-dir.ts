import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

interface ResolveClaudeCodeProjectsDirOptions {
  homeDir?: string;
}

// Claude Code CLI writes every session it runs to one fixed root, one
// subdirectory per project (named from the project's absolute cwd, slashes
// replaced with dashes) — confirmed against real captures on this machine
// under ~/.claude/projects, no VS Code-style Stable/Insiders variants.
export function resolveClaudeCodeProjectsDir(
  options: ResolveClaudeCodeProjectsDirOptions = {},
): string | null {
  const homeDir = options.homeDir ?? homedir();
  const projectsDir = path.join(homeDir, ".claude", "projects");
  return existsSync(projectsDir) ? projectsDir : null;
}

// Walks exactly two levels: projectsDir/<encoded-cwd>/<session-id>.jsonl.
// Deliberately does not recurse into a third level — a session can have a
// sibling `<session-id>/` directory holding spawned subagent transcripts
// (`subagents/agent-*.jsonl`), out of scope for v1 (see the plan's
// decisions table). Not recursing excludes those structurally, without
// needing a filename convention to filter by. Sorted so callers get a
// stable order.
export function listClaudeCodeSessionFiles(projectsDir: string): string[] {
  if (!existsSync(projectsDir)) {
    return [];
  }

  const files: string[] = [];
  for (const projectName of readdirSync(projectsDir)) {
    const projectDir = path.join(projectsDir, projectName);
    if (!statSync(projectDir).isDirectory()) {
      continue;
    }
    for (const name of readdirSync(projectDir)) {
      const candidate = path.join(projectDir, name);
      if (statSync(candidate).isFile() && name.toLowerCase().endsWith(".jsonl")) {
        files.push(candidate);
      }
    }
  }
  return files.sort();
}
