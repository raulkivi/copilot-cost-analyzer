import { z } from "zod";
import { tokenCountSchema } from "./token-count.js";
import { toolCallOutcomeSchema } from "./tool-call-outcome.js";

export const toolKindSchema = z.enum([
  "shell",
  "file-read",
  "file-write",
  "search",
  "web",
  "mcp",
  "subagent",
  "other",
]);

export type ToolKind = z.infer<typeof toolKindSchema>;

export const shellInvocationSchema = z.object({
  command: z.string(), // truncated + redacted
  program: z.string().optional(), // first executable token, e.g. "npm"
  cwd: z.string().optional(), // only when the source records it
});

export type ShellInvocation = z.infer<typeof shellInvocationSchema>;

export const toolCallRecordSchema = z.object({
  id: z.string().optional(), // Analyze mode only — tool_use id / toolCallId / spanId
  name: z.string(),
  kind: toolKindSchema.optional(),
  argsSummary: z.string(),
  shell: shellInvocationSchema.optional(),
  outcome: toolCallOutcomeSchema.optional(),
  startedAt: z.string().optional(),
  durationMs: z.number().optional(),
  roundIndex: z.number().optional(), // which LLM round in the turn issued it
  filesTouched: z.array(z.string()).optional(), // Analyze mode only
  tokenCount: tokenCountSchema.optional(), // Analyze mode only
});

export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;
