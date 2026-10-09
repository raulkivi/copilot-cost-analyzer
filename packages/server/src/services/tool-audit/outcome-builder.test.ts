import { describe, expect, it } from "vitest";
import { toolCallOutcomeSchema } from "@copilot-cost-analyzer/domain";
import { buildToolCallOutcome } from "./outcome-builder.js";

describe("buildToolCallOutcome", () => {
  it("returns a bare success", () => {
    expect(buildToolCallOutcome({ kind: "shell", status: "success", text: "ok" })).toEqual({ status: "success" });
  });

  it("classifies a failure and keeps the exit code", () => {
    const outcome = buildToolCallOutcome({
      kind: "shell",
      status: "error",
      exitCode: 127,
      text: "/bin/bash: line 1: foo: command not found",
    });
    expect(outcome).toEqual({
      status: "error",
      exitCode: 127,
      failureCategory: "command-not-found",
      classificationEvidence: { ruleId: "text.command-not-found", excerpt: "/bin/bash: line 1: foo: command not found" },
    });
    expect(() => toolCallOutcomeSchema.parse(outcome)).not.toThrow();
  });

  it("classifies interrupted and denied calls too", () => {
    expect(buildToolCallOutcome({ kind: "shell", status: "interrupted", exitCode: 143, text: "Command timed out after 2s" }).failureCategory).toBe(
      "timeout",
    );
    expect(
      buildToolCallOutcome({ kind: "shell", status: "denied", text: "The user doesn't want to proceed with this tool use." })
        .failureCategory,
    ).toBe("user-rejected");
  });

  it("returns unknown with its reason", () => {
    expect(buildToolCallOutcome({ kind: "shell", status: "unknown", text: "", reason: "no result" })).toEqual({
      status: "unknown",
      reason: "no result",
    });
  });
});
