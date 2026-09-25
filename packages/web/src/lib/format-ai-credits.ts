import type { TokenCount } from "@copilot-cost-analyzer/domain";

export function formatAiCredits(tokenCount: TokenCount): string {
  return tokenCount.known ? tokenCount.value.toFixed(2) : "—";
}
