import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { failureCategorySchema, toolCallStatusSchema, type LogProviderStatus } from "@copilot-cost-analyzer/domain";
import type { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { isoDateBoundSchema, limitSchema, turnIndexSchema } from "../services/tool-audit/audit-query-params.js";

// Local, read-only MCP interface over the tool-call audit
// (docs/plans/tool-call-audit.md §10) so a user can attach this analyzer
// to Claude Code or any MCP-capable harness and query their own sessions.
// Transport-agnostic: stdio.ts connects it over stdio; tests connect it
// in memory.

export interface AuditMcpServerDeps {
  auditQueries: AuditQueryService;
  getProviderStatus: () => Promise<LogProviderStatus>;
  version: string;
}

const DEFAULT_SESSION_LIST_LIMIT = 20;
const DEFAULT_TOOL_CALL_LIMIT = 50;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const providerArg = z
  .string()
  .optional()
  .describe("Log provider id (see list_log_providers). Defaults to the provider currently active in the app.");

function json(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

async function guarded(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    return toolError((error as Error).message);
  }
}

export function createAuditMcpServer({ auditQueries, getProviderStatus, version }: AuditMcpServerDeps): McpServer {
  const server = new McpServer({ name: "copilot-cost-analyzer", version });

  server.registerTool(
    "list_log_providers",
    {
      title: "List log providers",
      description:
        "Lists the local agent-log sources this analyzer can read (VS Code Copilot Chat, Claude Code CLI, pi, mitmproxy captures), whether each is available, and which is active.",
      annotations: READ_ONLY,
    },
    () => guarded(async () => json(await getProviderStatus())),
  );

  server.registerTool(
    "list_sessions",
    {
      title: "List sessions",
      description: "Lists agent sessions, most recent first, optionally within a date window. Use the ids with the other tools.",
      inputSchema: {
        provider: providerArg,
        since: isoDateBoundSchema.optional().describe("Earliest session start, ISO date or timestamp (inclusive)."),
        until: isoDateBoundSchema.optional().describe("Latest session start, ISO date or timestamp (inclusive)."),
        limit: limitSchema.optional().describe(`Maximum sessions to return (default ${DEFAULT_SESSION_LIST_LIMIT}).`),
      },
      annotations: READ_ONLY,
    },
    ({ provider, since, until, limit }) =>
      guarded(async () => {
        const sessions = await auditQueries.listSessions({
          providerId: provider,
          since,
          until,
          limit: limit ?? DEFAULT_SESSION_LIST_LIMIT,
        });
        return json({
          sessions: sessions.map((session) => ({
            id: session.id,
            title: session.title,
            ...(session.startedAt ? { startedAt: session.startedAt } : {}),
            turnCount: session.turnCount,
            ...(session.providerId ? { providerId: session.providerId } : {}),
          })),
        });
      }),
  );

  server.registerTool(
    "get_session_audit",
    {
      title: "Get session tool-call audit",
      description:
        "Audits one session's tool calls: totals by outcome (success/error/interrupted/denied/unknown), failure rate, breakdowns by tool, shell program and failure category (command-not-found, wrong-directory, invalid-arguments, dependency-missing, git-state, ...), per-turn counts, retried commands, failure-recovery cost and outcome coverage. Set includeCalls for every classified call (can be large; prefer list_tool_calls with filters).",
      inputSchema: {
        sessionId: z.string().describe("Session id from list_sessions."),
        provider: providerArg,
        includeCalls: z.boolean().optional().describe("Include every classified tool call (default false)."),
      },
      annotations: READ_ONLY,
    },
    ({ sessionId, provider, includeCalls }) =>
      guarded(async () => {
        const audit = await auditQueries.getSessionAudit(sessionId, provider);
        if (!audit) {
          return toolError(`Unknown session id "${sessionId}".`);
        }
        if (includeCalls) {
          return json(audit);
        }
        const { calls: _calls, ...compact } = audit;
        void _calls;
        return json(compact);
      }),
  );

  server.registerTool(
    "list_tool_calls",
    {
      title: "List classified tool calls",
      description:
        "Lists one session's tool calls with outcome, exit code, failure category, redacted stderr excerpt, command/program and turn index, filtered by status, failure category, tool name, shell program or turn.",
      inputSchema: {
        sessionId: z.string().describe("Session id from list_sessions."),
        provider: providerArg,
        status: z.array(toolCallStatusSchema).optional().describe("Keep only these outcomes, e.g. [\"error\",\"interrupted\"]."),
        failureCategory: z.array(failureCategorySchema).optional().describe("Keep only these failure categories."),
        tool: z.string().optional().describe("Exact tool name, e.g. \"Bash\" or \"run_in_terminal\"."),
        program: z.string().optional().describe("Shell program, e.g. \"npm\" or \"git\"."),
        turnIndex: turnIndexSchema.optional().describe("Only this turn."),
        limit: limitSchema.optional().describe(`Maximum calls to return (default ${DEFAULT_TOOL_CALL_LIMIT}); total is always reported.`),
      },
      annotations: READ_ONLY,
    },
    ({ sessionId, provider, limit, ...filter }) =>
      guarded(async () => {
        const result = await auditQueries.listToolCalls(sessionId, { ...filter, limit: limit ?? DEFAULT_TOOL_CALL_LIMIT }, provider);
        return result ? json(result) : toolError(`Unknown session id "${sessionId}".`);
      }),
  );

  server.registerTool(
    "get_audit_rollup",
    {
      title: "Get cross-session audit rollup",
      description:
        "Aggregates tool-call outcomes across the most recent sessions in a date window: totals, failure rate, top failing commands (with how many sessions they failed in), failures per day, per-session summary, and breakdowns by tool, program and failure category.",
      inputSchema: {
        provider: providerArg,
        since: isoDateBoundSchema.optional().describe("Earliest session start, ISO date or timestamp (inclusive)."),
        until: isoDateBoundSchema.optional().describe("Latest session start, ISO date or timestamp (inclusive)."),
        limit: limitSchema.optional().describe("Maximum sessions to include, most recent first (default 50, max 500)."),
      },
      annotations: READ_ONLY,
    },
    ({ provider, since, until, limit }) =>
      guarded(async () => json(await auditQueries.getRollup({ providerId: provider, since, until, limit }))),
  );

  server.registerPrompt(
    "audit_session",
    {
      title: "Audit a session's tool calls",
      description: "Explain why an agent session's tool calls failed and how to avoid it next time.",
      argsSchema: { sessionId: z.string(), provider: z.string().optional() },
    },
    ({ sessionId, provider }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Audit the tool calls of session "${sessionId}"${provider ? ` (provider "${provider}")` : ""}. ` +
              "Call get_session_audit first, then list_tool_calls with status [\"error\",\"interrupted\",\"denied\"] for the evidence. " +
              "Group the failures by category (missing utility, wrong directory, bad arguments, missing dependency, git state, ...), " +
              "name the commands and turns involved, point out retried commands and the tokens spent in affected turns, " +
              "and give concrete fixes (e.g. install a tool, run from the right directory, correct a flag, add a CLAUDE.md hint). " +
              "Say explicitly when outcome coverage is incomplete.",
          },
        },
      ],
    }),
  );

  return server;
}
