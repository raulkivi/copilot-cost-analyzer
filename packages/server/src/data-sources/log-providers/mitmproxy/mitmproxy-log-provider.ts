import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Session, TokenCount, Turn, TurnInspectorDetail, TurnUsage } from "@copilot-cost-analyzer/domain";
import { unavailableTokenCount } from "@copilot-cost-analyzer/domain";
import type { LogProvider, LogProviderAvailability } from "../log-provider.js";
import { buildContentPart } from "../build-content-parts.js";
import { harEntryToRawExchange, readHarFile, type HarEntry } from "./har.js";
import { decodeExchange } from "./decoders/registry.js";
import type { MitmExchangeDecoder } from "./decoders/decoder.js";
import { computeHarSessionId, computeSegmentSessionId, parseSegmentSessionId } from "./session-id.js";
import { DEFAULT_IDLE_GAP_THRESHOLD_MS, splitEntriesByIdleGap } from "./split-entries-by-idle-gap.js";

const PROVIDER_ID = "mitmproxy";
const NO_AI_CREDITS_REASON =
  "AI Credits are GitHub Copilot's own billing unit — a mitmproxy-captured direct vendor API session has no AI Credits conversion.";

export interface MitmproxyLogProviderOptions {
  capturesDirPath: string | null;
  decoders?: MitmExchangeDecoder[];
  idleGapThresholdMs?: number;
}

function reasonOf(tokenCount: TokenCount): string {
  return tokenCount.known ? "" : tokenCount.reason;
}

function buildExchangeExplanation(usage: TurnUsage): string {
  if (usage.uncachedInput.known && usage.output.known) {
    return (
      `This exchange sent ${usage.uncachedInput.value.toLocaleString()} input token(s) and ` +
      `produced ${usage.output.value.toLocaleString()} output token(s) using ${usage.model}.`
    );
  }
  return reasonOf(usage.uncachedInput) || reasonOf(usage.output) || "Usage data is unavailable for this exchange.";
}

// Adapts a local mitmproxy HAR capture into the LogProvider contract
// (architecture.md §6.2.3): one configured captures directory, one or more
// sessions per .har file in it (split by an idle-gap heuristic — §13,
// resolved — when a long-running capture spans multiple coding-agent
// runs), each HAR entry decoded through the vendor decoder registry after
// credential redaction (har.ts/redact-headers.ts).
export class MitmproxyLogProvider implements LogProvider {
  readonly id = PROVIDER_ID;
  readonly label = "mitmproxy (HAR capture)";

  constructor(private readonly options: MitmproxyLogProviderOptions) {}

  private get idleGapThresholdMs(): number {
    return this.options.idleGapThresholdMs ?? DEFAULT_IDLE_GAP_THRESHOLD_MS;
  }

