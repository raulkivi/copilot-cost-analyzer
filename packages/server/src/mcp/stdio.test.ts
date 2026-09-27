import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// End-to-end: spawns the real stdio entry point (what `claude mcp add`
// runs) against a temporary HOME holding the real-capture Claude Code
// fixture. Also proves nothing else writes to stdout, which would corrupt
// the JSON-RPC stream.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const fixtureProjectDir = path.resolve(here, "../../fixtures/claude-code-audit/-home-dev-project");

describe("stdio MCP entry point", () => {
  let home: string;
  let client: Client;

  beforeAll(async () => {
    home = mkdtempSync(path.join(tmpdir(), "mcp-stdio-home-"));
    cpSync(fixtureProjectDir, path.join(home, ".claude", "projects", "-home-dev-project"), { recursive: true });
    client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: path.join(repoRoot, "node_modules", ".bin", "tsx"),
        args: [path.join(here, "stdio.ts")],
        env: { PATH: process.env.PATH ?? "", HOME: home },
        stderr: "ignore",
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    rmSync(home, { recursive: true, force: true });
  });

  it("audits the fixture session through the claude-code provider", async () => {
    const sessions = await client.callTool({ name: "list_sessions", arguments: { provider: "claude-code" } });
    const [session] = (sessions.structuredContent as { sessions: { id: string }[] }).sessions;

    const audit = await client.callTool({ name: "get_session_audit", arguments: { sessionId: session.id, provider: "claude-code" } });

    expect(audit.isError).toBeFalsy();
    expect((audit.structuredContent as { totals: { failed: number } }).totals.failed).toBe(10);
  }, 60_000);
});
