import {
  isFailedStatus,
  type FailureCategory,
  type OutcomeTotals,
  type ToolCallRecord,
  type ToolCallStatus,
} from "@copilot-cost-analyzer/domain";

// Shared counting primitives for the session and rollup builders.

export const NO_OUTCOME_REASON = "This session's log provider does not record tool-call outcomes.";

export function statusOf(call: ToolCallRecord): ToolCallStatus {
  return call.outcome?.status ?? "unknown";
}

export function isFailedCall(call: ToolCallRecord): boolean {
  return isFailedStatus(statusOf(call));
}

export function emptyTotals(): OutcomeTotals {
  return { toolCalls: 0, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 0 };
}

const TOTALS_KEY: Record<ToolCallStatus, keyof OutcomeTotals> = {
  success: "succeeded",
  error: "failed",
  interrupted: "interrupted",
  denied: "denied",
  unknown: "unknown",
};

export function addToTotals(totals: OutcomeTotals, call: ToolCallRecord): void {
  totals.toolCalls += 1;
  totals[TOTALS_KEY[statusOf(call)]] += 1;
}

export function mergeTotals(target: OutcomeTotals, source: OutcomeTotals): void {
  for (const key of Object.keys(target) as (keyof OutcomeTotals)[]) {
    target[key] += source[key];
  }
}

// (failed + interrupted + denied) over calls whose outcome is known; null
// when none is known so no caller can show a fabricated 0%.
export function failureRateOf(totals: OutcomeTotals): number | null {
  const known = totals.toolCalls - totals.unknown;
  return known === 0 ? null : (totals.failed + totals.interrupted + totals.denied) / known;
}

export function unknownReasonOf(call: ToolCallRecord): string {
  return call.outcome?.status === "unknown" ? (call.outcome.reason ?? NO_OUTCOME_REASON) : NO_OUTCOME_REASON;
}

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

// Counts keyed by name, returned most-frequent first (ties by name) so the
// UI and MCP clients get a stable, ranked list.
export class RankedCounter<K extends string> {
  private readonly rows = new Map<K, { calls: number; failed: number; durationMs?: number }>();

  add(key: K, calls: number, failed: number, durationMs?: number): void {
    const row = this.rows.get(key) ?? { calls: 0, failed: 0 };
    row.calls += calls;
    row.failed += failed;
    if (durationMs !== undefined) {
      row.durationMs = (row.durationMs ?? 0) + durationMs;
    }
    this.rows.set(key, row);
  }

  ranked(): { key: K; calls: number; failed: number; durationMs?: number }[] {
    return [...this.rows.entries()]
      .map(([key, row]) => ({ key, ...row }))
      .sort((a, b) => b.calls - a.calls || b.failed - a.failed || a.key.localeCompare(b.key));
  }
}

export function rankCategories(counts: Map<FailureCategory, number>): { category: FailureCategory; count: number }[] {
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
