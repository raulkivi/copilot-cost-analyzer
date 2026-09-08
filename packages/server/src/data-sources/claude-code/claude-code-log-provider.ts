import { existsSync } from "node:fs";
import {
  unavailableTokenCount,
  type Session,
  type TokenCount,
  type TriggeredEvent,
  type Turn,
  type TurnInspectorDetail,
  type TurnUsage,
} from "@gh-cp-chat-analyser/domain";
import type { LogProvider, LogProviderAvailability } from "../log-providers/log-provider.js";
import { listClaudeCodeSessionFiles } from "../../platform/claude-code-paths/resolve-claude-code-projects-dir.js";
import { readClaudeCodeSessionFile, type ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { findForkPointIds, resolveActiveLeafUuid, walkBranch } from "./session-tree.js";
import { groupBranchEntriesByUserMessage, type ClaudeCodeTurnGroup } from "./turn-grouper.js";
import { groupTurnEntriesByRound } from "./round-grouper.js";
import { extractToolCalls, extractTurnUsage } from "./usage-extractor.js";
import { buildTurnInspectorDetail } from "./turn-inspector-builder.js";
import { computeClaudeCodeFileHash, resolveClaudeCodeSessionFilePath } from "./session-id.js";
import { resolveClaudeCodeTitle } from "./title-resolver.js";

const PROVIDER_ID = "claude-code";
const NO_AI_CREDITS_REASON =
  "AI Credits are GitHub Copilot's own billing unit — a Claude Code CLI session has no AI Credits conversion.";

export interface ClaudeCodeLogProviderOptions {
  projectsDirPath: string | null;
}

function reasonOf(tokenCount: TokenCount): string {
  return tokenCount.known ? "" : tokenCount.reason;
}

function buildTurnExplanation(usage: TurnUsage): string {
  if (usage.uncachedInput.known && usage.output.known) {
    let text =
      `This turn sent ${usage.uncachedInput.value.toLocaleString()} new input token(s)` +
      (usage.cacheRead.known && usage.cacheRead.value > 0
        ? ` and reused ${usage.cacheRead.value.toLocaleString()} from cache`
        : "");
    text += `, producing ${usage.output.value.toLocaleString()} output token(s) using ${usage.model}.`;
    return text;
  }
  return reasonOf(usage.uncachedInput) || reasonOf(usage.output) || "Usage data is unavailable for this turn.";
}

function messageOf(entry: ClaudeCodeRawEntry): Record<string, unknown> | null {
  return typeof entry.message === "object" && entry.message !== null
    ? (entry.message as Record<string, unknown>)
    : null;
}

function extractUserMessageText(entry: ClaudeCodeRawEntry | undefined): string {
  const content = entry ? messageOf(entry)?.content : undefined;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "object" && block !== null ? (block as { text?: unknown }).text : undefined))
      .filter((text): text is string => typeof text === "string")
      .join("\n");
  }
  return "";
}

// The turn's final answer — the last round's text blocks (excluding
// thinking/tool_use), joined. Duplicated here rather than reused from
// turn-inspector-builder.ts's own block-classification helpers, same
// "small provider-local text extraction, separate from the inspector's
// richer content-part building" precedent as
// pi-agent-log-provider.ts's own extractAssistantResponseText.
function extractAssistantResponseText(group: ClaudeCodeTurnGroup): string {
  const rounds = groupTurnEntriesByRound(group.entries);
  const lastRound = rounds.at(-1);
  if (!lastRound) {
    return "";
  }

  const texts: string[] = [];
  for (const entry of lastRound.entries) {
    const content = messageOf(entry)?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (typeof block === "object" && block !== null) {
        const textBlock = block as { type?: unknown; text?: unknown };
        if (textBlock.type === "text" && typeof textBlock.text === "string") {
          texts.push(textBlock.text);
        }
      }
    }
  }
  return texts.join("\n");
}

// Only "fork" is detected in v1 (no confirmed on-disk marker yet for the
// other enum values — ship without rather than guess, per the plan).
// Checking specifically against the turn's own userMessageEntry.parentUuid
// (not every entry) is load-bearing: a parallel tool-call response also
// produces parentUuid multiplicities in real captures, but never with a
// genuine new user turn as one of the children — only a real
// message-edit/resend does that, so this check alone can't misfire on
// parallel-tool-call structure (see session-tree.ts's findForkPointIds).
function triggeredEventFor(group: ClaudeCodeTurnGroup, forkPointIds: Set<string>): TriggeredEvent | undefined {
  const parentUuid = group.userMessageEntry.parentUuid;
  return typeof parentUuid === "string" && forkPointIds.has(parentUuid) ? "fork" : undefined;
}