  private listHarFiles(): string[] {
    const dir = this.options.capturesDirPath;
    if (!dir || !existsSync(dir)) {
      return [];
    }
    return readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".har"))
      .map((name) => path.join(dir, name))
      .sort();
  }

  async checkAvailability(): Promise<LogProviderAvailability> {
    const dir = this.options.capturesDirPath;
    if (!dir) {
      return {
        available: false,
        unavailableReason: "No mitmproxy captures directory is configured.",
      };
    }
    if (!existsSync(dir)) {
      return {
        available: false,
        unavailableReason: `Configured mitmproxy captures directory "${dir}" does not exist.`,
      };
    }
    if (this.listHarFiles().length === 0) {
      return {
        available: false,
        unavailableReason: `No .har files found in "${dir}". Export a HAR capture from mitmproxy (mitmdump --set hardump=...) and place it there.`,
      };
    }
    return { available: true };
  }

  // A file's entries are split into one or more idle-gap segments (recomputed
  // fresh on every call rather than cached, matching this class's existing
  // no-caching posture — a capture file still being written to should be
  // re-read, not served stale), each becoming its own Session.
  private buildSessionsFromFile(filePath: string): Session[] {
    const har = readHarFile(filePath);
    const decoders = this.options.decoders ?? [];
    const segments = splitEntriesByIdleGap(har.log.entries, this.idleGapThresholdMs);

    return segments.map((entries, segmentIndex) =>
      this.buildSessionFromSegment(filePath, entries, segmentIndex, segments.length, decoders),
    );
  }

  private buildSessionFromSegment(
    filePath: string,
    entries: HarEntry[],
    segmentIndex: number,
    segmentCount: number,
    decoders: MitmExchangeDecoder[],
  ): Session {
    const id = computeSegmentSessionId(filePath, segmentIndex);

    const turns: Turn[] = entries.map((entry, index) => {
      const exchange = harEntryToRawExchange(entry);
      const normalized = decodeExchange(exchange, decoders);
      return {
        index,
        userMessage: "",
        assistantResponse: "",
        toolCalls: normalized.toolCalls,
        // Same "one HAR entry = one complete round" reasoning as readTurnDetail below.
        usage: { ...normalized.usage, roundsCount: 1 },
        explanation: buildExchangeExplanation(normalized.usage),
      };
    });

    const knownUsageTurns = turns.filter((turn) => turn.usage.output.known);
    const model =
      knownUsageTurns.length > 0
        ? knownUsageTurns[knownUsageTurns.length - 1].usage.model
        : "unknown";
    const startedAt = entries[0]?.startedDateTime;
    const baseName = path.basename(filePath);
    const title = segmentCount > 1 ? `${baseName} (session ${segmentIndex + 1} of ${segmentCount})` : baseName;

    return {
      id,
      mode: "analyze",
      providerId: PROVIDER_ID,
      title,
      model,
      turns,
      turnCount: turns.length,
      costAiCredits: unavailableTokenCount(NO_AI_CREDITS_REASON),
      usageDataAvailable: knownUsageTurns.length > 0,
      ...(startedAt ? { startedAt } : {}),
    };
  }

  async listSessions(): Promise<Session[]> {
    return this.listHarFiles().flatMap((file) =>
      this.buildSessionsFromFile(file).map((session) => ({ ...session, turns: [] })),
    );
  }

  private findFileByHash(fileHash: string): string | null {
    return this.listHarFiles().find((candidate) => computeHarSessionId(candidate) === fileHash) ?? null;
  }

  async readSession(sessionId: string): Promise<Session | null> {
    const parsed = parseSegmentSessionId(sessionId);
    if (!parsed) {
      return null;
    }
    const file = this.findFileByHash(parsed.fileHash);
    if (!file) {
      return null;
    }
    return this.buildSessionsFromFile(file)[parsed.segmentIndex] ?? null;
  }

  // A HAR entry is already a complete, self-contained request/response pair
  // — unlike main.jsonl there's no cross-request inputMessages-growth
  // invariant a capture is guaranteed to
  // follow, so this returns exactly one round with the full raw bodies as
  // text/placeholder parts, bypassing the MitmExchangeDecoder registry
  // entirely (decoders normalize usage, discarding message content, which
  // is exactly what this feature needs back).
  async readTurnDetail(sessionId: string, turnIndex: number): Promise<TurnInspectorDetail | null> {
    const parsed = parseSegmentSessionId(sessionId);
    if (!parsed) {
      return null;
    }
    const file = this.findFileByHash(parsed.fileHash);
    if (!file) {
      return null;
    }

    const har = readHarFile(file);
    const segments = splitEntriesByIdleGap(har.log.entries, this.idleGapThresholdMs);
    const segmentEntries = segments[parsed.segmentIndex];
    if (!segmentEntries) {
      return null;
    }
    // turnIndex is segment-relative, not whole-file-relative.
    const entry = segmentEntries[turnIndex];
    if (!entry) {
      return null;
    }

    const exchange = harEntryToRawExchange(entry);
    return {
      turnIndex,
      userMessage: [],
      rounds: [
        {
          request: {
            index: 0,
            addedMessages: [buildContentPart(exchange.requestBody)],
            toolCalls: [],
          },
          response: {
            index: 0,
            response: [buildContentPart(exchange.responseBody)],
          },
        },
      ],
    };
  }
}
