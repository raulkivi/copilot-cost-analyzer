import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeClaudeCodeFileHash, resolveClaudeCodeSessionFilePath } from "./session-id.js";

describe("computeClaudeCodeFileHash", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "claude-code-session-id-"));
    filePath = path.join(dir, "session.jsonl");
    writeFileSync(filePath, "content");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("computes a stable hash for the same unmodified file", () => {
    expect(computeClaudeCodeFileHash(filePath)).toBe(computeClaudeCodeFileHash(filePath));
  });

  it("computes a 16-character lowercase-hex hash", () => {
    expect(computeClaudeCodeFileHash(filePath)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("resolveClaudeCodeSessionFilePath", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "claude-code-session-id-resolve-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds the file whose computed hash matches the given session id", () => {
    const fileA = path.join(dir, "a.jsonl");
    const fileB = path.join(dir, "b.jsonl");
    writeFileSync(fileA, "a");
    writeFileSync(fileB, "b");

    const targetId = computeClaudeCodeFileHash(fileB);

    expect(resolveClaudeCodeSessionFilePath([fileA, fileB], targetId)).toBe(fileB);
  });

  it("returns undefined when no file matches", () => {
    const fileA = path.join(dir, "a.jsonl");
    writeFileSync(fileA, "a");

    expect(resolveClaudeCodeSessionFilePath([fileA], "does-not-exist")).toBeUndefined();
  });
});
