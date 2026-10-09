import { sumTokenCounts, unavailableTokenCount, type TokenCount } from "@copilot-cost-analyzer/domain";
import type { ToolCallRecord, TurnUsage } from "@copilot-cost-analyzer/domain";
import {
  assistantMessageOf,
  findToolCallBlock,
  toolCallArgumentsOf,
  toolResultMessageOf,
  type PiAssistantMessage,
  type PiUsage,
} from "./pi-message.js";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import type { PiTurnGroup } from "./turn-grouper.js";
import { MAX_ARGS_SUMMARY_LENGTH, summarizeToolArgs } from "../../services/tool-audit/args-summary.js";
import { buildToolCallOutcome } from "../../services/tool-audit/outcome-builder.js";
import { excerptOf } from "../../services/tool-audit/output-redactor.js";
import { parseShellCommand } from "../../services/tool-audit/shell-command-parser.js";
import { resolveToolKind } from "../../services/tool-audit/tool-kind-resolver.js";

const MISSING_FIELD_REASON =
  "pi's AssistantMessage did not include a numeric usage figure for this round.";
const NO_AI_CREDITS_REASON =
  "AI Credits are GitHub Copilot's own billing unit — a pi coding-agent session has no AI Credits conversion.";
// pi-ai's Usage (input/output/cacheRead/cacheWrite/cacheWrite1h/reasoning/
// totalTokens/cost) has no field separating a tool-call's or an image's
// token cost from the rest of input/output — ship unavailable rather than
// guess, per constraint 6.
const NO_TOOL_VISION_SEPARATION_REASON =
  "pi's Usage has no field that separates tool-call or vision token cost from input/output.";
const NO_REASONING_BREAKDOWN_REASON =
  "pi's Usage omitted `reasoning` for a round with output tokens — that provider doesn't report a reasoning breakdown.";

function assistantMessagesOf(group: PiTurnGroup): PiAssistantMessage[] {
  return group.entries
    .map((entry) => assistantMessageOf(entry))
    .filter((message): message is PiAssistantMessage => message !== null);
}

function isUsageObject(value: unknown): value is PiUsage {
  return typeof value === "object" && value !== null;
}

// Every model-attributed usage figure an entry carries, per pi's published
// schema (vendored @earendil-works/pi-coding-agent docs/session-format.md,
// docs/message-types.md):
// - AssistantMessage.usage — always present; a missing one still counts (it
//   makes the turn's figure unknown rather than silently smaller).
// - ToolResultMessage.usage — optional, nested model work by the tool.
// - `usage` entries (any `kind`, e.g. "cache_warm") — usage outside any
//   assistant message.
// - `compaction` / `branch_summary` entries' optional `usage` — the LLM call
//   that generated the summary.
// All of these count toward pi's own session totals, so they count toward
// the turn whose span they fall in here.
function usageOfEntry(entry: PiRawEntry): { usage: PiUsage | undefined } | null {
  const assistant = assistantMessageOf(entry);
  if (assistant) {
    return { usage: assistant.usage };
  }
  const toolResult = toolResultMessageOf(entry);
  if (toolResult) {
    return isUsageObject(toolResult.usage) ? { usage: toolResult.usage } : null;
  }
  if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") {
    return isUsageObject(entry.usage) ? { usage: entry.usage } : null;
  }
  return null;
}

function usagesOf(group: PiTurnGroup): Array<PiUsage | undefined> {
  return [...group.precedingEntries, ...group.entries]
    .map(usageOfEntry)
    .filter((source): source is { usage: PiUsage | undefined } => source !== null)
    .map((source) => source.usage);
}

function numericField(value: unknown): TokenCount {
  return typeof value === "number" ? { known: true, value } : unavailableTokenCount(MISSING_FIELD_REASON);
}

function sumField(usages: Array<PiUsage | undefined>, field: "input" | "output" | "cacheRead" | "cacheWrite"): TokenCount {
  return sumTokenCounts(
    usages.map((usage) => numericField(usage?.[field])),
    MISSING_FIELD_REASON,
  );
}

