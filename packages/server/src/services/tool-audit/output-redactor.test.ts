import { describe, expect, it } from "vitest";
import { excerptOf, redactSecrets } from "./output-redactor.js";

describe("redactSecrets", () => {
  it.each([
    ["token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked", "abcdefghijklmnop"],
    ["key sk-ant-api03-abcdefghijklmnopqrstuv", "abcdefghijklmnop"],
    ["OPENAI sk-proj-abcdefghijklmnopqrstuv", "abcdefghijklmnop"],
    ["aws AKIAABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOP"],
    ["Authorization: Bearer abc.def.ghi-jkl_123456", "abc.def"],
    ["password=hunter2hunter2", "hunter2"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", "eyJzdWIiOiIxIn0"],
  ])("masks the secret in %j", (input, secret) => {
    const redacted = redactSecrets(input);
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain(secret);
  });

  it("leaves ordinary error text alone", () => {
    const text = "/bin/bash: line 1: foo: command not found";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("excerptOf", () => {
  it("truncates to the limit with an ellipsis", () => {
    const excerpt = excerptOf("x".repeat(500), 200);
    expect(excerpt.length).toBe(200);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("redacts before truncating", () => {
    expect(excerptOf("ghp_abcdefghijklmnopqrstuvwxyz0123456789", 200)).toBe("[REDACTED]");
  });
});
