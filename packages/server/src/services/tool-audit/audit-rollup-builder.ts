import type { AuditRollup, FailureCategory, OutcomeTotals, SessionAudit } from "@copilot-cost-analyzer/domain";
import {
  addToTotals,
  emptyTotals,
  failureRateOf,
  isFailedCall,
  mergeTotals,
  normalizeCommand,
  RankedCounter,
  rankCategories,
} from "./outcome-tally.js";

export interface RollupOptions {
  providerId?: string;
  since?: string;
  until?: string;
  topCommands?: number;
}

const DEFAULT_TOP_COMMANDS = 10;

interface CommandStats {
  program?: string;
  failures: number;
  sessions: Set<string>;
  categories: Map<FailureCategory, number>;
}

function topFailingCommands(audits: SessionAudit[], limit: number): AuditRollup["topFailingCommands"] {
  const stats = new Map<string, CommandStats>();
  for (const audit of audits) {
    for (const { call } of audit.calls) {
      if (!call.shell || !isFailedCall(call)) {
        continue;
      }
      const command = normalizeCommand(call.shell.command);
      const entry = stats.get(command) ?? { program: call.shell.program, failures: 0, sessions: new Set(), categories: new Map() };
      entry.failures += 1;
      entry.sessions.add(audit.sessionId);
      const category = call.outcome?.failureCategory;
      if (category) {
        entry.categories.set(category, (entry.categories.get(category) ?? 0) + 1);
      }
      stats.set(command, entry);
    }
  }
  return [...stats.entries()]
    .map(([command, entry]) => {
      const [topCategory] = rankCategories(entry.categories);
      return {
        command,
        ...(entry.program ? { program: entry.program } : {}),
        failures: entry.failures,
        sessions: entry.sessions.size,
        ...(topCategory ? { failureCategory: topCategory.category } : {}),
      };
    })
    .sort((a, b) => b.failures - a.failures || b.sessions - a.sessions || a.command.localeCompare(b.command))
    .slice(0, limit);
}

function daily(audits: SessionAudit[]): AuditRollup["daily"] {
  const byDate = new Map<string, OutcomeTotals>();
  for (const audit of audits) {
    for (const { call } of audit.calls) {
      const timestamp = call.startedAt ?? audit.startedAt;
      if (!timestamp) {
        continue;
      }
      const date = timestamp.slice(0, 10);
      const row = byDate.get(date) ?? emptyTotals();
      addToTotals(row, call);
      byDate.set(date, row);
    }
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => ({ date, ...row }));
}

// Pure: many SessionAudits in, one cross-session AuditRollup out.
export function buildAuditRollup(audits: SessionAudit[], options: RollupOptions): AuditRollup {
  const totals = emptyTotals();
  const byTool = new RankedCounter<string>();
  const byProgram = new RankedCounter<string>();
  const byCategory = new Map<FailureCategory, number>();
  const unknownReasons = new Set<string>();

  for (const audit of audits) {
    mergeTotals(totals, audit.totals);
    audit.byTool.forEach((row) => byTool.add(row.name, row.calls, row.failed, row.totalDurationMs));
    audit.byShellProgram.forEach((row) => byProgram.add(row.program, row.calls, row.failed));
    audit.byFailureCategory.forEach((row) => byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.count));
    audit.outcomeCoverage.unknownReasons.forEach((reason) => unknownReasons.add(reason));
  }

  return {
    ...(options.providerId ? { providerId: options.providerId } : {}),
    ...(options.since ? { since: options.since } : {}),
    ...(options.until ? { until: options.until } : {}),
    sessionCount: audits.length,
    totals,
    failureRate: failureRateOf(totals),
    byTool: byTool.ranked().map(({ key, calls, failed, durationMs }) => ({
      name: key,
      calls,
      failed,
      ...(durationMs !== undefined ? { totalDurationMs: durationMs } : {}),
    })),
    byShellProgram: byProgram.ranked().map(({ key, calls, failed }) => ({ program: key, calls, failed })),
    byFailureCategory: rankCategories(byCategory),
    topFailingCommands: topFailingCommands(audits, options.topCommands ?? DEFAULT_TOP_COMMANDS),
    daily: daily(audits),
    sessions: audits.map((audit) => ({
      sessionId: audit.sessionId,
      title: audit.title ?? audit.sessionId,
      ...(audit.startedAt ? { startedAt: audit.startedAt } : {}),
      toolCalls: audit.totals.toolCalls,
      failed: audit.totals.failed + audit.totals.interrupted + audit.totals.denied,
      unknown: audit.totals.unknown,
    })),
    outcomeCoverage: {
      known: totals.toolCalls - totals.unknown,
      unknown: totals.unknown,
      unknownReasons: [...unknownReasons],
    },
  };
}
