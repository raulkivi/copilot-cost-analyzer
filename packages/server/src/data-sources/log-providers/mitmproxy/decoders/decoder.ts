import type { ToolCallRecord, TurnUsage } from "@copilot-cost-analyzer/domain";

// mitmproxy-only shapes — never imported outside data-sources/log-providers
// /mitmproxy. Header/body values are already redacted (redact-headers.ts) by
// the time a decoder sees them. responseMimeType is carried alongside the
// exchange's original fields specifically so SSE detection (sse.ts) doesn't
// have to re-derive it from response headers a second time.
export interface RawMitmExchange {
  requestHeaders: Record<string, string>;
  requestBody: string;
  responseHeaders: Record<string, string>;
  responseBody: string;
  responseMimeType: string;
  timestamp: string;
}

export interface NormalizedExchange {
  usage: TurnUsage;
  toolCalls: ToolCallRecord[];
}

export interface MitmExchangeDecoder {
  readonly vendorId: "anthropic" | "openai";
  recognizes(exchange: RawMitmExchange): boolean;
  decode(exchange: RawMitmExchange): NormalizedExchange;
}
