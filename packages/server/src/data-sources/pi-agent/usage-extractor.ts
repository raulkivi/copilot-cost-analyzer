import { sumTokenCounts, unavailableTokenCount, type TokenCount } from "@copilot-cost-analyzer/domain";
import type { ToolCallRecord, TurnUsage } from "@copilot-cost-analyzer/domain";
import { assistantMessageOf, findToolCallBlock, toolResultMessageOf, type PiAssistantMessage } from "./pi-message.js";
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
// Both fields exist somewhere in pi's data model (thinking content blocks,
// image content blocks, and a ToolResultMessage.usage field of unconfirmed
// shape) but no confirmed field separates their token cost from
// `output`/the rest of `input` in the documented `usage` shape — ship
// unavailable rather than guess, per constraint 6, until a real captured
// session confirms one way or the other (see the plan's "Open items").
const UNCONFIRMED_REASON =
  "Not yet confirmed whether pi's usage data separates this token category — verify against a real captured session.";

function assistantMessagesOf(group: PiTurnGroup): PiAssistantMessage[] {
  return group.entries
    .map((entry) => assistantMessageOf(entry))
    .filter((message): message is PiAssistantMessage => message !== null);
}

function numericField(value: unknown): TokenCount {
  return typeof value === "number" ? { known: true, value } : unavailableTokenCount(MISSING_FIELD_REASON);
}

function sumField(assistantMessages: PiAssistantMessage[], field: keyof NonNullable<PiAssistantMessage["usage"]>): TokenCount {
  return sumTokenCounts(
    assistantMessages.map((message) => numericField(message.usage?.[field])),
    MISSING_FIELD_REASON,
  );
}

// Per-turn usage from every AssistantMessage in the turn's span, mirroring
// the VS Code provider's "sum every llm_request span in the turn" pattern
// (session-usage-spans.ts's extractTurnUsages) — a turn can contain several
// round-trips when the agent loops through tool calls before answering.
export function extractTurnUsage(group: PiTurnGroup): TurnUsage {
  const assistantMessages = assistantMessagesOf(group);

  const model =
    assistantMessages.length > 0
      ? String(assistantMessages[assistantMessages.length - 1].model ?? "unknown")
      : "unknown";

  return {
    uncachedInput: sumField(assistantMessages, "input"),
    cacheWrite: sumField(assistantMessages, "cacheWrite"),
    cacheRead: sumField(assistantMessages, "cacheRead"),
    tool: unavailableTokenCount(UNCONFIRMED_REASON),
    vision: unavailableTokenCount(UNCONFIRMED_REASON),
    reasoning: unavailableTokenCount(UNCONFIRMED_REASON),
    output: sumField(assistantMessages, "output"),
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
// preceding AssistantMessage, when found. Outcome comes only from pi's own
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
    const command =
      kind === "shell" && typeof block?.args === "object" && block.args !== null
        ? (block.args as { command?: unknown }).command
        : undefined;
    const program = typeof command === "string" ? parseShellCommand(command).program : undefined;
    const isError = toolResult.isError;

    toolCalls.push({
      ...(toolCallId ? { id: toolCallId } : {}),
      name,
      kind,
      argsSummary: summarizeToolArgs(kind, block?.args),
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
