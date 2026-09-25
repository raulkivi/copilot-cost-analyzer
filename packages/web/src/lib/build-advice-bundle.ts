import type { Session, TokenCount, TriggeredEvent, Turn } from "@copilot-cost-analyzer/domain";
import { sumTokenCounts } from "@copilot-cost-analyzer/domain";

export interface BuildAdviceBundleOptions {
  includeToolArgs?: boolean;
}

function tokenCountValue(tokenCount: TokenCount): number | "unknown" {
  return tokenCount.known ? tokenCount.value : "unknown";
}

function computeCacheHitRate(turns: Turn[]): number | "unknown" {
  let cacheRead = 0;
  let uncachedInput = 0;
  for (const turn of turns) {
    if (!turn.usage.cacheRead.known || !turn.usage.uncachedInput.known) return "unknown";
    cacheRead += turn.usage.cacheRead.value;
    uncachedInput += turn.usage.uncachedInput.value;
  }
  const total = cacheRead + uncachedInput;
  return total === 0 ? "unknown" : Math.round((cacheRead / total) * 1000) / 1000;
}

function computeEventCounts(turns: Turn[]): Partial<Record<TriggeredEvent, number>> {
  const counts: Partial<Record<TriggeredEvent, number>> = {};
  for (const turn of turns) {
    if (turn.triggeredEvent) {
      counts[turn.triggeredEvent] = (counts[turn.triggeredEvent] ?? 0) + 1;
    }
  }
  return counts;
}

function buildTurnMeta(turn: Turn, includeToolArgs: boolean) {
  return {
    index: turn.index,
    usage: {
      uncachedInput: tokenCountValue(turn.usage.uncachedInput),
      cacheWrite: tokenCountValue(turn.usage.cacheWrite),
      cacheRead: tokenCountValue(turn.usage.cacheRead),
      tool: tokenCountValue(turn.usage.tool),
      vision: tokenCountValue(turn.usage.vision),
      reasoning: tokenCountValue(turn.usage.reasoning),
      output: tokenCountValue(turn.usage.output),
      costAiCredits: tokenCountValue(turn.usage.costAiCredits),
      model: turn.usage.model,
    },
    triggeredEvent: turn.triggeredEvent,
    toolCalls: turn.toolCalls.map((call) => ({
      name: call.name,
      filesTouched: call.filesTouched,
      tokenCount: call.tokenCount ? tokenCountValue(call.tokenCount) : undefined,
      ...(includeToolArgs ? { argsSummary: call.argsSummary } : {}),
    })),
  };
}

function buildSessionMeta(session: Session, includeToolArgs: boolean) {
  const toolInventory = session.toolInventory ?? [];

  return {
    title: session.title,
    mode: session.mode,
    model: session.model,
    turnCount: session.turnCount,
    costAiCredits: tokenCountValue(session.costAiCredits),
    startedAt: session.startedAt,
    category: session.category,
    systemPrompt: (session.systemPrompt ?? []).map((component) => ({
      kind: component.kind,
      label: component.label,
      tokenCount: tokenCountValue(component.tokenCount),
    })),
    toolInventory: toolInventory.map((entry) => ({
      name: entry.name,
      loaded: entry.loaded,
      invokedTurnCount: entry.invokedInTurns.length,
    })),
    stats: {
      cacheHitRate: computeCacheHitRate(session.turns),
      totalReasoningTokens: tokenCountValue(
        sumTokenCounts(session.turns.map((turn) => turn.usage.reasoning), "unknown"),
      ),
      totalToolTokens: tokenCountValue(sumTokenCounts(session.turns.map((turn) => turn.usage.tool), "unknown")),
      unusedToolCount: toolInventory.filter((entry) => entry.loaded && entry.invokedInTurns.length === 0).length,
      eventCounts: computeEventCounts(session.turns),
    },
    turns: session.turns.map((turn) => buildTurnMeta(turn, includeToolArgs)),
  };
}

// Deliberately omits Turn.userMessage/assistantResponse and (by default)
// ToolCallRecord.argsSummary — the only fields that can carry raw chat
// content — so the bundle is safe to paste into a third-party LLM chat.
export function buildAdviceBundle(sessions: Session[], options: BuildAdviceBundleOptions = {}): string {
  const includeToolArgs = options.includeToolArgs ?? false;
  const count = sessions.length;
  const preamble =
    `I'm looking for advice on how to improve my AI coding-agent workflow (prompting, tool usage, ` +
    `caching, context management). Below is aggregated metadata from ${count} session${count === 1 ? "" : "s"} ` +
    `— no chat message content is included. Please identify inefficiencies (prompt bloat, poor cache reuse, ` +
    `unused tools, excessive compaction/rewinds, etc.) and suggest concrete changes.`;
  const payload = sessions.map((session) => buildSessionMeta(session, includeToolArgs));

  return `${preamble}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
}
