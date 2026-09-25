import { existsSync } from "node:fs";
import path from "node:path";
import {
  unavailableTokenCount,
  type Session,
  type TokenCount,
  type TriggeredEvent,
  type Turn,
  type TurnInspectorDetail,
  type TurnUsage,
} from "@copilot-cost-analyzer/domain";
import type { LogProvider, LogProviderAvailability } from "../log-providers/log-provider.js";
import { listPiAgentSessionFiles } from "../../platform/pi-agent-paths/resolve-pi-agent-sessions-dir.js";
import { assistantMessageOf, messageOf } from "./pi-message.js";
import { readPiSessionFile, type PiRawEntry, type PiSessionHeader } from "./pi-jsonl-reader.js";
import { findLeafEntryIds, walkBranch } from "./session-tree.js";
import { groupBranchEntriesByUserMessage, type PiTurnGroup } from "./turn-grouper.js";
import { extractToolCalls, extractTurnUsage } from "./usage-extractor.js";
import { buildTurnInspectorDetail } from "./turn-inspector-builder.js";
import { computeBranchSessionId, computePiFileHash, parseBranchSessionId } from "./session-id.js";
import { buildPiSystemPromptComponents } from "./system-prompt-components.js";
import { readSystemPromptSidecarIndex, type SidecarIndex } from "./system-prompt-sidecar-reader.js";

const PROVIDER_ID = "pi-agent";
const NO_AI_CREDITS_REASON =
  "AI Credits are GitHub Copilot's own billing unit — a pi coding-agent session has no AI Credits conversion.";

