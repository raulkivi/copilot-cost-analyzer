import type { TokenCount, TurnUsage } from "@copilot-cost-analyzer/domain";
import { unavailableTokenCount as unavailable } from "@copilot-cost-analyzer/domain";
import type { JsonlEnvelope } from "./main-jsonl-reader.js";
import {
  extractLlmRequestUsage,
  type LlmRequestUsage,
} from "./llm-request-extractor.js";
import type { AgentTraceUsage } from "../agent-traces/agent-traces-reader.js";

const UNKNOWN_MODEL = "unknown";

export const USAGE_CATEGORY_NOT_EXPOSED_REASON =
  "GitHub Copilot Chat's local debug log (main.jsonl) does not expose this token " +
  "category for llm_request spans — only uncached input, cache-read, and output " +
  "tokens are recorded per request.";
export const AI_CREDITS_NOT_AVAILABLE_REASON =
  "AI Credits are unavailable because at least one llm_request span does not " +
  "record a numeric copilotUsageNanoAiu value.";
// Phase 8.5: unlike tool/vision (genuinely unexposed by anything), cache-write
// and reasoning tokens ARE obtainable — from agent-traces.db, an optional
// local source — so this reason is actionable rather than a dead end.
export const AGENT_TRACES_UNAVAILABLE_REASON =
  "Cache-write and reasoning-token counts require GitHub Copilot Chat's " +
  "optional local trace database (github.copilot.chat.otel.dbSpanExporter.enabled), " +
  "which was off (or not yet capturing) when this turn ran. Enable it in VS Code " +
  "settings and reload the window to capture this data for future turns.";

function aggregateAiCredits(requests: LlmRequestUsage[]): TokenCount {
  let total = 0;
  for (const request of requests) {
    if (request.aiCredits === null) {
      return unavailable(AI_CREDITS_NOT_AVAILABLE_REASON);
    }
    total += request.aiCredits;
  }
  return { known: true, value: total };
}

// The last request's model may be "unknown" (older/unrecognized attrs
// shape) even when an earlier request in the same turn carried a real
// model — prefer the latest *known* model, falling back to "unknown" only
// if none of the turn's requests have one.
function latestKnownModel(requests: LlmRequestUsage[]): string {
  for (let i = requests.length - 1; i >= 0; i--) {
    if (requests[i].model !== UNKNOWN_MODEL) {
      return requests[i].model;
    }
  }
  return UNKNOWN_MODEL;
}

// A SQLite `turns` row (one user message -> tool calls -> final assistant
// response) can correspond to several internal `llm_request` spans when the
// agent loops through multiple tool-call round-trips before answering — the
// per-request `turnId` in main.jsonl resets to 0 at every `user_message`
// rather than tracking the SQLite turn index. So the join key (architecture
// §6.2) is positional: the Nth user_message event in the log corresponds to
// SQLite turn_index N, and everything up to (not including) the next
// user_message belongs to that same turn.
export function groupEnvelopesByUserMessage(
  envelopes: JsonlEnvelope[],
): JsonlEnvelope[][] {
  const groups: JsonlEnvelope[][] = [];
  let current: JsonlEnvelope[] | null = null;

  for (const envelope of envelopes) {
    if (envelope.type === "user_message") {
      current = [];
      groups.push(current);
    }
    current?.push(envelope);
  }

  return groups;
}

// Every distinct responseId across a session's llm_request envelopes, for
// app.ts to pass into agent-traces-reader.ts's loadAgentTraceUsageForResponseIds
// before extractTurnUsages needs to group anything by turn.
export function collectResponseIds(envelopes: JsonlEnvelope[]): string[] {
  const ids = new Set<string>();
  for (const envelope of envelopes) {
    const usage = extractLlmRequestUsage(envelope);
    if (usage?.responseId) {
      ids.add(usage.responseId);
    }
  }
  return [...ids];
}

// cacheWrite/reasoning for one turn: known only if every request in the turn
// has a responseId that resolves in the map — same all-or-nothing shape as
// aggregateAiCredits, so a partially-enriched turn doesn't silently show a
// number that's missing some of its requests' contributions.
function aggregateAgentTraceUsage(
  requests: LlmRequestUsage[],
  agentTraceUsageByResponseId: Map<string, AgentTraceUsage>,
): { cacheWrite: TokenCount; reasoning: TokenCount } {
  let cacheWrite = 0;
  let reasoning = 0;
  for (const request of requests) {
    const usage = request.responseId
      ? agentTraceUsageByResponseId.get(request.responseId)
      : undefined;
    if (!usage) {
      return {
        cacheWrite: unavailable(AGENT_TRACES_UNAVAILABLE_REASON),
        reasoning: unavailable(AGENT_TRACES_UNAVAILABLE_REASON),
      };
    }
    cacheWrite += usage.cacheWrite;
    reasoning += usage.reasoning;
  }
  return {
    cacheWrite: { known: true, value: cacheWrite },
    reasoning: { known: true, value: reasoning },
  };
}

// Produces one TurnUsage per SQLite turn_index (array position = turn_index),
// or null where the group's llm_request span(s) didn't yield usable numbers
// (constraint 6: the caller falls back to an explicit "unavailable" reason
// rather than this module fabricating one). agentTraceUsageByResponseId is
// optional/defaulted — Phase 8.5's agent-traces.db enrichment, empty when
// that optional local source isn't available.
export function extractTurnUsages(
  envelopes: JsonlEnvelope[],
  agentTraceUsageByResponseId: Map<string, AgentTraceUsage> = new Map(),
): (TurnUsage | null)[] {
  const groups = groupEnvelopesByUserMessage(envelopes);

  return groups.map((group) => {
    const requests = group
      .map(extractLlmRequestUsage)
      .filter((usage) => usage !== null);

    if (requests.length === 0) {
      return null;
    }

    const uncachedInput = requests.reduce((sum, r) => sum + r.uncachedInput, 0);
    const cacheRead = requests.reduce((sum, r) => sum + r.cacheRead, 0);
    const output = requests.reduce((sum, r) => sum + r.output, 0);
    const model = latestKnownModel(requests);
    const { cacheWrite, reasoning } = aggregateAgentTraceUsage(
      requests,
      agentTraceUsageByResponseId,
    );

    return {
      uncachedInput: { known: true, value: uncachedInput },
      cacheWrite,
      cacheRead: { known: true, value: cacheRead },
      tool: unavailable(USAGE_CATEGORY_NOT_EXPOSED_REASON),
      vision: unavailable(USAGE_CATEGORY_NOT_EXPOSED_REASON),
      reasoning,
      output: { known: true, value: output },
      costAiCredits: aggregateAiCredits(requests),
      model,
      roundsCount: requests.length,
    };
  });
}
