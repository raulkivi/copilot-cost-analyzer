import type { TurnUsage } from "@copilot-cost-analyzer/domain";
import { unavailableTokenCount } from "@copilot-cost-analyzer/domain";
import { isSseResponse, parseSseEvents } from "../sse.js";
import {
  AI_CREDITS_UNAVAILABLE_REASON,
  ANTHROPIC_REASONING_NOT_EXPOSED_REASON,
  TOOL_TOKEN_UNAVAILABLE_REASON,
  VISION_TOKEN_UNAVAILABLE_REASON,
  unavailableUsage,
} from "../normalized-usage.js";
import type { MitmExchangeDecoder, NormalizedExchange, RawMitmExchange } from "./decoder.js";

const MALFORMED_REASON =
  "The Anthropic response body could not be parsed (malformed or unrecognized payload).";

// The categories every successfully-decoded Anthropic exchange still can't
// populate, built once so both decode paths below construct the same shape.
function buildKnownUsage(params: {
  model: string;
  inputTokens: number;
  cacheWrite: number;
  cacheRead: number;
  outputTokens: number;
}): TurnUsage {
  return {
    uncachedInput: { known: true, value: params.inputTokens },
    cacheWrite: { known: true, value: params.cacheWrite },
    cacheRead: { known: true, value: params.cacheRead },
    tool: unavailableTokenCount(TOOL_TOKEN_UNAVAILABLE_REASON),
    vision: unavailableTokenCount(VISION_TOKEN_UNAVAILABLE_REASON),
    reasoning: unavailableTokenCount(ANTHROPIC_REASONING_NOT_EXPOSED_REASON),
    output: { known: true, value: params.outputTokens },
    costAiCredits: unavailableTokenCount(AI_CREDITS_UNAVAILABLE_REASON),
    model: params.model,
  };
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function looksLikeAnthropicRequest(exchange: RawMitmExchange): boolean {
  if (exchange.requestHeaders["anthropic-version"] !== undefined) {
    return true;
  }
  const body = tryParseJson(exchange.requestBody);
  const model = body?.model;
  return typeof model === "string" && /claude/i.test(model);
}

function looksLikeAnthropicResponse(exchange: RawMitmExchange): boolean {
  if (isSseResponse(exchange)) {
    return (
      exchange.responseBody.includes("event: message_start") ||
      /"type"\s*:\s*"message_start"/.test(exchange.responseBody)
    );
  }
  const body = tryParseJson(exchange.responseBody);
  return body?.type === "message";
}

function usageFromAnthropicUsageObject(rawUsage: unknown, model: string): NormalizedExchange {
  const u = rawUsage as Record<string, unknown> | null | undefined;
  if (!u || typeof u.input_tokens !== "number" || typeof u.output_tokens !== "number") {
    return { usage: unavailableUsage(MALFORMED_REASON, model), toolCalls: [] };
  }

  const usage = buildKnownUsage({
    model,
    inputTokens: u.input_tokens,
    cacheWrite: typeof u.cache_creation_input_tokens === "number" ? u.cache_creation_input_tokens : 0,
    cacheRead: typeof u.cache_read_input_tokens === "number" ? u.cache_read_input_tokens : 0,
    outputTokens: u.output_tokens,
  });
  return { usage, toolCalls: [] };
}

function decodeNonStreamed(exchange: RawMitmExchange, requestModel: string): NormalizedExchange {
  const body = tryParseJson(exchange.responseBody);
  if (!body) {
    return { usage: unavailableUsage(MALFORMED_REASON, requestModel), toolCalls: [] };
  }
  const model = typeof body.model === "string" ? body.model : requestModel;
  return usageFromAnthropicUsageObject(body.usage, model);
}

// Anthropic streams `message_start` (initial usage: input_tokens plus cache
// fields) then one or more `message_delta` events whose own `usage` carries
// the cumulative output_tokens — the last one seen is the final total. Any
// unparseable `data:` payload degrades the whole exchange to unavailable
// rather than silently
// using a partial total.
function decodeStreamed(exchange: RawMitmExchange, requestModel: string): NormalizedExchange {
  const events = parseSseEvents(exchange.responseBody);
  if (events.length === 0) {
    return { usage: unavailableUsage(MALFORMED_REASON, requestModel), toolCalls: [] };
  }

  let model = requestModel;
  let inputTokens: number | null = null;
  let cacheWrite = 0;
  let cacheRead = 0;
  let outputTokens: number | null = null;

  for (const event of events) {
    const payload = tryParseJson(event.data);
    if (!payload) {
      return { usage: unavailableUsage(MALFORMED_REASON, model), toolCalls: [] };
    }

    if (payload.type === "message_start" && typeof payload.message === "object" && payload.message) {
      const message = payload.message as Record<string, unknown>;
      if (typeof message.model === "string") {
        model = message.model;
      }
      const usage = message.usage as Record<string, unknown> | undefined;
      if (usage) {
        if (typeof usage.input_tokens === "number") inputTokens = usage.input_tokens;
        if (typeof usage.cache_creation_input_tokens === "number") cacheWrite = usage.cache_creation_input_tokens;
        if (typeof usage.cache_read_input_tokens === "number") cacheRead = usage.cache_read_input_tokens;
        if (typeof usage.output_tokens === "number") outputTokens = usage.output_tokens;
      }
    } else if (payload.type === "message_delta") {
      const usage = payload.usage as Record<string, unknown> | undefined;
      if (usage && typeof usage.output_tokens === "number") {
        outputTokens = usage.output_tokens;
      }
    }
  }

  if (inputTokens === null || outputTokens === null) {
    return { usage: unavailableUsage(MALFORMED_REASON, model), toolCalls: [] };
  }

  const usage = buildKnownUsage({ model, inputTokens, cacheWrite, cacheRead, outputTokens });
  return { usage, toolCalls: [] };
}

export const anthropicDecoder: MitmExchangeDecoder = {
  vendorId: "anthropic",
  recognizes(exchange) {
    return looksLikeAnthropicRequest(exchange) || looksLikeAnthropicResponse(exchange);
  },
  decode(exchange) {
    const requestBody = tryParseJson(exchange.requestBody);
    const requestBodyModel = requestBody?.model;
    const requestModel = typeof requestBodyModel === "string" ? requestBodyModel : "unknown";
    return isSseResponse(exchange)
      ? decodeStreamed(exchange, requestModel)
      : decodeNonStreamed(exchange, requestModel);
  },
};
