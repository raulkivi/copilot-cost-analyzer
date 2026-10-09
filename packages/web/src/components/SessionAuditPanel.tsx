import { useEffect, useMemo, useState } from "react";
import type { AuditedToolCall, FailureCategory, SessionAudit, ToolCallStatus } from "@copilot-cost-analyzer/domain";
import { fetchSessionAudit } from "../api-client/audit.js";
import { HorizontalBars } from "../charts/HorizontalBars.js";
import { StackedColumns } from "../charts/StackedColumns.js";
import {
  CATEGORY_LABELS,
  STATUS_META,
  STATUS_ORDER,
  failedCountOf,
  formatCompact,
  formatFailureRate,
} from "../lib/audit-format.js";
import { Blueprint } from "./ui/Blueprint.js";
import { StatTile } from "./ui/StatTile.js";
import { StatusTag } from "./ui/StatusTag.js";

interface SessionAuditPanelProps {
  sessionId: string;
  // Array position in session.turns (the app's turn selection), not Turn.index.
  selectedTurnIndex: number;
  onSelectTurn: (turnPosition: number) => void;
  onInspectTurn: (turnPosition: number) => void;
  loadAudit?: (sessionId: string) => Promise<SessionAudit>;
}

const DEFAULT_STATUS_FILTER: ToolCallStatus[] = ["error", "interrupted", "denied"];
const MAX_ROWS = 200;
const FAILED_SERIES = [{ id: "failed", label: "Failed", color: STATUS_META.error.color }];
const PROGRAM_SERIES = [
  { id: "succeeded", label: "Succeeded", color: STATUS_META.success.color },
  { id: "failed", label: "Failed", color: STATUS_META.error.color },
];

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; audit: SessionAudit };

// Output leads: input in agent turns is dominated by cache reads, which would
// dwarf the part of the spend a failure actually drove.
function affectedTurnsTokens(audit: SessionAudit): { value: string; note: string } {
  const { affectedTurns, affectedTurnsInputTokens: input, affectedTurnsOutputTokens: output } = audit.failureRecoveryCost;
  if (affectedTurns.length === 0) {
    return { value: "0", note: "no turn had a failure" };
  }
  return {
    value: output.known ? formatCompact(output.value) : "—",
    note: input.known ? `+${formatCompact(input.value)} input incl. cache` : "input unknown",
  };
}

function statusOf(audited: AuditedToolCall): ToolCallStatus {
  return audited.call.outcome?.status ?? "unknown";
}

