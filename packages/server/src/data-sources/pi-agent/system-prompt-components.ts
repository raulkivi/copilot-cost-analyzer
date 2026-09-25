import {
  unavailableTokenCount,
  type SystemPromptComponent,
} from "@copilot-cost-analyzer/domain";
import { estimateTokenCount } from "../jsonl/token-estimator.js";
import type { PiSystemPromptSidecarRecord } from "./system-prompt-sidecar-reader.js";

const NO_PER_ITEM_CONTENT_REASON =
  "pi-system-prompt-logger only records this item's name, not its content, so no per-item token count is available.";

// Mirrors buildSystemPromptBreakdown's shape/ordering (built-in, then
// repo-instructions, then skill-manifest, then tool-definitions), but the
// built-in component gets a real, known count here — the sidecar captured
// the full prompt text, unlike VS Code's per-component split where only
// this one component has real text to tokenize. Every other component
// stays name-only/unavailable, exactly like VS Code's, since the sidecar
// never captured per-item content for those.
export function buildPiSystemPromptComponents(
  record: PiSystemPromptSidecarRecord,
): SystemPromptComponent[] {
  const components: SystemPromptComponent[] = [
    {
      kind: "built-in",
      label: `Base system prompt (${record.systemPromptChars.toLocaleString()} characters)`,
      tokenCount: estimateTokenCount(record.systemPrompt),
    },
  ];

  for (const fileName of record.contextFilePaths ?? []) {
    components.push({
      kind: "repo-instructions",
      label: fileName,
      tokenCount: unavailableTokenCount(NO_PER_ITEM_CONTENT_REASON),
    });
  }

  for (const skillName of record.skillNames ?? []) {
    components.push({
      kind: "skill-manifest",
      label: skillName,
      tokenCount: unavailableTokenCount(NO_PER_ITEM_CONTENT_REASON),
    });
  }

  if (record.selectedTools !== undefined) {
    components.push({
      kind: "tool-definitions",
      label: `Tool definitions (${record.selectedTools.length} tools)`,
      tokenCount: unavailableTokenCount(NO_PER_ITEM_CONTENT_REASON),
    });
  }

  return components;
}
