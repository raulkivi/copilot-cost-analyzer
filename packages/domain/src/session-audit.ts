import { z } from "zod";
import { tokenCountSchema } from "./token-count.js";
import { failureCategorySchema } from "./tool-call-outcome.js";
import { toolCallRecordSchema } from "./tool-call-record.js";

// Phase 9.10 (docs/plans/tool-call-audit.md §4): provider-agnostic
// aggregates computed server-side from normalized ToolCallRecords.

export const outcomeTotalsSchema = z.object({
  toolCalls: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  interrupted: z.number(),
  denied: z.number(),
  unknown: z.number(),
});

export type OutcomeTotals = z.infer<typeof outcomeTotalsSchema>;

// (failed + interrupted + denied) / calls with a known outcome; null when no
// call's outcome is known, so the UI never shows a fabricated 0%.
const failureRateSchema = z.number().min(0).max(1).nullable();

const toolBreakdownSchema = z.object({
  name: z.string(),
  calls: z.number(),
  failed: z.number(),
  totalDurationMs: z.number().optional(),
});

const programBreakdownSchema = z.object({ program: z.string(), calls: z.number(), failed: z.number() });

const categoryCountSchema = z.object({ category: failureCategorySchema, count: z.number() });

export const outcomeCoverageSchema = z.object({
  known: z.number(),
  unknown: z.number(),
  unknownReasons: z.array(z.string()),
});

export const auditedToolCallSchema = z.object({
  turnIndex: z.number(),
  call: toolCallRecordSchema,
});

export type AuditedToolCall = z.infer<typeof auditedToolCallSchema>;

export const retryGroupSchema = z.object({
  command: z.string(),
  attempts: z.number(),
  eventuallySucceeded: z.boolean(),
  turnIndexes: z.array(z.number()),
});

export type RetryGroup = z.infer<typeof retryGroupSchema>;

export const sessionAuditSchema = z.object({
  sessionId: z.string(),
  providerId: z.string().optional(),
  title: z.string().optional(),
  startedAt: z.string().optional(),
  totals: outcomeTotalsSchema,
  failureRate: failureRateSchema,
  byTool: z.array(toolBreakdownSchema),
  byShellProgram: z.array(programBreakdownSchema),
  byFailureCategory: z.array(categoryCountSchema),
  perTurn: z.array(outcomeTotalsSchema.omit({ toolCalls: true }).extend({ turnIndex: z.number() })),
  calls: z.array(auditedToolCallSchema),
  retries: z.array(retryGroupSchema),
  // Each LLM round that contained a failed call forces at least one
  // follow-up round spent reacting to it. Per-round tokens aren't part of
  // the normalized Session, so cost is reported exactly for the *affected
  // turns* rather than estimated per round (constraint 6).
  failureRecoveryCost: z.object({
    recoveryRounds: z.number(),
    affectedTurns: z.array(z.number()),
    affectedTurnsOutputTokens: tokenCountSchema,
    affectedTurnsInputTokens: tokenCountSchema, // uncached + cache write + cache read
  }),
  outcomeCoverage: outcomeCoverageSchema,
});

export type SessionAudit = z.infer<typeof sessionAuditSchema>;

export const auditRollupSchema = z.object({
  providerId: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  sessionCount: z.number(),
  totals: outcomeTotalsSchema,
  failureRate: failureRateSchema,
  byTool: z.array(toolBreakdownSchema),
  byShellProgram: z.array(programBreakdownSchema),
  byFailureCategory: z.array(categoryCountSchema),
  topFailingCommands: z.array(
    z.object({
      command: z.string(),
      program: z.string().optional(),
      failures: z.number(),
      sessions: z.number(),
      failureCategory: failureCategorySchema.optional(),
    }),
  ),
  daily: z.array(outcomeTotalsSchema.extend({ date: z.string() })),
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      title: z.string(),
      startedAt: z.string().optional(),
      toolCalls: z.number(),
      failed: z.number(), // error + interrupted + denied
      unknown: z.number(),
    }),
  ),
  outcomeCoverage: outcomeCoverageSchema,
});

export type AuditRollup = z.infer<typeof auditRollupSchema>;
