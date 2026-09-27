interface StatTileProps {
  label: string;
  value: string;
  note?: string;
  // Only for a value that is bad news (e.g. a non-zero failure rate).
  alert?: boolean;
}

export function StatTile({ label, value, note, alert = false }: StatTileProps) {
  return (
    <div className="stat-tile" role="group" aria-label={label}>
      <span className="stat-tile-label">{label}</span>
      <span className={alert ? "stat-tile-value stat-tile-value--alert" : "stat-tile-value"}>{value}</span>
      {note && <span className="stat-tile-note">{note}</span>}
    </div>
  );
}
