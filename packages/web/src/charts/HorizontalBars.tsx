import { activateOnEnterOrSpace, ChartLegend, type LegendItem } from "./chart-parts.js";

export interface BarRow {
  key: string;
  label: string;
  values: Record<string, number>;
}

interface HorizontalBarsProps {
  ariaLabel: string;
  series: LegendItem[];
  rows: BarRow[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
  emptyText?: string;
}

// Ranked horizontal bars (magnitude by category): one shared scale, value
// at the bar tip, segments separated by a 2px surface gap. HTML rather than
// SVG so long labels truncate with a native title instead of colliding.
export function HorizontalBars({ ariaLabel, series, rows, selectedKey, onSelect, emptyText }: HorizontalBarsProps) {
  const totals = rows.map((row) => series.reduce((sum, s) => sum + (row.values[s.id] ?? 0), 0));
  const max = Math.max(1, ...totals);

  return (
    <div className="chart" role="group" aria-label={ariaLabel}>
      {series.length > 1 && (
        <div className="chart-toolbar">
          <ChartLegend items={series} />
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-muted chart-empty">{emptyText ?? "No data."}</p>
      ) : (
        <div className="hbars">
          {rows.map((row, index) => {
            const selected = row.key === selectedKey;
            const select = () => onSelect?.(row.key);
            const label = `${row.label}: ${series.map((s) => `${row.values[s.id] ?? 0} ${s.label}`).join(", ")}`;
            return (
              <div
                key={row.key}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={selected}
                title={label}
                className={selected ? "hbar-row hbar-row--selected" : "hbar-row"}
                onClick={select}
                onKeyDown={activateOnEnterOrSpace(select)}
              >
                <span className="hbar-label truncate">{row.label}</span>
                <span className="hbar-track">
                  {series.map((s) => {
                    const value = row.values[s.id] ?? 0;
                    return value > 0 ? (
                      <span
                        key={s.id}
                        data-segment={s.id}
                        className="hbar-segment"
                        style={{ width: `${(value / max) * 100}%`, background: s.color }}
                      />
                    ) : null;
                  })}
                  <span className="hbar-value">{totals[index]}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