// `reasoning` is a subset of `output`, set only by providers that expose the
// breakdown. A usage with no output tokens therefore has no reasoning tokens
// either (e.g. a cache_warm); any other usage without the field makes the
// turn's reasoning unknown.
function reasoningOf(usage: PiUsage | undefined): TokenCount {
  if (typeof usage?.reasoning === "number") {
    return { known: true, value: usage.reasoning };
  }
  return usage?.output === 0 ? { known: true, value: 0 } : unavailableTokenCount(NO_REASONING_BREAKDOWN_REASON);
}

// Per-turn usage summed over every usage-bearing entry in the turn's span
// (see usageOfEntry), mirroring the VS Code provider's "sum every
// llm_request span in the turn" pattern (session-usage-spans.ts's
// extractTurnUsages) — a turn can contain several round-trips when the
// agent loops through tool calls before answering. `roundsCount` counts
// only AssistantMessages: the main-model round-trips the inspector pairs.
export function extractTurnUsage(group: PiTurnGroup): TurnUsage {
  const assistantMessages = assistantMessagesOf(group);
  const usages = usagesOf(group);

  const model =
    assistantMessages.length > 0
      ? String(assistantMessages[assistantMessages.length - 1].model ?? "unknown")
      : "unknown";

  return {
    uncachedInput: sumField(usages, "input"),
    cacheWrite: sumField(usages, "cacheWrite"),
    cacheRead: sumField(usages, "cacheRead"),
    tool: unavailableTokenCount(NO_TOOL_VISION_SEPARATION_REASON),
    vision: unavailableTokenCount(NO_TOOL_VISION_SEPARATION_REASON),
    reasoning: sumTokenCounts(usages.map(reasoningOf), NO_REASONING_BREAKDOWN_REASON),
    output: sumField(usages, "output"),
    costAiCredits: unavailableTokenCount(NO_AI_CREDITS_REASON),
    model,
    roundsCount: assistantMessages.length,
  };
}

const NO_IS_ERROR_REASON =
  "pi's ToolResultMessage carried no isError flag for this call, so its outcome is not inferred.";

function resultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return Array.isArray(content)
    ? content
        .map((part) => (typeof part === "object" && part !== null ? (part as { text?: unknown }).text : undefined))
        .filter((text): text is string => typeof text === "string")
        .join("\n")
    : "";
}

// One ToolCallRecord per ToolResultMessage in the turn — `name` comes
// straight from `toolName` (no need to correlate back to the assistant's
// content block for that), args from the matching toolCallId's block on the
// preceding AssistantMessage, when found (`arguments`, per pi's schema). Outcome comes only from pi's own
// `isError` flag (Phase 9.10); no exit code is parsed from pi's text since
// its bash output format isn't confirmed.
export function extractToolCalls(group: PiTurnGroup): ToolCallRecord[] {
  const assistantMessages = assistantMessagesOf(group);
  const toolCalls: ToolCallRecord[] = [];

  for (const entry of group.entries) {
    const toolResult = toolResultMessageOf(entry);
    if (!toolResult) {
      continue;
    }
    const toolCallId = typeof toolResult.toolCallId === "string" ? toolResult.toolCallId : undefined;
    const block = toolCallId ? findToolCallBlock(assistantMessages, toolCallId) : null;
    const name = typeof toolResult.toolName === "string" ? toolResult.toolName : "unknown";
    const kind = resolveToolKind(name);
    const args = toolCallArgumentsOf(block);
    const command =
      kind === "shell" && typeof args === "object" && args !== null
        ? (args as { command?: unknown }).command
        : undefined;
    const program = typeof command === "string" ? parseShellCommand(command).program : undefined;
    const isError = toolResult.isError;

    toolCalls.push({
      ...(toolCallId ? { id: toolCallId } : {}),
      name,
      kind,
      argsSummary: summarizeToolArgs(kind, args),
      ...(typeof command === "string"
        ? { shell: { command: excerptOf(command, MAX_ARGS_SUMMARY_LENGTH), ...(program ? { program } : {}) } }
        : {}),
      outcome:
        typeof isError === "boolean"
          ? buildToolCallOutcome({ kind, status: isError ? "error" : "success", text: resultText(toolResult.content) })
          : buildToolCallOutcome({ kind, status: "unknown", text: "", reason: NO_IS_ERROR_REASON }),
    });
  }

  return toolCalls;
}
