import type {
  Session,
  TokenCount,
  ToolCallRecord,
  Turn,
  TurnUsage,
} from "@copilot-cost-analyzer/domain";
import { sumTokenCounts, unavailableTokenCount } from "@copilot-cost-analyzer/domain";
import type {
  SessionFileRow,
  SessionRow,
  TurnRow,
} from "../../data-sources/sqlite/session-store.js";
import type { MainJsonlAvailability } from "../../data-sources/jsonl/main-jsonl-reader.js";
import type { AnalyzeModeExtras } from "./analyze-mode-extras.js";

// Two reasons, per architecture.md §6.2: one is actionable (constraint 8),
// the other isn't. Extraction of real numbers from "events-present" logs is
// still Phase 4 work in progress — no extractor registry exists yet, so
// that case degrades to the same generic reason as "missing"/older-shape.
export const LOGGING_NEVER_ENABLED_REASON =
  "GitHub Copilot Chat debug logging (github.copilot.chat.agentDebugLog.fileLogging.enabled) " +
  "was off while this session ran, so no usage data was recorded. Enable it in VS Code " +
  "settings and reload the window to capture usage data for future sessions.";
export const USAGE_UNAVAILABLE_REASON =
  "Usage data is unavailable for this session (main.jsonl is missing, uses an " +
  "older/unsupported log format, or its usage data could not be extracted).";
export const PARSE_FAILURES_REASON =
  "main.jsonl for this session has content, but none of its lines could be " +
  "parsed into a usable event — this looks like a parser regression or a " +
  "corrupted log file, not a settings problem.";
const UNKNOWN_MODEL = "unknown";
const STUB_EXPLANATION =
  "Token and AI Credits usage data is not available for this turn (main.jsonl parsing is not implemented yet).";
export const TOOL_CALL_TOKEN_COUNT_UNAVAILABLE_REASON =
  "GitHub Copilot Chat's local debug log does not record a token count for individual tool calls.";

function reasonForAvailability(availability: MainJsonlAvailability): string {
  if (availability === "logging-never-enabled") {
    return LOGGING_NEVER_ENABLED_REASON;
  }
  if (availability === "parse-failures") {
    return PARSE_FAILURES_REASON;
  }
  return USAGE_UNAVAILABLE_REASON;
}

// A session's total AI Credits, all-or-nothing across its turns (constraint
// 6: no silently-partial total). Used by the list endpoint, which only has
// turnUsages (extracted straight from main.jsonl) and no SQLite turnRows to
// build real Turn objects from — buildSession below aggregates from the
// built turns instead, since that's the authoritative per-turn source once
// they exist.
export function computeSessionCost(
  mainJsonlAvailability: MainJsonlAvailability,
  turnUsages: (TurnUsage | null)[],
): TokenCount {
  const fallback = unavailableTokenCount(reasonForAvailability(mainJsonlAvailability));
  if (mainJsonlAvailability !== "events-present" || turnUsages.length === 0) {
    return fallback;
  }
  return sumTokenCounts(
    turnUsages.map((usage) => usage?.costAiCredits ?? fallback),
    USAGE_UNAVAILABLE_REASON,
  );
}

function deriveTitle(row: SessionRow): string {
  return row.summary || row.repository || row.cwd || `Session ${row.id}`;
}

function unavailableToolCallTokenCount(): TokenCount {
  return unavailableTokenCount(TOOL_CALL_TOKEN_COUNT_UNAVAILABLE_REASON);
}

// SQLite's session_files rows only cover tools that touched a file — tools
// like manage_todo_list/run_in_terminal never appear there. invokedToolNames
// (from main.jsonl's tool_call events, jsonl/tool-inventory.ts) fills that
// gap; a name already covered by a file-based entry isn't duplicated. Every
// entry's tokenCount is explicit-unavailable (constraint 6): neither source
// records a per-tool-call token figure.
// fileRows is pre-grouped by turn_index once per buildSession call (rather
// than re-filtered per turn here) so this is O(turns + fileRows), not
// O(turns × fileRows).
function groupFileRowsByTurn(
  fileRows: SessionFileRow[],
): Map<number, SessionFileRow[]> {
  const byTurn = new Map<number, SessionFileRow[]>();
  for (const row of fileRows) {
    if (row.turn_index === null) {
      continue;
    }
    const rows = byTurn.get(row.turn_index) ?? [];
    rows.push(row);
    byTurn.set(row.turn_index, rows);
  }
  return byTurn;
}