export interface PiAgentLogProviderOptions {
  sessionsDirPath: string | null;
  // Optional: path to the pi-system-prompt-logger extension's JSONL sidecar
  // log (packages/pi-system-prompt-logger). Omitted/null means no such
  // extension is installed — Session.systemPrompt simply stays unset for
  // every session, exactly as before this option existed.
  systemPromptLogPath?: string | null;
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

function extractMessageText(entry: PiRawEntry | undefined): string {
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

function extractAssistantResponseText(group: PiTurnGroup): string {
  const lastAssistantEntry = [...group.entries].reverse().find((entry) => assistantMessageOf(entry));
  return extractMessageText(lastAssistantEntry);
}

// Any entry id claimed as `parentId` by more than one other entry is a fork
// point — computed once per file (over every branch, not just the one being
// built) so a turn immediately following a fork point can be tagged
// regardless of which sibling branch it's on.
function findForkPointIds(entries: PiRawEntry[]): Set<string> {
  const childCounts = new Map<string, number>();
  for (const entry of entries) {
    if (typeof entry.parentId === "string") {
      childCounts.set(entry.parentId, (childCounts.get(entry.parentId) ?? 0) + 1);
    }
  }
  return new Set([...childCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id));
}

function triggeredEventFor(group: PiTurnGroup, forkPointIds: Set<string>): TriggeredEvent | undefined {
  if (typeof group.userMessageEntry.parentId === "string" && forkPointIds.has(group.userMessageEntry.parentId)) {
    return "fork";
  }
  if (group.entries.some((entry) => entry.type === "model_change")) {
    return "model-switch";
  }
  if (group.entries.some((entry) => entry.type === "compaction" || messageOf(entry)?.role === "compactionSummary")) {
    return "compaction";
  }
  return undefined;
}

function resolveTitle(
  branch: PiRawEntry[],
  header: PiSessionHeader | null,
  leafIndex: number,
  leafCount: number,
): string {
  const sessionInfoName = [...branch]
    .reverse()
    .find((entry) => entry.type === "session_info" && typeof entry.name === "string")?.name as string | undefined;

  const base =
    sessionInfoName ?? (header?.cwd ? path.basename(header.cwd) : `Session ${header?.id ?? "unknown"}`);
  return leafCount > 1 ? `${base} (branch ${leafIndex + 1} of ${leafCount})` : base;
}

// Reads pi's own JSONL session format directly
// (https://pi.dev/docs/latest/session-format) — no OS-level store dependency,
// unlike the VS Code provider's SQLite + main.jsonl split. pi sessions form a
// branchable tree (fork/rewind); since Session.turns is a flat array
// (constraint 12 forbids changing that contract), one Session is produced
// per leaf branch — the same "one file -> N sessions" precedent already set
// by the mitmproxy provider's idle-gap split.
export class PiAgentLogProvider implements LogProvider {
  readonly id = PROVIDER_ID;
  readonly label = "pi coding agent";

  constructor(private readonly options: PiAgentLogProviderOptions) {}

  private listSessionFilePaths(): string[] {
    return this.options.sessionsDirPath ? listPiAgentSessionFiles(this.options.sessionsDirPath) : [];
  }

  async checkAvailability(): Promise<LogProviderAvailability> {
    const dir = this.options.sessionsDirPath;
    if (!dir) {
      return { available: false, unavailableReason: "No pi sessions directory is configured." };
    }
    if (!existsSync(dir)) {
      return { available: false, unavailableReason: `Configured pi sessions directory "${dir}" does not exist.` };
    }
    if (this.listSessionFilePaths().length === 0) {
      return { available: false, unavailableReason: `No pi session files found under "${dir}".` };
    }
    return { available: true };
  }

  private buildSessionForBranch(
    filePath: string,
    header: PiSessionHeader | null,
    allEntries: PiRawEntry[],
    leafId: string,
    leafIndex: number,
    leafCount: number,
    sidecarIndex: SidecarIndex,
  ): Session {
    const branch = walkBranch(allEntries, leafId);
    const forkPointIds = findForkPointIds(allEntries);
    const groups = groupBranchEntriesByUserMessage(branch);

    const turns: Turn[] = groups.map((group, index) => {
      const usage = extractTurnUsage(group);
      const triggeredEvent = triggeredEventFor(group, forkPointIds);
      return {
        index,
        userMessage: extractMessageText(group.userMessageEntry),
        assistantResponse: extractAssistantResponseText(group),
        toolCalls: extractToolCalls(group),
        usage,
        explanation: buildTurnExplanation(usage),
        ...(triggeredEvent ? { triggeredEvent } : {}),
      };
    });

    const knownUsageTurns = turns.filter((turn) => turn.usage.output.known);
    const model = knownUsageTurns.length > 0 ? knownUsageTurns[knownUsageTurns.length - 1].usage.model : "unknown";
    const id = leafCount > 1 ? computeBranchSessionId(filePath, leafId) : computePiFileHash(filePath);
    const sidecarRecord = sidecarIndex.get(path.resolve(filePath));

    return {
      id,
      mode: "analyze",
      providerId: PROVIDER_ID,
      title: resolveTitle(branch, header, leafIndex, leafCount),
      model,
      turns,
      turnCount: turns.length,
      costAiCredits: unavailableTokenCount(NO_AI_CREDITS_REASON),
      usageDataAvailable: knownUsageTurns.length > 0,
      ...(header ? { startedAt: header.timestamp } : {}),
      ...(sidecarRecord ? { systemPrompt: buildPiSystemPromptComponents(sidecarRecord) } : {}),
    };
  }

  private loadSidecarIndex(): Promise<SidecarIndex> {
    return readSystemPromptSidecarIndex(this.options.systemPromptLogPath ?? null);
  }

  private async buildSessionsFromFile(filePath: string, sidecarIndex: SidecarIndex): Promise<Session[]> {
    const { header, entries } = await readPiSessionFile(filePath);
    const leafIds = findLeafEntryIds(entries);
    return leafIds.map((leafId, leafIndex) =>
      this.buildSessionForBranch(filePath, header, entries, leafId, leafIndex, leafIds.length, sidecarIndex),
    );
  }

  async listSessions(): Promise<Session[]> {
    const sidecarIndex = await this.loadSidecarIndex();
    const sessionsPerFile = await Promise.all(
      this.listSessionFilePaths().map((filePath) => this.buildSessionsFromFile(filePath, sidecarIndex)),
    );
    return sessionsPerFile
      .flat()
      .map((session) => ({ ...session, turns: [] }))
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  }

  private async resolveBranch(sessionId: string): Promise<
    | { filePath: string; header: PiSessionHeader | null; entries: PiRawEntry[]; leafId: string; leafIndex: number; leafCount: number }
    | null
  > {
    const parsed = parseBranchSessionId(sessionId);
    const fileHash = parsed?.fileHash ?? sessionId;
    const filePath = this.listSessionFilePaths().find((file) => computePiFileHash(file) === fileHash);
    if (!filePath) {
      return null;
    }

    const { header, entries } = await readPiSessionFile(filePath);
    const leafIds = findLeafEntryIds(entries);
    const leafId = parsed?.leafId ?? leafIds[0];
    const leafIndex = leafIds.indexOf(leafId);
    if (leafIndex === -1) {
      return null;
    }

    return { filePath, header, entries, leafId, leafIndex, leafCount: leafIds.length };
  }

  async readSession(sessionId: string): Promise<Session | null> {
    const resolved = await this.resolveBranch(sessionId);
    if (!resolved) {
      return null;
    }
    const sidecarIndex = await this.loadSidecarIndex();
    return this.buildSessionForBranch(
      resolved.filePath,
      resolved.header,
      resolved.entries,
      resolved.leafId,
      resolved.leafIndex,
      resolved.leafCount,
      sidecarIndex,
    );
  }

  async readTurnDetail(sessionId: string, turnIndex: number): Promise<TurnInspectorDetail | null> {
    const resolved = await this.resolveBranch(sessionId);
    if (!resolved) {
      return null;
    }
    const branch = walkBranch(resolved.entries, resolved.leafId);
    const group = groupBranchEntriesByUserMessage(branch)[turnIndex];
    if (!group) {
      return null;
    }
    return buildTurnInspectorDetail(turnIndex, group);
  }

  // Raw captured system-prompt text for the "inspect as text" view
  // (SystemPromptInspector) — not part of the shared LogProvider interface
  // (ISP: VscodeLogProvider/MitmproxyLogProvider have no equivalent), same
  // precedent as the VS-Code-only system-prompt route special-casing
  // VscodeLogProvider directly. Re-reads the sidecar log fresh each call,
  // same "no caching layer" posture as readTurnDetail.
  async readSystemPromptText(sessionId: string): Promise<string | null> {
    const resolved = await this.resolveBranch(sessionId);
    if (!resolved) {
      return null;
    }
    const sidecarIndex = await this.loadSidecarIndex();
    return sidecarIndex.get(path.resolve(resolved.filePath))?.systemPrompt ?? null;
  }
}
