import { useState } from "react";
import { scaleLinear } from "d3-scale";
import type { ToolCallStatus } from "@copilot-cost-analyzer/domain";
import { STATUS_META, STATUS_ORDER } from "../lib/audit-format.js";
import { activateOnEnterOrSpace, ChartLegend, roundedTopRectPath } from "./chart-parts.js";

export interface StackedColumn {
  key: string;
  label: string;
  counts: Record<ToolCallStatus, number>;
}

interface StackedColumnsProps {
  ariaLabel: string;
  columns: StackedColumn[];
  // Names what one column is ("Turn", "Day") for labels and the tooltip.
  axisLabel: string;
  selectedKey?: string;
  onSelect?: (key: string) => void;
  emptyText?: string;
}

const HEIGHT = 170;
const MARGIN = { top: 10, right: 8, bottom: 24, left: 34 };
const STEP = 28; // px per column; bars stay ≤ 20px so the band's leftover is air
const MAX_BAR = 20;
const GAP = 2; // surface gap between stacked segments
const MAX_X_LABELS = 24;

function summary(column: StackedColumn, axisLabel: string): string {
  const parts = STATUS_ORDER.filter((status) => column.counts[status] > 0).map(
    (status) => `${column.counts[status]} ${STATUS_META[status].label.toLowerCase()}`,
  );
  return `${axisLabel} ${column.label}: ${parts.length > 0 ? parts.join(", ") : "no tool calls"}`;
}

function totalOf(column: StackedColumn): number {
  return STATUS_ORDER.reduce((sum, status) => sum + column.counts[status], 0);
}

// Per-turn (or per-day) tool-call outcomes as stacked columns: one shared
// count axis, status-coloured segments separated by a 2px surface gap,
// hover/focus tooltip, click/Enter to select, and a table view carrying the
// same numbers for anyone who can't use the chart.
export function StackedColumns({ ariaLabel, columns, axisLabel, selectedKey, onSelect, emptyText }: StackedColumnsProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  if (columns.length === 0) {
    return <p className="text-muted chart-empty">{emptyText ?? "No data."}</p>;
  }

  const presentStatuses = STATUS_ORDER.filter((status) => columns.some((column) => column.counts[status] > 0));
  const maxTotal = Math.max(1, ...columns.map(totalOf));
  const width = Math.max(320, MARGIN.left + columns.length * STEP + MARGIN.right);
  const plotBottom = HEIGHT - MARGIN.bottom;
  const y = scaleLinear().domain([0, maxTotal]).nice().range([plotBottom, MARGIN.top]);
  const ticks = y.ticks(4).filter(Number.isInteger);
  const barWidth = Math.min(MAX_BAR, STEP - 8);
  const labelEvery = Math.ceil(columns.length / MAX_X_LABELS);
  const hovered = columns.find((column) => column.key === hoveredKey) ?? null;
  const hoveredIndex = hovered ? columns.indexOf(hovered) : -1;

  return (
    <div className="chart">
      <div className="chart-toolbar">
        <ChartLegend
          items={presentStatuses.map((status) => ({ id: status, ...STATUS_META[status] }))}
        />
        <button type="button" className="btn btn-ghost chart-table-toggle" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {showTable ? (
        <div className="chart-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{axisLabel}</th>
                {STATUS_ORDER.map((status) => (
                  <th key={status}>{STATUS_META[status].label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.key}>
                  <td>{column.label}</td>
                  {STATUS_ORDER.map((status) => (
                    <td key={status}>{column.counts[status]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-scroll">
          <div style={{ position: "relative", width }}>
            <svg role="group" aria-label={ariaLabel} width={width} height={HEIGHT} className="chart-svg">
              {ticks.map((tick) => (
                <g key={tick}>
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} className="chart-grid" />
                  <text x={MARGIN.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="chart-axis-text">
                    {tick}
                  </text>
                </g>
              ))}
              {columns.map((column, index) => {
                const bandX = MARGIN.left + index * STEP;
                const barX = bandX + (STEP - barWidth) / 2;
                const statuses = STATUS_ORDER.filter((status) => column.counts[status] > 0);
                let cursor = 0;
                const selected = column.key === selectedKey;
                const select = () => onSelect?.(column.key);
                return (
                  <g
                    key={column.key}
                    data-column={column.key}
                    role="button"
                    tabIndex={0}
                    aria-label={summary(column, axisLabel)}
                    aria-pressed={selected}
                    className="chart-column"
                    onClick={select}
                    onKeyDown={activateOnEnterOrSpace(select)}
                    onMouseEnter={() => setHoveredKey(column.key)}
                    onMouseLeave={() => setHoveredKey(null)}
                    onFocus={() => setHoveredKey(column.key)}
                    onBlur={() => setHoveredKey(null)}
                  >
                    <rect
                      x={bandX + 1}
                      y={MARGIN.top}
                      width={STEP - 2}
                      height={plotBottom - MARGIN.top}
                      className={selected ? "chart-band chart-band--selected" : "chart-band"}
                    />
                    {statuses.map((status, segmentIndex) => {
                      const count = column.counts[status];
                      const yTop = y(cursor + count);
                      const yBottom = y(cursor);
                      cursor += count;
                      const isTop = segmentIndex === statuses.length - 1;
                      const height = Math.max(1, yBottom - yTop - (segmentIndex > 0 ? GAP : 0));
                      return (
                        <path
                          key={status}
                          data-status={status}
                          d={roundedTopRectPath(barX, yTop, barWidth, height, isTop ? 4 : 0)}
                          fill={STATUS_META[status].color}
                        />
                      );
                    })}
                    {index % labelEvery === 0 && (
                      <text x={bandX + STEP / 2} y={plotBottom + 15} textAnchor="middle" className="chart-axis-text">
                        {column.label}
                      </text>
                    )}
                  </g>
                );
              })}
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={plotBottom} y2={plotBottom} className="chart-baseline" />
            </svg>
            {hovered && (
              <div
                role="tooltip"
                className="chart-tooltip"
                style={{
                  left: Math.min(MARGIN.left + hoveredIndex * STEP + STEP, width - 150),
                  top: MARGIN.top,
                }}
              >
                <div className="chart-tooltip-title">
                  {axisLabel} {hovered.label}
                </div>
                {STATUS_ORDER.filter((status) => hovered.counts[status] > 0).map((status) => (
                  <div key={status} className="chart-tooltip-row">
                    <span className="chart-legend-swatch" style={{ background: STATUS_META[status].color }} aria-hidden="true" />
                    <span>{STATUS_META[status].label}</span>
                    <strong>{hovered.counts[status]}</strong>
                  </div>
                ))}
                {totalOf(hovered) === 0 && <div className="text-muted">No tool calls</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
