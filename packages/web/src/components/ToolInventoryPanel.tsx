import type { ToolInventoryEntry } from "@copilot-cost-analyzer/domain";
import { Blueprint } from "./ui/Blueprint.js";

interface ToolInventoryPanelProps {
  entries: ToolInventoryEntry[];
}

export function ToolInventoryPanel({ entries }: ToolInventoryPanelProps) {
  return (
    <Blueprint style={{ padding: "var(--space-3)" }}>
      <div className="card-kicker" style={{ marginBottom: "var(--space-3)" }}>
        Tools: loaded vs. used
      </div>
      {entries.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          No tool inventory captured for this session.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {entries.map((entry) => (
            <div key={entry.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span
                title={entry.name}
                className="truncate"
                style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
              >
                {entry.name}
              </span>
              <span
                role="img"
                aria-label={entry.loaded ? "Loaded" : "Not loaded"}
                title={entry.loaded ? "Loaded" : "Not loaded"}
                className={`tool-status-dot${entry.loaded ? " tool-status-dot--loaded" : ""}`}
              />
              <span
                title={
                  entry.invokedInTurns.length > 0
                    ? `Used in ${entry.invokedInTurns.length} turn${entry.invokedInTurns.length === 1 ? "" : "s"}`
                    : "Not invoked"
                }
                className="tool-usage-count"
              >
                {entry.invokedInTurns.length > 0 ? entry.invokedInTurns.length : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </Blueprint>
  );
}
