import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { auditRollupSchema, type LogProviderStatus } from "@copilot-cost-analyzer/domain";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { FakeProvider, lookup, sampleSessions } from "../test-support/audit-fakes.js";
import { createAuditMcpServer } from "./audit-mcp-server.js";

const providerStatus: LogProviderStatus = {
  activeProviderId: "fake",
  providers: [{ id: "fake", label: "Fake", available: true }],
};

function jsonOf(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const [first] = result.content as { type: string; text: string }[];
  return JSON.parse(first.text);
}

describe("audit MCP server", () => {
  let client: Client;

  beforeEach(async () => {
    const server = createAuditMcpServer({
      auditQueries: new AuditQueryService(lookup(new FakeProvider("fake", sampleSessions))),
      getProviderStatus: async () => providerStatus,
      version: "0.0.0-test",
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
  });

  it("exposes read-only audit tools", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_audit_rollup",
      "get_session_audit",
      "list_log_providers",
      "list_sessions",
      "list_tool_calls",
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("list_log_providers returns the provider status", async () => {
    const result = await client.callTool({ name: "list_log_providers", arguments: {} });
    expect(jsonOf(result)).toEqual(providerStatus);
  });

  it("list_sessions returns compact summaries in a date window", async () => {
    const result = await client.callTool({ name: "list_sessions", arguments: { since: "2026-09-15" } });

    expect(jsonOf(result)).toEqual({
      sessions: [
        { id: "new", title: "Session new", startedAt: "2026-09-27T08:00:00.000Z", turnCount: 2, providerId: "fake" },
        { id: "mid", title: "Session mid", startedAt: "2026-09-20T08:00:00.000Z", turnCount: 1, providerId: "fake" },
      ],
    });
  });

  it("get_session_audit omits the per-call list unless asked, to keep responses small", async () => {
    const compact = jsonOf(await client.callTool({ name: "get_session_audit", arguments: { sessionId: "mid" } })) as Record<
      string,
      unknown
    >;
    expect(compact.calls).toBeUndefined();
    expect((compact.totals as { failed: number }).failed).toBe(1);

    const full = jsonOf(
      await client.callTool({ name: "get_session_audit", arguments: { sessionId: "mid", includeCalls: true } }),
    ) as { calls: unknown[] };
    expect(full.calls).toHaveLength(2);
  });

  it("list_tool_calls filters by status and category", async () => {
    const result = await client.callTool({
      name: "list_tool_calls",
      arguments: { sessionId: "mid", status: ["error"], failureCategory: ["wrong-directory"] },
    });

    const body = jsonOf(result) as { total: number; calls: { call: { shell: { command: string } } }[] };
    expect(body.total).toBe(1);
    expect(body.calls[0].call.shell.command).toBe("cd x && ls");
  });

  it("get_audit_rollup returns a valid rollup", async () => {
    const result = await client.callTool({ name: "get_audit_rollup", arguments: {} });

    const rollup = auditRollupSchema.parse(jsonOf(result));
    expect(rollup.sessionCount).toBe(3);
    expect(rollup.topFailingCommands[0].command).toBe("foo");
  });

  it("reports an unknown session as a tool error, not a crash", async () => {
    const result = await client.callTool({ name: "get_session_audit", arguments: { sessionId: "missing" } });
    expect(result.isError).toBe(true);
  });

  it("reports an unknown provider as a tool error", async () => {
    const result = await client.callTool({ name: "list_sessions", arguments: { provider: "nope" } });
    expect(result.isError).toBe(true);
  });

  it("rejects an invalid enum value through input validation", async () => {
    const result = await client.callTool({ name: "list_tool_calls", arguments: { sessionId: "mid", status: ["bogus"] } });
    expect(result.isError).toBe(true);
  });

  it("offers an audit_session prompt", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("audit_session");

    const prompt = await client.getPrompt({ name: "audit_session", arguments: { sessionId: "mid" } });
    const text = (prompt.messages[0].content as { text: string }).text;
    expect(text).toContain("get_session_audit");
    expect(text).toContain("mid");
  });
});
