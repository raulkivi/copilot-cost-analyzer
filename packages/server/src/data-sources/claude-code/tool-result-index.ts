import type { ToolCallStatus } from "@copilot-cost-analyzer/domain";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";

export interface ClaudeCodeToolResultRef {
  entry: ClaudeCodeRawEntry;
  block: Record<string, unknown>;
}

export interface InterpretedToolResult {
  status: Exclude<ToolCallStatus, "unknown">;
  exitCode?: number;
  text: string;
}

function contentBlocksOf(entry: ClaudeCodeRawEntry): unknown[] {
  const message = entry.message;
  const content = typeof message === "object" && message !== null ? (message as { content?: unknown }).content : undefined;
  return Array.isArray(content) ? content : [];
}

// Indexed over the *whole file*, not just the active branch: in a real
// capture, an assistant message with N parallel tool_use blocks has each
// tool_result entry parented to its own tool_use entry, so only the last
// result continues the chain and the other N-1 sit off the
// last-prompt.leafUuid branch (fixtures/claude-code-audit/README.md).
export function indexToolResults(entries: ClaudeCodeRawEntry[]): Map<string, ClaudeCodeToolResultRef> {
  const index = new Map<string, ClaudeCodeToolResultRef>();
  for (const entry of entries) {
    if (entry.type !== "user") {
      continue;
    }
    for (const block of contentBlocksOf(entry)) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const candidate = block as Record<string, unknown>;
      if (candidate.type === "tool_result" && typeof candidate.tool_use_id === "string") {
        index.set(candidate.tool_use_id, { entry, block: candidate });
      }
    }
  }
  return index;
}

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part !== null ? (part as { text?: unknown }).text : undefined))
      .filter((text): text is string => typeof text === "string")
      .join("\n");
  }
  return "";
}

// Confirmed real shapes (Claude Code v2.1.x): a failed Bash call's content
// starts with "Exit code N\n"; a harness timeout reads "Exit code 143\n
// Command timed out after …"; a success carries toolUseResult
// { stdout, stderr, interrupted, … }.
const EXIT_CODE_PREFIX = /^Exit code (\d+)\r?\n?/;
const TIMEOUT = /^Command timed out after/m;
const INTERRUPTED = /^\[Request interrupted by user/m;
const REJECTED = /user doesn't want to proceed|tool use was rejected|permission to use \S+ (?:with .* )?has been denied/i;

export function interpretToolResult(ref: ClaudeCodeToolResultRef): InterpretedToolResult {
  const rawText = textOf(ref.block.content);
  const exitMatch = EXIT_CODE_PREFIX.exec(rawText);
  const text = exitMatch ? rawText.slice(exitMatch[0].length) : rawText;
  const exitCode = exitMatch ? { exitCode: Number(exitMatch[1]) } : {};
  const toolUseResult = ref.entry.toolUseResult;
  const interruptedFlag =
    typeof toolUseResult === "object" && toolUseResult !== null && (toolUseResult as { interrupted?: unknown }).interrupted === true;

  if (ref.block.is_error === true) {
    if (REJECTED.test(text)) {
      return { status: "denied", text };
    }
    if (TIMEOUT.test(text) || INTERRUPTED.test(text) || interruptedFlag) {
      return { status: "interrupted", ...exitCode, text };
    }
    return { status: "error", ...exitCode, text };
  }
  if (interruptedFlag) {
    return { status: "interrupted", text };
  }
  return { status: "success", text };
}
