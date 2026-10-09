import {
  unavailableTokenCount,
  type SystemPromptComponent,
} from "@copilot-cost-analyzer/domain";
import { estimateTokenCount } from "../jsonl/token-estimator.js";
import type { PiSystemPromptSidecarRecord } from "./system-prompt-sidecar-reader.js";
import type { PiSystemPromptState } from "./system-message-replay.js";

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

// Same component shape, built from the system prompt pi persists in the
// session file itself (system-message-replay.ts). Unlike the sidecar, every
// part's text is captured, so each gets a real estimateTokenCount: the base
// `content` and each named section as `built-in` components (section names
// are pi's own, free-form — not mapped onto repo-instructions/skill-manifest
// kinds, which would be a guess), and `tool-definitions` sized over the
// serialized declarations. Labels mirror the sidecar's.
export function buildPiSystemPromptComponentsFromState(state: PiSystemPromptState): SystemPromptComponent[] {
  const components: SystemPromptComponent[] = [];

  if (state.baseContent.length > 0) {
    components.push({
      kind: "built-in",
      label: `Base system prompt (${state.baseContent.length.toLocaleString()} characters)`,
      tokenCount: estimateTokenCount(state.baseContent),
    });
  }

  for (const section of state.sections) {
    components.push({
      kind: "built-in",
      label: `Prompt section "${section.name}" (${section.text.length.toLocaleString()} characters)`,
      tokenCount: estimateTokenCount(section.text),
    });
  }

  if (state.tools.length > 0) {
    components.push({
      kind: "tool-definitions",
      label: `Tool definitions (${state.tools.length} tools)`,
      tokenCount: estimateTokenCount(JSON.stringify(state.tools)),
    });
  }

  return components;
}
