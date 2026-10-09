import { useEffect, useState } from "react";
import type { AuditRollup } from "@copilot-cost-analyzer/domain";
import { fetchAuditRollup, type RollupQuery } from "../api-client/audit.js";
import { HorizontalBars } from "../charts/HorizontalBars.js";
import { StackedColumns } from "../charts/StackedColumns.js";
import { CATEGORY_LABELS, STATUS_META, failedCountOf, formatCompact, formatFailureRate } from "../lib/audit-format.js";
import { Blueprint } from "./ui/Blueprint.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";
import { StatTile } from "./ui/StatTile.js";

type RangePreset = "7" | "30" | "90" | "all";

const RANGE_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
] as const;

const FAILED_SERIES = [{ id: "failed", label: "Failed", color: STATUS_META.error.color }];
const PROGRAM_SERIES = [
  { id: "succeeded", label: "Succeeded", color: STATUS_META.success.color },
  { id: "failed", label: "Failed", color: STATUS_META.error.color },
];

interface AuditRollupPanelProps {
  onOpenSession: (sessionId: string) => void;
  loadRollup?: (query: RollupQuery) => Promise<AuditRollup>;
  now?: Date;
}

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; rollup: AuditRollup };

function queryFor(preset: RangePreset, now: Date): RollupQuery {
  if (preset === "all") {
    return {};
  }
  const since = new Date(now.getTime() - Number(preset) * 24 * 60 * 60 * 1000);
  return { since: since.toISOString().slice(0, 10) };
}

// Cross-session audit (docs/plans/tool-call-audit.md §11): how often the
// agent's tool calls fail over time, which commands fail repeatedly, and
// which sessions were worst — each session links to its own audit.
export function AuditRollupPanel({ onOpenSession, loadRollup = fetchAuditRollup, now }: AuditRollupPanelProps) {
  const [preset, setPreset] = useState<RangePreset>("30");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // Captured once: a fresh `new Date()` per render would change the effect's
  // dependency every render and refetch forever.
  const [nowTime] = useState(() => (now ?? new Date()).getTime());

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    loadRollup(queryFor(preset, new Date(nowTime)))
      .then((rollup) => !cancelled && setState({ kind: "ready", rollup }))
      .catch((error: Error) => !cancelled && setState({ kind: "error", message: error.message }));
    return () => {
      cancelled = true;
    };
  }, [preset, loadRollup, nowTime]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Tool-call audit across sessions</h3>
        <SegmentedControl name="audit-range" options={RANGE_OPTIONS} value={preset} onChange={setPreset} />
      </div>
      {state.kind === "loading" && <p className="text-muted" style={{ fontSize: 13 }}>Loading audit…</p>}
      {state.kind === "error" && (
        <p role="alert" style={{ fontSize: 13, color: "var(--color-accent-800)" }}>
          Could not load the audit: {state.message}
        </p>
      )}
      {state.kind === "ready" && <RollupBody rollup={state.rollup} onOpenSession={onOpenSession} />}
    </div>
  );
}

function RollupBody({ rollup, onOpenSession }: { rollup: AuditRollup; onOpenSession: (id: string) => void }) {
  if (rollup.sessionCount === 0) {
    return <p className="text-muted" style={{ fontSize: 13 }}>No sessions in this date range.</p>;
  }
  const failed = failedCountOf(rollup.totals);
  const worstProgram = [...rollup.byShellProgram].sort((a, b) => b.failed - a.failed)[0];

  return (
    <>
      <div className="stat-tiles">
        <StatTile label="Sessions" value={String(rollup.sessionCount)} />
        <StatTile label="Tool calls" value={formatCompact(rollup.totals.toolCalls)} />
        <StatTile
          label="Failure rate"
          value={formatFailureRate(rollup.failureRate)}
          note={`${failed} of ${rollup.outcomeCoverage.known} with a known outcome`}
          alert={failed > 0}
        />
        <StatTile
          label="Most failing program"
          value={worstProgram && worstProgram.failed > 0 ? worstProgram.program : "—"}
          note={worstProgram && worstProgram.failed > 0 ? `${worstProgram.failed} of ${worstProgram.calls} calls failed` : undefined}
        />
      </div>

      {rollup.outcomeCoverage.unknown > 0 && (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          Outcome unknown for {rollup.outcomeCoverage.unknown} of {rollup.totals.toolCalls} tool calls:{" "}
          {rollup.outcomeCoverage.unknownReasons.join(" ")}
        </p>
      )}

      <Blueprint className="audit-section">
        <div className="card-kicker">Tool-call outcomes per day</div>
        <StackedColumns
          ariaLabel="Tool-call outcomes per day"
          axisLabel="Day"
          columns={rollup.daily.map((day) => ({
            key: day.date,
            label: day.date.slice(5),
            counts: { success: day.succeeded, error: day.failed, interrupted: day.interrupted, denied: day.denied, unknown: day.unknown },
          }))}
          emptyText="No timestamped tool calls in this range."
        />
      </Blueprint>

      <div className="audit-grid-2">
        <Blueprint className="audit-section">
          <div className="card-kicker">Why calls failed</div>
          <HorizontalBars
            ariaLabel="Failures by category"
            series={FAILED_SERIES}
            rows={rollup.byFailureCategory.map((row) => ({ key: row.category, label: CATEGORY_LABELS[row.category], values: { failed: row.count } }))}
            emptyText="No failed tool calls."
          />
        </Blueprint>
        <Blueprint className="audit-section">
          <div className="card-kicker">Shell programs</div>
          <HorizontalBars
            ariaLabel="Shell calls by program"
            series={PROGRAM_SERIES}
            rows={rollup.byShellProgram.slice(0, 12).map((row) => ({
              key: row.program,
              label: row.program,
              values: { succeeded: row.calls - row.failed, failed: row.failed },
            }))}
            emptyText="No shell commands."
          />
        </Blueprint>
      </div>

      <Blueprint className="audit-section">
        <div className="card-kicker">Top failing commands</div>
        <table className="table" aria-label="Top failing commands" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Command</th>
              <th>Why</th>
              <th>Failures</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {rollup.topFailingCommands.map((row) => (
              <tr key={row.command}>
                <td className="mono truncate" style={{ maxWidth: 360 }} title={row.command}>
                  {row.command}
                </td>
                <td>{row.failureCategory ? CATEGORY_LABELS[row.failureCategory] : "—"}</td>
                <td>{row.failures}</td>
                <td>{row.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rollup.topFailingCommands.length === 0 && (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>No shell command failed.</p>
        )}
      </Blueprint>

      <Blueprint className="audit-section">
        <div className="card-kicker">Sessions</div>
        <table className="table" aria-label="Sessions" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Session</th>
              <th>Started</th>
              <th>Tool calls</th>
              <th>Failed</th>
              <th>Failure rate</th>
            </tr>
          </thead>
          <tbody>
            {[...rollup.sessions]
              .sort((a, b) => b.failed - a.failed || (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))
              .map((row) => (
                <tr key={row.sessionId}>
                  <td className="truncate" style={{ maxWidth: 320 }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: 0, fontFamily: "var(--font-body)", fontWeight: 400 }}
                      onClick={() => onOpenSession(row.sessionId)}
                    >
                      {row.title}
                    </button>
                  </td>
                  <td>{row.startedAt ? row.startedAt.slice(0, 16).replace("T", " ") : "—"}</td>
                  <td>{row.toolCalls}</td>
                  <td>{row.failed}</td>
                  <td>{formatFailureRate(row.toolCalls - row.unknown > 0 ? row.failed / (row.toolCalls - row.unknown) : null)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Blueprint>
    </>
  );
}
