import { sumTokenCounts, unavailableTokenCount, type TokenCount } from "@copilot-cost-analyzer/domain";
import type { ToolCallRecord, TurnUsage } from "@copilot-cost-analyzer/domain";
import { assistantMessageOf, findToolCallBlock, toolResultMessageOf, type PiAssistantMessage } from "./pi-message.js";
import type { PiTurnGroup } from "./turn-grouper.js";

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

// One ToolCallRecord per ToolResultMessage in the turn — `name` comes
// straight from `toolName` (no need to correlate back to the assistant's
// content block for that), `argsSummary` from the matching toolCallId's
// arguments on the preceding AssistantMessage's content array, when found.
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

    toolCalls.push({
      name: typeof toolResult.toolName === "string" ? toolResult.toolName : "unknown",
      argsSummary: block?.args !== undefined ? JSON.stringify(block.args) : "",
    });
  }

  return toolCalls;
}