function buildToolCalls(
  filesForTurn: SessionFileRow[],
  invokedToolNames: string[],
): ToolCallRecord[] {
  const filesByToolName = new Map<string, string[]>();
  for (const row of filesForTurn) {
    const name = row.tool_name ?? "unknown tool";
    const files = filesByToolName.get(name) ?? [];
    files.push(row.file_path);
    filesByToolName.set(name, files);
  }

  const fileBasedCalls: ToolCallRecord[] = Array.from(
    filesByToolName.entries(),
  ).map(([name, filesTouched]) => ({
    name,
    argsSummary: filesTouched.join(", "),
    filesTouched,
    tokenCount: unavailableToolCallTokenCount(),
  }));

  const invokedOnlyNames = Array.from(
    new Set(invokedToolNames.filter((name) => !filesByToolName.has(name))),
  );
  const invokedOnlyCalls: ToolCallRecord[] = invokedOnlyNames.map((name) => ({
    name,
    argsSummary: "",
    tokenCount: unavailableToolCallTokenCount(),
  }));

  return [...fileBasedCalls, ...invokedOnlyCalls];
}

// Total fallback for a turn with zero extracted llm_request spans — with no
// requests there's nothing to join against agent-traces.db either, so every
// field (including cacheWrite/reasoning, Phase 8.5) staying unavailable here
// is still correct; this is "no usage data of any kind for this turn," not
// specifically "cache-write/reasoning unavailable" (see session-usage-spans.ts
// for that more specific case).
function buildUnavailableUsage(fallbackTokenCount: TokenCount): TurnUsage {
  return {
    uncachedInput: fallbackTokenCount,
    cacheWrite: fallbackTokenCount,
    cacheRead: fallbackTokenCount,
    tool: fallbackTokenCount,
    vision: fallbackTokenCount,
    reasoning: fallbackTokenCount,
    output: fallbackTokenCount,
    costAiCredits: fallbackTokenCount,
    model: UNKNOWN_MODEL,
  };
}

function tokenCountValue(tokenCount: TokenCount): number {
  return tokenCount.known ? tokenCount.value : 0;
}

function buildAnalyzeExplanation(usage: TurnUsage): string {
  const uncachedInput = tokenCountValue(usage.uncachedInput).toLocaleString();
  const cacheRead = tokenCountValue(usage.cacheRead).toLocaleString();
  const output = tokenCountValue(usage.output).toLocaleString();
  return (
    `This turn sent ${uncachedInput} new input token(s) and reused ` +
    `${cacheRead} from cache, producing ${output} output token(s) using ${usage.model}.`
  );
}

function buildTurn(
  row: TurnRow,
  fileRowsByTurn: Map<number, SessionFileRow[]>,
  usage: TurnUsage | null | undefined,
  fallbackTokenCount: TokenCount,
  invokedToolNames: string[],
): Turn {
  return {
    index: row.turn_index,
    userMessage: row.user_message ?? "",
    assistantResponse: row.assistant_response ?? "",
    toolCalls: buildToolCalls(
      fileRowsByTurn.get(row.turn_index) ?? [],
      invokedToolNames,
    ),
    usage: usage ?? buildUnavailableUsage(fallbackTokenCount),
    explanation: usage ? buildAnalyzeExplanation(usage) : STUB_EXPLANATION,
  };
}

export function buildSessionSummary(
  row: SessionRow,
  costAiCredits: TokenCount = unavailableTokenCount(USAGE_UNAVAILABLE_REASON),
): Session {
  return {
    id: row.id,
    mode: "analyze",
    title: deriveTitle(row),
    model: UNKNOWN_MODEL,
    turns: [],
    turnCount: row.turn_count,
    costAiCredits,
    usageDataAvailable: false,
    ...(row.created_at ? { startedAt: row.created_at } : {}),
  };
}

export interface AnalyzeEnrichment extends Partial<AnalyzeModeExtras> {
  sessionRow: SessionRow;
  turnRows: TurnRow[];
  fileRows: SessionFileRow[];
  mainJsonlAvailability: MainJsonlAvailability;
  turnUsages?: (TurnUsage | null)[];
}

export function buildSession(enrichment: AnalyzeEnrichment): Session {
  const {
    sessionRow,
    turnRows,
    fileRows,
    mainJsonlAvailability,
    turnUsages = [],
    invokedToolNamesByTurn = [],
    systemPrompt = [],
    toolInventory = [],
  } = enrichment;

  const fallbackTokenCount = unavailableTokenCount(
    reasonForAvailability(mainJsonlAvailability),
  );

  const knownUsages = turnUsages.filter(
    (usage): usage is TurnUsage => usage !== null,
  );

  const fileRowsByTurn = groupFileRowsByTurn(fileRows);

  const turns = turnRows.map((turnRow) =>
    buildTurn(
      turnRow,
      fileRowsByTurn,
      turnUsages[turnRow.turn_index],
      fallbackTokenCount,
      invokedToolNamesByTurn[turnRow.turn_index] ?? [],
    ),
  );
  const costAiCredits = sumTokenCounts(
    turns.map((turn) => turn.usage.costAiCredits),
    USAGE_UNAVAILABLE_REASON,
  );

  return {
    ...buildSessionSummary(sessionRow, costAiCredits),
    model:
      knownUsages.length > 0
        ? knownUsages[knownUsages.length - 1].model
        : UNKNOWN_MODEL,
    usageDataAvailable: knownUsages.length > 0,
    systemPrompt,
    toolInventory,
    turnCount: turnRows.length,
    turns,
  };
}
