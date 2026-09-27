import { describe, expect, it } from "vitest";
import { parseShellCommand } from "./shell-command-parser.js";

describe("parseShellCommand", () => {
  it.each([
    ["npm test", "npm"],
    ["definitely-not-installed-tool --version", "definitely-not-installed-tool"],
    ["/usr/bin/git status", "git"],
    ["FOO=1 BAR=2 npm run build", "npm"],
    ["sudo apt-get install -y jq", "apt-get"],
    ["env NODE_ENV=test npx vitest run", "npx"],
    ["timeout 1 sleep 5; echo exit=$?", "sleep"],
    ["time cargo build", "cargo"],
    ["cd packages/server && npm run build", "npm"],
    ["cd /home/dev/no-such-dir && ls", "ls"],
    ["cd /tmp", "cd"],
    ["python3 -c \"import no_such_module_xyz\"", "python3"],
    ["node -e \"require('x')\" 2>&1 | head -3; exit 1", "node"],
    ["'my tool' --flag", "my tool"],
    ["  git   -C /tmp   status ", "git"],
    ["(cd sub && make)", "make"],
    // Shell keywords are control flow, not programs (seen in real sessions).
    ["for f in *.ts; do wc -l $f; done", "wc"],
    ["until curl -sf localhost; do sleep 1; done", "curl"],
    ["while true; do npm test; done", "true"],
    ["if [ -f x ]; then make; fi", "["],
    ["! grep -q foo x", "grep"],
  ])("finds the program of %j", (command, program) => {
    expect(parseShellCommand(command).program).toBe(program);
  });

  it("normalizes whitespace for retry matching", () => {
    expect(parseShellCommand("  git   -C /tmp   status ").normalized).toBe("git -C /tmp status");
  });

  it("returns no program for an empty command", () => {
    expect(parseShellCommand("   ").program).toBeUndefined();
  });
});
