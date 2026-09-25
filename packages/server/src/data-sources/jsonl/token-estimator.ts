import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import type { TokenCount } from "@copilot-cost-analyzer/domain";
import { estimatedTokenCount } from "@copilot-cost-analyzer/domain";

// o200k_base is the encoding VS Code's own model catalog (models.json) names
// for Claude models — its client-side prompt-budget estimator, not the real
// Anthropic-side tokenizer that actually bills the request (architecture.md
// §6.2.2 Phase 6 note). Using the same encoding VS Code itself uses is the
// closest available proxy; the result is still explicitly flagged
// `estimated: true` rather than presented as a billed figure.
export function estimateTokenCount(text: string): TokenCount {
  return estimatedTokenCount(countTokens(text));
}
