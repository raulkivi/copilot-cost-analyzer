import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listClaudeCodeSessionFiles, resolveClaudeCodeProjectsDir } from "./resolve-claude-code-projects-dir.js";

describe("resolveClaudeCodeProjectsDir", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(path.join(tmpdir(), "claude-code-paths-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("returns null when ~/.claude/projects does not exist", () => {
    expect(resolveClaudeCodeProjectsDir({ homeDir })).toBeNull();
  });

  it("returns the projects dir when it exists", () => {
    const projectsDir = path.join(homeDir, ".claude", "projects");
    mkdirSync(projectsDir, { recursive: true });

    expect(resolveClaudeCodeProjectsDir({ homeDir })).toBe(projectsDir);
  });
});

describe("listClaudeCodeSessionFiles", () => {
  let projectsDir: string;

  beforeEach(() => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "claude-code-projects-"));
  });

  afterEach(() => {
    rmSync(projectsDir, { recursive: true, force: true });
  });

  it("returns an empty array when the projects dir does not exist", () => {
    expect(listClaudeCodeSessionFiles(path.join(projectsDir, "missing"))).toEqual([]);
  });

  it("finds .jsonl session files one level under an encoded-cwd project directory", () => {
    const projectDir = path.join(projectsDir, "-home-user-my-project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "11111111-1111-1111-1111-111111111111.jsonl"), "");
    writeFileSync(path.join(projectDir, "not-a-session.txt"), "");

    expect(listClaudeCodeSessionFiles(projectsDir)).toEqual([
      path.join(projectDir, "11111111-1111-1111-1111-111111111111.jsonl"),
    ]);
  });

  it("does not recurse into a session's sibling <session-id>/ subagent-transcripts directory", () => {
    const projectDir = path.join(projectsDir, "-home-user-my-project");
    const sessionId = "22222222-2222-2222-2222-222222222222";
    mkdirSync(path.join(projectDir, sessionId, "subagents"), { recursive: true });
    writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), "");
    writeFileSync(path.join(projectDir, sessionId, "subagents", "agent-1.jsonl"), "");

    expect(listClaudeCodeSessionFiles(projectsDir)).toEqual([path.join(projectDir, `${sessionId}.jsonl`)]);
  });

  it("collects files across multiple project subdirectories, sorted", () => {
    const projectA = path.join(projectsDir, "-project-a");
    const projectB = path.join(projectsDir, "-project-b");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    writeFileSync(path.join(projectB, "2_b.jsonl"), "");
    writeFileSync(path.join(projectA, "1_a.jsonl"), "");

    expect(listClaudeCodeSessionFiles(projectsDir)).toEqual([
      path.join(projectA, "1_a.jsonl"),
      path.join(projectB, "2_b.jsonl"),
    ]);
  });
});
