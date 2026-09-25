import type { Turn } from "@copilot-cost-analyzer/domain";
import type { Mode } from "../state/session-store.js";
import { TRIGGER_LABELS } from "../lib/trigger-labels.js";
import { Blueprint } from "./ui/Blueprint.js";
import { Tag } from "./ui/Tag.js";

interface ExplanationPanelProps {
  turn: Turn | null;
  mode: Mode;
  toolCallsAvailable?: boolean;
  // Analyze mode only (both LogProvider implementations, per turn-inspector-
  // plan.md §5.7) — Learn mode sessions have no backing log source to
  // inspect.
  onOpenTurnInspector?: () => void;
}

function ToolCallsThisTurn({
  turn,
  toolCallsAvailable,
  onOpenTurnInspector,
}: {
  turn: Turn;
  toolCallsAvailable: boolean;
  onOpenTurnInspector?: () => void;
}) {
  return (
    <div
      style={{
        marginTop: "var(--space-3)",
        borderTop: "1px solid var(--color-divider)",
        paddingTop: "var(--space-2)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2)",
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
          }}
        >
          Tool calls this turn
        </div>
        {onOpenTurnInspector && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: "2px 8px" }}
            onClick={onOpenTurnInspector}
          >
            Inspect request/response
          </button>
        )}
      </div>
      {!toolCallsAvailable ? (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          Tool-call detail unavailable for this session.
        </p>
      ) : turn.toolCalls.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          No tools called this turn.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {turn.toolCalls.map((toolCall, index) => (
            <div
              key={`${toolCall.name}-${index}`}
              style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
            >
              <Tag variant="neutral" style={{ fontFamily: "monospace" }}>
                {toolCall.name}
              </Tag>
              {(toolCall.filesTouched ?? []).map((file) => (
                <span
                  key={file}
                  title={file}
                  className="text-muted truncate"
                  style={{ maxWidth: 180, display: "inline-block", verticalAlign: "bottom" }}
                >
                  {file}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExplanationPanel({
  turn,
  mode,
  toolCallsAvailable = false,
  onOpenTurnInspector,
}: ExplanationPanelProps) {
  if (!turn) {
    return (
      <Blueprint style={{ padding: "var(--space-3)" }}>
        <p style={{ margin: 0 }}>No turn selected.</p>
      </Blueprint>
    );
  }

  return (
    <Blueprint style={{ padding: "var(--space-3)" }}>
      <div className="card-kicker">Turn {turn.index} · why</div>
      {turn.triggeredEvent && (
        <Tag variant="outline" style={{ marginTop: 6, display: "inline-flex" }}>
          {TRIGGER_LABELS[turn.triggeredEvent]}
        </Tag>
      )}
      <p style={{ fontSize: 14, margin: "8px 0 0" }}>{turn.explanation}</p>
      {mode === "analyze" && (
        <ToolCallsThisTurn
          turn={turn}
          toolCallsAvailable={toolCallsAvailable}
          onOpenTurnInspector={onOpenTurnInspector}
        />
      )}
    </Blueprint>
  );
}
