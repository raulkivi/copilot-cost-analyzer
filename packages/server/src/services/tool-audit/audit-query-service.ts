import type {
  AuditedToolCall,
  AuditRollup,
  FailureCategory,
  Session,
  SessionAudit,
  ToolCallStatus,
} from "@copilot-cost-analyzer/domain";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { buildAuditRollup } from "./audit-rollup-builder.js";
import { buildSessionAudit } from "./session-audit-builder.js";
import { statusOf } from "./outcome-tally.js";

// The narrow slice of LogProviderRegistry this service needs (DIP) — the
// HTTP API and the MCP server both construct it over the same registry.
export interface ProviderLookup {
  getActiveProvider(): LogProvider;
  getProvider(providerId: string): LogProvider;
}

export interface SessionRangeFilter {
  providerId?: string;
  // ISO dates/timestamps, compared against Session.startedAt at the
  // bound's own precision ("2026-09-20" includes that whole day).
  since?: string;
  until?: string;
  limit?: number;
}

export interface ToolCallFilter {
  status?: ToolCallStatus[];
  failureCategory?: FailureCategory[];
  tool?: string;
  program?: string;
  turnIndex?: number;
  limit?: number;
}

export const DEFAULT_ROLLUP_SESSION_LIMIT = 50;
export const MAX_ROLLUP_SESSION_LIMIT = 500;

function inRange(startedAt: string | undefined, since?: string, until?: string): boolean {
  if (!since && !until) {
    return true;
  }
  if (!startedAt) {
    return false;
  }
  if (since && startedAt.slice(0, since.length) < since) {
    return false;
  }
  if (until && startedAt.slice(0, until.length) > until) {
    return false;
  }
  return true;
}

function matches(audited: AuditedToolCall, filter: ToolCallFilter): boolean {
  const { call } = audited;
  const category = call.outcome?.failureCategory;
  return (
    (!filter.status || filter.status.includes(statusOf(call))) &&
    (!filter.failureCategory || (category !== undefined && filter.failureCategory.includes(category))) &&
    (!filter.tool || call.name === filter.tool) &&
    (!filter.program || call.shell?.program === filter.program) &&
    (filter.turnIndex === undefined || audited.turnIndex === filter.turnIndex)
  );
}

// Application service over normalized Sessions: provider-agnostic, pure
// builders underneath, no HTTP/MCP concerns.
export class AuditQueryService {
  constructor(private readonly providers: ProviderLookup) {}

  private provider(providerId?: string): LogProvider {
    return providerId ? this.providers.getProvider(providerId) : this.providers.getActiveProvider();
  }

  async listSessions(filter: SessionRangeFilter): Promise<Session[]> {
    const sessions = await this.provider(filter.providerId).listSessions();
    const inWindow = sessions
      .filter((session) => inRange(session.startedAt, filter.since, filter.until))
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
    return filter.limit !== undefined ? inWindow.slice(0, filter.limit) : inWindow;
  }

  async getSessionAudit(sessionId: string, providerId?: string): Promise<SessionAudit | null> {
    const session = await this.provider(providerId).readSession(sessionId);
    return session ? buildSessionAudit(session) : null;
  }

  async listToolCalls(
    sessionId: string,
    filter: ToolCallFilter,
    providerId?: string,
  ): Promise<{ total: number; calls: AuditedToolCall[] } | null> {
    const audit = await this.getSessionAudit(sessionId, providerId);
    if (!audit) {
      return null;
    }
    const matching = audit.calls.filter((audited) => matches(audited, filter));
    return { total: matching.length, calls: filter.limit !== undefined ? matching.slice(0, filter.limit) : matching };
  }

  async getRollup(filter: SessionRangeFilter): Promise<AuditRollup> {
    const provider = this.provider(filter.providerId);
    const limit = Math.min(filter.limit ?? DEFAULT_ROLLUP_SESSION_LIMIT, MAX_ROLLUP_SESSION_LIMIT);
    const summaries = await this.listSessions({ ...filter, providerId: provider.id, limit });
    const audits: SessionAudit[] = [];
    // Sequential on purpose: each readSession can parse a large log file,
    // and a rollup over hundreds of sessions shouldn't hold them all at once.
    for (const summary of summaries) {
      const session = await provider.readSession(summary.id);
      if (session) {
        audits.push(buildSessionAudit(session));
      }
    }
    return buildAuditRollup(audits, { providerId: provider.id, since: filter.since, until: filter.until });
  }
}
