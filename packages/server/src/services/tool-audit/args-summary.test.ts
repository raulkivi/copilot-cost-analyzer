import { describe, expect, it } from "vitest";
import { MAX_ARGS_SUMMARY_LENGTH, summarizeToolArgs } from "./args-summary.js";

describe("summarizeToolArgs", () => {
  it("uses the command line for a shell call", () => {
    expect(summarizeToolArgs("shell", { command: "npm test", description: "run tests" })).toBe("npm test");
  });

  it("uses the path for file tools", () => {
    expect(summarizeToolArgs("file-read", { file_path: "/a/b.ts", limit: 10 })).toBe("/a/b.ts");
    expect(summarizeToolArgs("file-write", { filePath: "src/x.ts", content: "x".repeat(50_000) })).toBe("src/x.ts");
  });

  it("uses the pattern for search tools", () => {
    expect(summarizeToolArgs("search", { pattern: "TODO", path: "src" })).toBe("TODO in src");
  });

  it("bounds an arbitrarily large payload (F7: never the whole file content)", () => {
    const summary = summarizeToolArgs("other", { content: "y".repeat(50_000) });
    expect(summary.length).toBeLessThanOrEqual(MAX_ARGS_SUMMARY_LENGTH);
  });

  it("redacts secrets", () => {
    expect(summarizeToolArgs("shell", { command: "curl -H 'Authorization: Bearer abcdefghijklmnop' x" })).not.toContain(
      "abcdefghijklmnop",
    );
  });

  it("returns an empty string when there is no input", () => {
    expect(summarizeToolArgs("other", undefined)).toBe("");
  });
});
