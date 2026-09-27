import type { KeyboardEvent } from "react";

// Shared chart chrome: legend (identity never by colour alone — swatch +
// icon + text label) and the rounded-data-end bar path from the dataviz
// mark spec (4px rounded end, square at the baseline).

export interface LegendItem {
  id: string;
  label: string;
  color: string;
  icon?: string;
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="chart-legend" aria-label="Legend">
      {items.map((item) => (
        <li key={item.id}>
          <span className="chart-legend-swatch" style={{ background: item.color }} aria-hidden="true" />
          {item.icon && <span aria-hidden="true">{item.icon}</span>}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// Rect with only its top corners rounded (a column's data end).
export function roundedTopRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height}`,
    "Z",
  ].join(" ");
}

export function activateOnEnterOrSpace(action: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  };
}