// The session-level tool-call audit (docs/plans/tool-call-audit.md §11):
// headline tiles, per-turn outcome columns, failure-category and program
// breakdowns that double as filters, a filterable call table with evidence,
// and retried commands.
export function SessionAuditPanel({
  sessionId,
  selectedTurnIndex,
  onSelectTurn,
  onInspectTurn,
  loadAudit = fetchSessionAudit,
}: SessionAuditPanelProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [statusFilter, setStatusFilter] = useState<ToolCallStatus[]>(DEFAULT_STATUS_FILTER);
  const [categoryFilter, setCategoryFilter] = useState<FailureCategory | null>(null);
  const [programFilter, setProgramFilter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setCategoryFilter(null);
    setProgramFilter(null);
    setStatusFilter(DEFAULT_STATUS_FILTER);
    loadAudit(sessionId)
      .then((audit) => !cancelled && setState({ kind: "ready", audit }))
      .catch((error: Error) => !cancelled && setState({ kind: "error", message: error.message }));
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadAudit]);

  const audit = state.kind === "ready" ? state.audit : null;
  // Turn.index → array position, for callbacks into the app's turn selection.
  const positionOfTurn = useMemo(
    () => new Map((audit?.perTurn ?? []).map((row, position) => [row.turnIndex, position])),
    [audit],
  );

  if (state.kind === "loading") {
    return <p className="text-muted" style={{ fontSize: 13 }}>Loading tool-call audit…</p>;
  }
  if (state.kind === "error") {
    return (
      <p role="alert" style={{ fontSize: 13, color: "var(--color-accent-800)" }}>
        Could not load the tool-call audit: {state.message}
      </p>
    );
  }

  const { audit: data } = state;
  const knownOutcomes = data.outcomeCoverage.known;
  const failed = failedCountOf(data.totals);
  const shellCalls = data.byShellProgram.reduce((sum, row) => sum + row.calls, 0);
  const statusCounts = new Map(STATUS_ORDER.map((status) => [status, data.calls.filter((c) => statusOf(c) === status).length]));
  const filtered = data.calls.filter(
    (audited) =>
      statusFilter.includes(statusOf(audited)) &&
      (!categoryFilter || audited.call.outcome?.failureCategory === categoryFilter) &&
      (!programFilter || audited.call.shell?.program === programFilter),
  );
  const positionFor = (turnIndex: number) => positionOfTurn.get(turnIndex) ?? turnIndex;

  function toggleStatus(status: ToolCallStatus): void {
    setStatusFilter((current) => (current.includes(status) ? current.filter((s) => s !== status) : [...current, status]));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div className="stat-tiles">
        <StatTile label="Tool calls" value={formatCompact(data.totals.toolCalls)} note={`${data.byTool.length} distinct tools`} />
        <StatTile
          label="Failure rate"
          value={formatFailureRate(data.failureRate)}
          note={knownOutcomes > 0 ? `${failed} of ${knownOutcomes} with a known outcome` : "no outcome recorded"}
          alert={failed > 0}
        />
        <StatTile label="Shell commands" value={formatCompact(shellCalls)} note={`${data.byShellProgram.length} programs`} />
        <StatTile label="Retried commands" value={String(data.retries.length)} note="same command re-run after a failure" />
        <StatTile
          label="Recovery rounds"
          value={String(data.failureRecoveryCost.recoveryRounds)}
          note="model rounds spent reacting to failures"
        />
        <StatTile label="Output tokens in affected turns" {...affectedTurnsTokens(data)} />
      </div>

      {data.outcomeCoverage.unknown > 0 && (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          Outcome unknown for {data.outcomeCoverage.unknown} of {data.totals.toolCalls} tool calls:{" "}
          {data.outcomeCoverage.unknownReasons.join(" ")}
        </p>
      )}

      <Blueprint className="audit-section">
        <div className="card-kicker">Tool-call outcomes per turn</div>
        <StackedColumns
          ariaLabel="Tool-call outcomes per turn"
          axisLabel="Turn"
          columns={data.perTurn.map((row) => ({
            key: String(positionFor(row.turnIndex)),
            label: String(row.turnIndex),
            counts: { success: row.succeeded, error: row.failed, interrupted: row.interrupted, denied: row.denied, unknown: row.unknown },
          }))}
          selectedKey={String(selectedTurnIndex)}
          onSelect={(key) => onSelectTurn(Number(key))}
          emptyText="This session has no turns."
        />
      </Blueprint>

      <div className="audit-grid-2">
        <Blueprint className="audit-section">
          <div className="card-kicker">Why calls failed</div>
          <HorizontalBars
            ariaLabel="Failures by category"
            series={FAILED_SERIES}
            rows={data.byFailureCategory.map((row) => ({
              key: row.category,
              label: CATEGORY_LABELS[row.category],
              values: { failed: row.count },
            }))}
            selectedKey={categoryFilter ?? undefined}
            onSelect={(key) => setCategoryFilter((current) => (current === key ? null : (key as FailureCategory)))}
            emptyText={knownOutcomes > 0 ? "No failed tool calls." : "No outcome data to classify."}
          />
        </Blueprint>
        <Blueprint className="audit-section">
          <div className="card-kicker">Shell programs</div>
          <HorizontalBars
            ariaLabel="Shell calls by program"
            series={PROGRAM_SERIES}
            rows={data.byShellProgram.map((row) => ({
              key: row.program,
              label: row.program,
              values: { succeeded: row.calls - row.failed, failed: row.failed },
            }))}
            selectedKey={programFilter ?? undefined}
            onSelect={(key) => setProgramFilter((current) => (current === key ? null : key))}
            emptyText="No shell commands in this session."
          />
        </Blueprint>
      </div>

      <Blueprint className="audit-section">
        <div className="card-kicker">Tool calls</div>
        <div className="filter-chips">
          {STATUS_ORDER.map((status) => (
            <button
              key={status}
              type="button"
              className="filter-chip"
              aria-pressed={statusFilter.includes(status)}
              onClick={() => toggleStatus(status)}
            >
              <span aria-hidden="true">{STATUS_META[status].icon} </span>
              {STATUS_META[status].label} {statusCounts.get(status)}
            </button>
          ))}
          {categoryFilter && (
            <button
              type="button"
              className="filter-chip"
              aria-pressed="true"
              aria-label={`Clear category filter: ${CATEGORY_LABELS[categoryFilter]}`}
              onClick={() => setCategoryFilter(null)}
            >
              {CATEGORY_LABELS[categoryFilter]} ✕
            </button>
          )}
          {programFilter && (
            <button
              type="button"
              className="filter-chip"
              aria-pressed="true"
              aria-label={`Clear program filter: ${programFilter}`}
              onClick={() => setProgramFilter(null)}
            >
              {programFilter} ✕
            </button>
          )}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="table" aria-label="Tool calls" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Turn</th>
                <th>Tool</th>
                <th>Command / input</th>
                <th>Outcome</th>
                <th>Exit</th>
                <th>Evidence</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, MAX_ROWS).map((audited, index) => {
                const { call } = audited;
                const position = positionFor(audited.turnIndex);
                return (
                  <tr
                    key={`${call.id ?? index}-${audited.turnIndex}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => onSelectTurn(position)}
                  >
                    <td>{audited.turnIndex}</td>
                    <td className="mono">{call.name}</td>
                    <td className="mono truncate" style={{ maxWidth: 260 }} title={call.shell?.command ?? call.argsSummary}>
                      {call.shell?.command ?? call.argsSummary}
                    </td>
                    <td>
                      <StatusTag outcome={call.outcome} />
                    </td>
                    <td className="mono">{call.outcome?.exitCode ?? "—"}</td>
                    <td
                      className="mono truncate text-muted"
                      style={{ maxWidth: 240 }}
                      title={call.outcome?.classificationEvidence?.excerpt}
                    >
                      {call.outcome?.classificationEvidence?.excerpt ?? ""}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: "0 4px" }}
                        aria-label={`Inspect turn ${audited.turnIndex}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onInspectTurn(position);
                        }}
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="text-muted" style={{ fontSize: 13, margin: "var(--space-2) 0 0" }}>
              No tool calls match these filters.
            </p>
          )}
          {filtered.length > MAX_ROWS && (
            <p className="text-muted" style={{ fontSize: 12, margin: "var(--space-2) 0 0" }}>
              Showing {MAX_ROWS} of {filtered.length}. Narrow the filters to see the rest.
            </p>
          )}
        </div>
      </Blueprint>

      <Blueprint className="audit-section">
        <div className="card-kicker">Retried commands</div>
        {data.retries.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            No command was re-run after failing.
          </p>
        ) : (
          <ul aria-label="Retried commands" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {data.retries.map((retry) => (
              <li key={retry.command}>
                <span className="mono">{retry.command}</span> — {retry.attempts} attempts in turn
                {retry.turnIndexes.length > 1 ? "s" : ""} {retry.turnIndexes.join(", ")},{" "}
                {retry.eventuallySucceeded ? "eventually succeeded" : "never succeeded"}
              </li>
            ))}
          </ul>
        )}
      </Blueprint>
    </div>
  );
}
