import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { composeLogProviders } from "../composition/compose-log-providers.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { createAuditMcpServer } from "./audit-mcp-server.js";

// stdio entry point for `claude mcp add` (see docs/plans/tool-call-audit.md
// §10 and scripts/mcp-server.sh). stdout carries JSON-RPC only — anything
// diagnostic must go to stderr.
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as { version: string };

const { registry } = composeLogProviders();
const server = createAuditMcpServer({
  auditQueries: new AuditQueryService(registry),
  getProviderStatus: () => registry.getStatus(),
  version,
});

await server.connect(new StdioServerTransport());
console.error(`copilot-cost-analyzer MCP server ${version} ready on stdio (read-only, local logs only).`);