// Earliest timestamp among the branch's own entries (constraint: only the
// entries actually on the active branch, not sibling forks).
function resolveStartedAt(branch: ClaudeCodeRawEntry[]): string | undefined {
  const timestamps = branch.map((entry) => entry.timestamp).filter((t): t is string => typeof t === "string");
  return timestamps.length > 0 ? timestamps.reduce((earliest, t) => (t < earliest ? t : earliest)) : undefined;
}

// Reads Claude Code CLI's own JSONL session format directly
// (~/.claude/projects/<encoded-cwd>/<session-id>.jsonl) — no proxy/
// certificate setup or OS-level store dependency, mirroring
// PiAgentLogProvider's "read the agent's own logs" approach for a
// different agent. Unlike pi, one Session is produced per *file*, not per
// leaf branch: Claude Code's own `last-prompt.leafUuid` pointer already
// names the authoritative active branch (session-tree.ts's
// resolveActiveLeafUuid), so there's no need to guess/expose every fork as
// its own session.
export class ClaudeCodeLogProvider implements LogProvider {
  readonly id = PROVIDER_ID;
  readonly label = "Claude Code CLI";

  constructor(private readonly options: ClaudeCodeLogProviderOptions) {}

  private listSessionFilePaths(): string[] {
    return this.options.projectsDirPath ? listClaudeCodeSessionFiles(this.options.projectsDirPath) : [];
  }

  async checkAvailability(): Promise<LogProviderAvailability> {
    const dir = this.options.projectsDirPath;
    if (!dir) {
      return { available: false, unavailableReason: "No Claude Code projects directory is configured." };
    }
    if (!existsSync(dir)) {
      return { available: false, unavailableReason: `Configured Claude Code projects directory "${dir}" does not exist.` };
    }
    if (this.listSessionFilePaths().length === 0) {
      return { available: false, unavailableReason: `No Claude Code session files found under "${dir}".` };
    }
    return { available: true };
  }

  private buildSession(filePath: string, entries: ClaudeCodeRawEntry[]): Session {
    const activeLeafUuid = resolveActiveLeafUuid(entries);
    const branch = activeLeafUuid ? walkBranch(entries, activeLeafUuid) : [];
    const forkPointIds = findForkPointIds(entries);
    const groups = groupBranchEntriesByUserMessage(branch);

    const turns: Turn[] = groups.map((group, index) => {
      const usage = extractTurnUsage(group);
      const triggeredEvent = triggeredEventFor(group, forkPointIds);
      return {
        index,
        userMessage: extractUserMessageText(group.userMessageEntry),
        assistantResponse: extractAssistantResponseText(group),
        toolCalls: extractToolCalls(group),
        usage,
        explanation: buildTurnExplanation(usage),
        ...(triggeredEvent ? { triggeredEvent } : {}),
      };
    });

    const knownUsageTurns = turns.filter((turn) => turn.usage.output.known);
    const model = knownUsageTurns.length > 0 ? knownUsageTurns[knownUsageTurns.length - 1].usage.model : "unknown";
    const startedAt = resolveStartedAt(branch);

    return {
      id: computeClaudeCodeFileHash(filePath),
      mode: "analyze",
      providerId: PROVIDER_ID,
      title: resolveClaudeCodeTitle(entries),
      model,
      turns,
      turnCount: turns.length,
      costAiCredits: unavailableTokenCount(NO_AI_CREDITS_REASON),
      usageDataAvailable: knownUsageTurns.length > 0,
      ...(startedAt ? { startedAt } : {}),
    };
  }

  private async buildSessionFromFile(filePath: string): Promise<Session> {
    const { entries } = await readClaudeCodeSessionFile(filePath);
    return this.buildSession(filePath, entries);
  }

  async listSessions(): Promise<Session[]> {
    const sessions = await Promise.all(this.listSessionFilePaths().map((filePath) => this.buildSessionFromFile(filePath)));
    return sessions
      .map((session) => ({ ...session, turns: [] }))
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  }

  async readSession(sessionId: string): Promise<Session | null> {
    const filePath = resolveClaudeCodeSessionFilePath(this.listSessionFilePaths(), sessionId);
    if (!filePath) {
      return null;
    }
    return this.buildSessionFromFile(filePath);
  }

  async readTurnDetail(sessionId: string, turnIndex: number): Promise<TurnInspectorDetail | null> {
    const filePath = resolveClaudeCodeSessionFilePath(this.listSessionFilePaths(), sessionId);
    if (!filePath) {
      return null;
    }

    const { entries } = await readClaudeCodeSessionFile(filePath);
    const activeLeafUuid = resolveActiveLeafUuid(entries);
    if (!activeLeafUuid) {
      return null;
    }
    const branch = walkBranch(entries, activeLeafUuid);
    const group = groupBranchEntriesByUserMessage(branch)[turnIndex];
    if (!group) {
      return null;
    }
    return buildTurnInspectorDetail(turnIndex, group);
  }
}
