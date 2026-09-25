import type { TurnUsage } from "@copilot-cost-analyzer/domain";
import { unavailableTokenCount } from "@copilot-cost-analyzer/domain";
import { isSseResponse, parseSseEvents } from "../sse.js";
import {
  AI_CREDITS_UNAVAILABLE_REASON,
  TOOL_TOKEN_UNAVAILABLE_REASON,
  VISION_TOKEN_UNAVAILABLE_REASON,
  unavailableUsage,
} from "../normalized-usage.js";
import type { MitmExchangeDecoder, NormalizedExchange, RawMitmExchange } from "./decoder.js";

const MALFORMED_REASON =
  "The OpenAI response body could not be parsed (malformed or unrecognized payload).";
const STREAM_NO_USAGE_REASON =
  "OpenAI stream did not request usage (stream_options.include_usage was not set).";
const NO_CACHE_WRITE_REASON =
  "The OpenAI API does not report a cache-write token figure.";
const NO_CACHE_DETAIL_REASON =
  "This OpenAI response's usage object did not include a prompt_tokens_details.cached_tokens field.";
const NO_REASONING_DETAIL_REASON =
  "This OpenAI response's usage object did not include a completion_tokens_details.reasoning_tokens field.";

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function looksLikeOpenAiRequest(exchange: RawMitmExchange): boolean {
  const body = tryParseJson(exchange.requestBody);
  const model = body?.model;
  if (typeof model === "string" && /^(gpt-|o[0-9]|text-|chatgpt)/i.test(model)) {
    return true;
  }
  return (
    exchange.requestHeaders["openai-organization"] !== undefined ||
    exchange.requestHeaders["openai-project"] !== undefined
  );
}

function looksLikeOpenAiResponse(exchange: RawMitmExchange): boolean {
  if (isSseResponse(exchange)) {
    return /"object"\s*:\s*"chat\.completion\.chunk"/.test(exchange.responseBody);
  }
  const body = tryParseJson(exchange.responseBody);
  const object = body?.object;
  return typeof object === "string" && object.startsWith("chat.completion");
}

function buildKnownUsage(params: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number | null;
  reasoningTokens: number | null;
}): TurnUsage {
  const cachedTokens = params.cachedTokens;
  const uncachedInput = params.promptTokens - (cachedTokens ?? 0);
  return {
    uncachedInput: { known: true, value: uncachedInput },
    cacheWrite: unavailableTokenCount(NO_CACHE_WRITE_REASON),
    cacheRead:
      cachedTokens === null
        ? unavailableTokenCount(NO_CACHE_DETAIL_REASON)
        : { known: true, value: cachedTokens },
    tool: unavailableTokenCount(TOOL_TOKEN_UNAVAILABLE_REASON),
    vision: unavailableTokenCount(VISION_TOKEN_UNAVAILABLE_REASON),
    reasoning:
      params.reasoningTokens === null
        ? unavailableTokenCount(NO_REASONING_DETAIL_REASON)
        : { known: true, value: params.reasoningTokens },
    output: { known: true, value: params.completionTokens },
    costAiCredits: unavailableTokenCount(AI_CREDITS_UNAVAILABLE_REASON),
    model: params.model,
  };
}

function usageFromOpenAiUsageObject(rawUsage: unknown, model: string): NormalizedExchange {
  const u = rawUsage as Record<string, unknown> | null | undefined;
  if (!u || typeof u.prompt_tokens !== "number" || typeof u.completion_tokens !== "number") {
    return { usage: unavailableUsage(MALFORMED_REASON, model), toolCalls: [] };
  }

  const promptDetails = u.prompt_tokens_details as Record<string, unknown> | undefined;
  const completionDetails = u.completion_tokens_details as Record<string, unknown> | undefined;
  const cachedTokensValue = promptDetails?.cached_tokens;
  const reasoningTokensValue = completionDetails?.reasoning_tokens;
  const usage = buildKnownUsage({
    model,
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    cachedTokens: typeof cachedTokensValue === "number" ? cachedTokensValue : null,
    reasoningTokens: typeof reasoningTokensValue === "number" ? reasoningTokensValue : null,
  });
  return { usage, toolCalls: [] };
}

function decodeNonStreamed(exchange: RawMitmExchange, requestModel: string): NormalizedExchange {
  const body = tryParseJson(exchange.responseBody);
  if (!body) {
    return { usage: unavailableUsage(MALFORMED_REASON, requestModel), toolCalls: [] };
  }
  const model = typeof body.model === "string" ? body.model : requestModel;
  return usageFromOpenAiUsageObject(body.usage, model);
}

// OpenAI only puts a `usage` field on the final streamed chunk, and only
// when the request set `stream_options.include_usage: true` — otherwise no
// chunk ever carries it. The literal `data: [DONE]` sentinel line is not
// JSON and is skipped rather
// than treated as malformed.
function decodeStreamed(
  exchange: RawMitmExchange,
  requestModel: string,
  requestedUsage: boolean,
): NormalizedExchange {
  const events = parseSseEvents(exchange.responseBody);
  if (events.length === 0) {
    return { usage: unavailableUsage(MALFORMED_REASON, requestModel), toolCalls: [] };
  }

  let model = requestModel;
  let usageChunk: unknown = null;

  for (const event of events) {
    if (event.data.trim() === "[DONE]") {
      continue;
    }
    const payload = tryParseJson(event.data);
    if (!payload) {
      return { usage: unavailableUsage(MALFORMED_REASON, model), toolCalls: [] };
    }
    if (typeof payload.model === "string") {
      model = payload.model;
    }
    if (payload.usage) {
      usageChunk = payload.usage;
    }
  }

  if (!requestedUsage) {
    return { usage: unavailableUsage(STREAM_NO_USAGE_REASON, model), toolCalls: [] };
  }
  if (!usageChunk) {
    return { usage: unavailableUsage(MALFORMED_REASON, model), toolCalls: [] };
  }
  return usageFromOpenAiUsageObject(usageChunk, model);
}

export const openAiDecoder: MitmExchangeDecoder = {
  vendorId: "openai",
  recognizes(exchange) {
    return looksLikeOpenAiRequest(exchange) || looksLikeOpenAiResponse(exchange);
  },
  decode(exchange) {
    const requestBody = tryParseJson(exchange.requestBody);
    const requestBodyModel = requestBody?.model;
    const requestModel = typeof requestBodyModel === "string" ? requestBodyModel : "unknown";
    const streamOptions = requestBody?.stream_options;
    const requestedUsage =
      typeof streamOptions === "object" && streamOptions !== null
        ? (streamOptions as Record<string, unknown>).include_usage === true
        : false;
    return isSseResponse(exchange)
      ? decodeStreamed(exchange, requestModel, requestedUsage)
      : decodeNonStreamed(exchange, requestModel);
  },
};
