import { z } from "zod";
import { failureCategorySchema, toolCallStatusSchema } from "@copilot-cost-analyzer/domain";
import type { SessionRangeFilter, ToolCallFilter } from "./audit-query-service.js";

// Field schemas shared by the HTTP query parser below and the MCP tool
// input schemas (mcp/audit-mcp-server.ts), so both surfaces validate the
// same way.
export const isoDateBoundSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/, "Expected an ISO date (YYYY-MM-DD) or timestamp");
export const limitSchema = z.number().int().positive().max(1000);
export const turnIndexSchema = z.number().int().nonnegative();

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

type Query = Record<string, unknown>;

function stringParam(query: Query, key: string): string | undefined {
  const value = query[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function list(query: Query, key: string): string[] | undefined {
  return stringParam(query, key)
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function integer(query: Query, key: string): number | undefined {
  const value = stringParam(query, key);
  return value === undefined ? undefined : /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

const toolCallFilterSchema = z.object({
  status: z.array(toolCallStatusSchema).optional(),
  failureCategory: z.array(failureCategorySchema).optional(),
  tool: z.string().optional(),
  program: z.string().optional(),
  turnIndex: turnIndexSchema.optional(),
  limit: limitSchema.optional(),
});

const sessionRangeSchema = z.object({
  providerId: z.string().optional(),
  since: isoDateBoundSchema.optional(),
  until: isoDateBoundSchema.optional(),
  limit: limitSchema.optional(),
});

function toResult<T>(parsed: { success: true; data: T } | { success: false; error: z.ZodError }): ParseResult<T> {
  return parsed.success
    ? { ok: true, value: compact(parsed.data as object) as T }
    : { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
}

export function parseToolCallFilterQuery(query: Query): ParseResult<ToolCallFilter> {
  return toResult(
    toolCallFilterSchema.safeParse(
      compact({
        status: list(query, "status"),
        failureCategory: list(query, "category"),
        tool: stringParam(query, "tool"),
        program: stringParam(query, "program"),
        turnIndex: integer(query, "turn"),
        limit: integer(query, "limit"),
      }),
    ),
  );
}

export function parseSessionRangeQuery(query: Query): ParseResult<SessionRangeFilter> {
  return toResult(
    sessionRangeSchema.safeParse(
      compact({
        providerId: stringParam(query, "provider"),
        since: stringParam(query, "since"),
        until: stringParam(query, "until"),
        limit: integer(query, "limit"),
      }),
    ),
  );
}
