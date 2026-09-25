import type { SystemPromptComponent, TokenCount } from "@copilot-cost-analyzer/domain";
import { unavailableTokenCount } from "@copilot-cost-analyzer/domain";
import type { JsonlEnvelope } from "./main-jsonl-reader.js";
import { estimateTokenCount } from "./token-estimator.js";

export const PROMPT_TOKEN_COUNT_UNAVAILABLE_REASON =
  "GitHub Copilot Chat's local debug log does not break down input tokens " +
  "per system-prompt component — only the aggregate inputTokens figure for " +
  "the whole request is available (see the turns table).";

function unavailable(): TokenCount {
  return unavailableTokenCount(PROMPT_TOKEN_COUNT_UNAVAILABLE_REASON);
}

function dedupe(names: string[]): string[] {
  return Array.from(new Set(names));
}

function findEventDetails(
  envelopes: JsonlEnvelope[],
  type: string,
  name: string,
): string | null {
  const event = envelopes.find((e) => e.type === type && e.name === name);
  const details = event?.attrs?.details;
  return typeof details === "string" ? details : null;
}

// Defensive, version-tolerant parse of the "Custom Instructions" generic
// event's human-readable details string (architecture.md §7: a fixed
// template Copilot Chat itself generates, not model/user content) — e.g.
// "context included: [3] CLAUDE.md, copilot-instructions.md, CLAUDE.md\n...".
// A future log format that no longer matches the template yields [], never
// a throw or a guessed name.
export function extractCustomInstructionFileNames(
  envelopes: JsonlEnvelope[],
): string[] {
  const details = findEventDetails(envelopes, "generic", "Custom Instructions");
  if (!details) {
    return [];
  }

  const match = /context included:\s*\[\d+\]\s*(.+)/.exec(details);
  if (!match) {
    return [];
  }

  return dedupe(
    match[1]
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
}

// Same defensive-template approach for the "Skill Discovery" event, e.g.
// "Resolved 3 skills in 12.3ms | loaded: [graphify, troubleshoot] | folders: [...]".
export function extractLoadedSkillNames(envelopes: JsonlEnvelope[]): string[] {
  const details = findEventDetails(envelopes, "discovery", "Skill Discovery");
  if (!details) {
    return [];
  }

  const match = /loaded:\s*\[(.*?)\]/.exec(details);
  if (!match) {
    return [];
  }

  return dedupe(
    match[1]
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
}

// Builds the Analyze-mode-only SystemPromptComponent[] (architecture.md §5)
// from every real, structurally-known source this phase's research spike
// confirmed exists: the system-prompt/tools artifacts (prompt-artifact-
// reader.ts) and the discovery/generic log templates above. main.jsonl
// itself never exposes a per-component breakdown of the request's
// inputTokens (constraint 6), so a component's tokenCount is only ever
// `known: true` when the component's *own real captured text* is available
// to run through a local tokenizer (token-estimator.ts) — always flagged
// `estimated: true` since it's a different tokenizer than the one that
// actually billed the request. repo-instructions/skill-manifest names are
// parsed out of a fixed-template log line, never the file/manifest content
// itself, so there's nothing to tokenize for those — they stay unavailable.
// No "path-scoped-instructions" component is ever produced yet (§13 open
// question): no real captured log has shown an applyTo-scoped instruction
// actually applying, so there's no confirmed template to parse defensively.
export function buildSystemPromptBreakdown(
  envelopes: JsonlEnvelope[],
  systemPromptText: string | null,
  toolCount: number | null,
  toolDefinitionsText: string | null,
): SystemPromptComponent[] {
  const components: SystemPromptComponent[] = [];

  if (systemPromptText !== null) {
    components.push({
      kind: "built-in",
      label: `Base system prompt (${systemPromptText.length.toLocaleString()} characters)`,
      tokenCount: estimateTokenCount(systemPromptText),
    });
  }

  for (const fileName of extractCustomInstructionFileNames(envelopes)) {
    components.push({
      kind: "repo-instructions",
      label: fileName,
      tokenCount: unavailable(),
    });
  }

  for (const skillName of extractLoadedSkillNames(envelopes)) {
    components.push({
      kind: "skill-manifest",
      label: skillName,
      tokenCount: unavailable(),
    });
  }

  if (toolCount !== null) {
    components.push({
      kind: "tool-definitions",
      label: `Tool definitions (${toolCount} tools)`,
      tokenCount: toolDefinitionsText !== null ? estimateTokenCount(toolDefinitionsText) : unavailable(),
    });
  }

  return components;
}
