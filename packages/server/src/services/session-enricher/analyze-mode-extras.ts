import path from "node:path";
import type {
  SystemPromptComponent,
  ToolInventoryEntry,
} from "@copilot-cost-analyzer/domain";
import {
  readSystemPromptText,
  readToolDefinitionNames,
  readToolDefinitionsRaw,
} from "../../data-sources/jsonl/prompt-artifact-reader.js";
import { buildSystemPromptBreakdown } from "../../data-sources/jsonl/system-prompt-breakdown.js";
import {
  buildToolInventory,
  extractInvokedToolNamesByTurn,
} from "../../data-sources/jsonl/tool-inventory.js";
import type { JsonlEnvelope } from "../../data-sources/jsonl/main-jsonl-reader.js";

export interface AnalyzeModeExtras {
  invokedToolNamesByTurn: string[][];
  systemPrompt: SystemPromptComponent[];
  toolInventory: ToolInventoryEntry[];
}

type ArtifactSource = JsonlEnvelope & {
  attrs: { systemPromptFile: string; toolsFile: string };
};

// The last llm_request span carrying both artifact file names, mirroring the
// existing "last known turn's model" precedent in session-enricher.ts.
function findArtifactSource(envelopes: JsonlEnvelope[]): ArtifactSource | undefined {
  return envelopes.findLast(
    (envelope): envelope is ArtifactSource =>
      envelope.type === "llm_request" &&
      typeof envelope.attrs?.systemPromptFile === "string" &&
      typeof envelope.attrs?.toolsFile === "string",
  );
}

// Shared by buildAnalyzeModeExtras below and the GET /api/sessions/:id/
// system-prompt route, which needs the raw text on its own without the rest
// of the extras.
export async function resolveSystemPromptText(
  envelopes: JsonlEnvelope[],
  mainJsonlPath: string,
): Promise<string | null> {
  const artifactSource = findArtifactSource(envelopes);
  if (!artifactSource) {
    return null;
  }

  return readSystemPromptText(
    path.dirname(mainJsonlPath),
    artifactSource.attrs.systemPromptFile,
  );
}

// Phase 6: system-prompt/tool-inventory detail is only derivable from the
// systemPromptFile/toolsFile named on an llm_request span (architecture.md
// §6.2 Phase 6 note) — the last such span is used, mirroring the existing
// "last known turn's model" precedent in session-enricher.ts. When no
// llm_request span carries those fields (older/unknown shape), the
// tool-inventory still degrades to invoked-only entries rather than being
// dropped entirely.
export async function buildAnalyzeModeExtras(
  envelopes: JsonlEnvelope[],
  mainJsonlPath: string,
): Promise<AnalyzeModeExtras> {
  const invokedToolNamesByTurn = extractInvokedToolNamesByTurn(envelopes);

  const artifactSource = findArtifactSource(envelopes);

  if (!artifactSource) {
    return {
      invokedToolNamesByTurn,
      systemPrompt: buildSystemPromptBreakdown(envelopes, null, null, null),
      toolInventory: buildToolInventory(null, invokedToolNamesByTurn),
    };
  }

  const sessionLogDir = path.dirname(mainJsonlPath);
  const [systemPromptText, loadedToolNames, toolDefinitions] = await Promise.all([
    readSystemPromptText(sessionLogDir, artifactSource.attrs.systemPromptFile),
    readToolDefinitionNames(sessionLogDir, artifactSource.attrs.toolsFile),
    readToolDefinitionsRaw(sessionLogDir, artifactSource.attrs.toolsFile),
  ]);

  return {
    invokedToolNamesByTurn,
    systemPrompt: buildSystemPromptBreakdown(
      envelopes,
      systemPromptText,
      loadedToolNames?.length ?? null,
      toolDefinitions !== null ? JSON.stringify(toolDefinitions) : null,
    ),
    toolInventory: buildToolInventory(loadedToolNames, invokedToolNamesByTurn),
  };
}
