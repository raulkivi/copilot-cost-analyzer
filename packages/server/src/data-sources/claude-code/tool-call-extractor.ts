import type { ToolCallRecord } from "@copilot-cost-analyzer/domain";
import { summarizeToolArgs } from "../../services/tool-audit/args-summary.js";
import { buildToolCallOutcome } from "../../services/tool-audit/outcome-builder.js";
import { excerptOf } from "../../services/tool-audit/output-redactor.js";
import { parseShellCommand } from "../../services/tool-audit/shell-command-parser.js";
import { resolveToolKind } from "../../services/tool-audit/tool-kind-resolver.js";
import { MAX_ARGS_SUMMARY_LENGTH } from "../../services/tool-audit/args-summary.js";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { groupTurnEntriesByRound } from "./round-grouper.js";
import { indexToolResults, interpretToolResult, type ClaudeCodeToolResultRef } from "./tool-result-index.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";

const NO_RESULT_REASON =
  "No tool_result for this call was found anywhere in the session file (the turn may have been interrupted before the tool completed).";

interface ToolUseBlock {
  id?: unknown;
  name?: unknown;
  input?: unknown;
}

function toolUseBlocksOf(entry: ClaudeCodeRawEntry): ToolUseBlock[] {
  const message = entry.message;
  const content = typeof message === "object" && message !== null ? (message as { content?: unknown }).content : undefined;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(
    (block): block is ToolUseBlock =>
      typeof block === "object" && block !== null && (block as { type?: unknown }).type === "tool_use",
  );
}

function durationBetween(start: unknown, end: unknown): number | undefined {
  if (typeof start !== "string" || typeof end !== "string") {
    return undefined;
  }
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

function shellCommandOf(input: unknown): string | undefined {
  const command = typeof input === "object" && input !== null ? (input as { command?: unknown }).command : undefined;
  return typeof command === "string" ? command : undefined;
}

function buildRecord(
  entry: ClaudeCodeRawEntry,
  block: ToolUseBlock,
  roundIndex: number,
  resultRef: ClaudeCodeToolResultRef | undefined,
): ToolCallRecord {
  const name = typeof block.name === "string" ? block.name : "unknown";
  const kind = resolveToolKind(name);
  const command = kind === "shell" ? shellCommandOf(block.input) : undefined;
  const parsed = command !== undefined ? parseShellCommand(command) : undefined;
  const interpreted = resultRef ? interpretToolResult(resultRef) : undefined;
  const outcome = interpreted
    ? buildToolCallOutcome({ kind, ...interpreted })
    : buildToolCallOutcome({ kind, status: "unknown", text: "", reason: NO_RESULT_REASON });
  const durationMs = resultRef ? durationBetween(entry.timestamp, resultRef.entry.timestamp) : undefined;

  return {
    ...(typeof block.id === "string" ? { id: block.id } : {}),
    name,
    kind,
    argsSummary: summarizeToolArgs(kind, block.input),
    ...(command !== undefined
      ? {
          shell: {
            command: excerptOf(command, MAX_ARGS_SUMMARY_LENGTH),
            ...(parsed?.program ? { program: parsed.program } : {}),
            ...(typeof entry.cwd === "string" ? { cwd: entry.cwd } : {}),
          },
        }
      : {}),
    outcome,
    ...(typeof entry.timestamp === "string" ? { startedAt: entry.timestamp } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    roundIndex,
  };
}

// One ToolCallRecord per `tool_use` content block in the turn, each paired
// with its tool_result by id. `resultIndex` should be built over the whole
// session file (tool-result-index.ts explains why the active branch alone
// misses parallel-call results); it defaults to the turn's own entries for
// callers that only have the group.
export function extractToolCalls(
  group: ClaudeCodeTurnGroup,
  resultIndex: Map<string, ClaudeCodeToolResultRef> = indexToolResults(group.entries),
): ToolCallRecord[] {
  const rounds = groupTurnEntriesByRound(group.entries);
  const toolCalls: ToolCallRecord[] = [];

  rounds.forEach((round, roundIndex) => {
    for (const entry of round.entries) {
      for (const block of toolUseBlocksOf(entry)) {
        const resultRef = typeof block.id === "string" ? resultIndex.get(block.id) : undefined;
        toolCalls.push(buildRecord(entry, block, roundIndex, resultRef));
      }
    }
  });

  return toolCalls;
}
