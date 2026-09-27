import { describe, expect, it } from "vitest";
import { classifyFailure, defaultFailureRules, type FailureRule } from "./failure-classifier.js";

// Strings are verbatim from a real Claude Code session (see
// fixtures/claude-code-audit/README.md) unless noted as another shell/OS.
describe("classifyFailure (real captured Claude Code output)", () => {
  it.each([
    [127, "/bin/bash: line 1: definitely-not-installed-tool: command not found", "command-not-found"],
    [1, "/bin/bash: line 1: cd: /home/user/no-such-dir: No such file or directory", "wrong-directory"],
    [2, "ls: unrecognized option '--no-such-flag-xyz'\nTry 'ls --help' for more information.", "invalid-arguments"],
    [128, "fatal: not a git repository (or any of the parent directories): .git", "git-state"],
    [126, "/bin/bash: line 1: /tmp/noexec.sh: Permission denied", "permission-denied"],
    [
      1,
      'Traceback (most recent call last):\n  File "<string>", line 1, in <module>\nModuleNotFoundError: No module named \'no_such_module_xyz\'',
      "dependency-missing",
    ],
    [1, "node:internal/modules/cjs/loader:1386\n  throw err;\n  ^", "dependency-missing"],
    [6, "curl: (6) Could not resolve host: no-such-host-xyz.invalid", "network"],
    [143, "Command timed out after 2s", "timeout"],
  ])("exit %i: %j → %s", (exitCode, text, category) => {
    expect(classifyFailure({ kind: "shell", exitCode, text }).failureCategory).toBe(category);
  });

  it("classifies a Read of a missing file (no exit code)", () => {
    const result = classifyFailure({
      kind: "file-read",
      text: "File does not exist. Note: your current working directory is /home/dev/project.",
    });
    expect(result.failureCategory).toBe("file-not-found");
  });
});

describe("classifyFailure (other shells and tools)", () => {
  it.each([
    ["'foo' is not recognized as an internal or external command,", "command-not-found"],
    ["foo : The term 'foo' is not recognized as the name of a cmdlet, function", "command-not-found"],
    ["Error: spawn rg ENOENT", "command-not-found"],
    ["zsh: command not found: foo", "command-not-found"],
    ["npm ERR! enoent Could not read package.json: Error: ENOENT: no such file or directory, open '/x/package.json'", "wrong-directory"],
    ["error: could not find `Cargo.toml` in `/x` or any parent directory", "wrong-directory"],
    ["fatal: cannot change to '/nope': No such file or directory", "wrong-directory"],
    ["Error: Cannot find module 'lodash'", "dependency-missing"],
    ["CONFLICT (content): Merge conflict in src/a.ts", "git-state"],
    ["! [rejected]        main -> main (non-fast-forward)", "git-state"],
    ["error: unknown option `--frobnicate'", "invalid-arguments"],
    ["usage: git [-v | --version] [-h | --help]", "invalid-arguments"],
    ["error: the following arguments are required: path", "invalid-arguments"],
    ["<tool_use_error>InputValidationError: Bash failed due to the following issue:\nThe required parameter `command` is missing</tool_use_error>", "tool-input-invalid"],
    ["The user doesn't want to proceed with this tool use. The tool use was rejected", "user-rejected"],
    ["Tests  2 failed | 48 passed (50)", "test-or-build-failure"],
    ["src/a.ts(3,1): error TS2304: Cannot find name 'x'.", "test-or-build-failure"],
    ["ls: cannot access '/nope': No such file or directory", "file-not-found"],
    ["curl: (7) Failed to connect to localhost port 9 : Connection refused", "network"],
  ])("%j → %s", (text, category) => {
    expect(classifyFailure({ kind: "shell", text }).failureCategory).toBe(category);
  });

  it("falls back to other-nonzero-exit when only the exit code is known", () => {
    const result = classifyFailure({ kind: "shell", exitCode: 3, text: "something odd happened" });
    expect(result.failureCategory).toBe("other-nonzero-exit");
    expect(result.evidence.ruleId).toBe("shell.nonzero-exit");
  });

  it("never guesses: no rule and no exit code → unclassified", () => {
    const result = classifyFailure({ kind: "other", text: "weird" });
    expect(result.failureCategory).toBe("unclassified");
    expect(result.evidence.ruleId).toBe("unclassified");
  });

  it("records the matching rule and the matched line as evidence", () => {
    const result = classifyFailure({
      kind: "shell",
      exitCode: 2,
      text: "ls: unrecognized option '--no-such-flag-xyz'\nTry 'ls --help' for more information.",
    });
    expect(result.evidence.ruleId).toBe("text.invalid-arguments");
    expect(result.evidence.excerpt).toBe("ls: unrecognized option '--no-such-flag-xyz'");
  });

  it("redacts secrets in evidence excerpts", () => {
    const result = classifyFailure({ kind: "shell", exitCode: 1, text: "auth failed for ghp_abcdefghijklmnopqrstuvwxyz0123456789" });
    expect(result.evidence.excerpt).not.toContain("ghp_abcdef");
  });

  it("accepts an injected rule set (open/closed)", () => {
    const rules: FailureRule[] = [
      { id: "custom.flaky", category: "network", match: ({ text }) => (text.includes("flaky") ? "flaky" : null) },
    ];
    expect(classifyFailure({ kind: "shell", text: "a flaky thing" }, rules).failureCategory).toBe("network");
    expect(defaultFailureRules.length).toBeGreaterThan(5);
  });
});
