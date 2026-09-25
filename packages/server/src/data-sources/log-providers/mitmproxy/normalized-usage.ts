import type { TurnUsage } from "@copilot-cost-analyzer/domain";
import { unavailableTokenCount } from "@copilot-cost-analyzer/domain";

// Shared reasons every mitmproxy decoder falls back to when a category is
// genuinely not observable from vendor API traffic, so the same gap always
// reads with the same explanation regardless of which decoder hit it.
export const TOOL_TOKEN_UNAVAILABLE_REASON =
  "Neither the Anthropic nor OpenAI API reports a per-tool-call token count on a request/response exchange.";
export const VISION_TOKEN_UNAVAILABLE_REASON =
  "This vendor API does not break out a separate vision/image token count on a request/response exchange.";
export const AI_CREDITS_UNAVAILABLE_REASON =
  "AI Credits are GitHub Copilot's own billing unit — a mitmproxy-captured direct vendor API exchange has no AI Credits conversion.";
export const ANTHROPIC_REASONING_NOT_EXPOSED_REASON =
  "The Anthropic API's usage object does not report a separate reasoning-token count.";

export function unavailableUsage(reason: string, model = "unknown"): TurnUsage {
  const unavailable = unavailableTokenCount(reason);
  return {
    uncachedInput: unavailable,
    cacheWrite: unavailable,
    cacheRead: unavailable,
    tool: unavailableTokenCount(TOOL_TOKEN_UNAVAILABLE_REASON),
    vision: unavailableTokenCount(VISION_TOKEN_UNAVAILABLE_REASON),
    reasoning: unavailable,
    output: unavailable,
    costAiCredits: unavailableTokenCount(AI_CREDITS_UNAVAILABLE_REASON),
    model,
  };
}
