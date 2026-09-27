import { describe, expect, it } from "vitest";
import { toolCallRecordSchema } from "./tool-call-record.js";

describe("toolCallRecordSchema", () => {
  it("accepts a minimal tool call (Learn mode)", () => {
    const sample = { name: "read_file", argsSummary: "read package.json" };

    expect(toolCallRecordSchema.parse(sample)).toEqual(sample);
  });

  it("accepts a full tool call with Analyze-mode-only fields", () => {
    const sample = {
      name: "read_file",
      argsSummary: "read package.json",
      filesTouched: ["package.json"],
      tokenCount: { known: true, value: 12 },
    };

    expect(toolCallRecordSchema.parse(sample)).toEqual(sample);
  });

  it("rejects a tool call missing argsSummary", () => {
    expect(() => toolCallRecordSchema.parse({ name: "read_file" })).toThrow();
  });
});

describe("toolCallRecordSchema audit fields (Phase 9.10)", () => {
  it("accepts a shell call with outcome, timing and round index", () => {
    const sample = {
      id: "toolu_1",
      name: "Bash",
      kind: "shell",
      argsSummary: "npm test",
      shell: { command: "npm test", program: "npm", cwd: "/home/dev/project" },
      outcome: { status: "error", exitCode: 1, failureCategory: "test-or-build-failure" },
      startedAt: "2026-09-27T12:00:00.000Z",
      durationMs: 1200,
      roundIndex: 0,
    };

    expect(toolCallRecordSchema.parse(sample)).toEqual(sample);
  });

  it("rejects an unknown tool kind", () => {
    expect(() => toolCallRecordSchema.parse({ name: "x", argsSummary: "", kind: "teleport" })).toThrow();
  });
});
