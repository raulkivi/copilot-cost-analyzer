import { useState } from "react";
import type { Session } from "@copilot-cost-analyzer/domain";
import type { Mode } from "../state/session-store.js";
import { formatAiCredits } from "../lib/format-ai-credits.js";
import { formatRelativeTime } from "../lib/format-relative-time.js";
import { onKeyActivate } from "../lib/on-key-activate.js";
import { Blueprint } from "./ui/Blueprint.js";

interface SessionListProps {
  mode: Mode;
  sessions: Session[];
  selectedSessionId: string | null;
  onSelect: (session: Session) => void;
  adviceSelection?: Set<string>;
  onToggleAdvice?: (session: Session) => void;
}

function kicker(mode: Mode, session: Session): string {
  if (mode === "learn") {
    return session.category ? `Learn · ${session.category}` : "Learn";
  }
  return session.startedAt ? `Analyze · ${formatRelativeTime(session.startedAt)}` : "Analyze";
}

export function SessionList({
  mode,
  sessions,
  selectedSessionId,
  onSelect,
  adviceSelection,
  onToggleAdvice,
}: SessionListProps) {
  const [query, setQuery] = useState("");
  const filtered = sessions.filter((session) =>
    session.title.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div>
      <h6 style={{ margin: "0 0 var(--space-2) var(--space-1)" }}>
        {mode === "learn" ? "Scenarios" : "Sessions"}
      </h6>
      <div className="field" style={{ marginBottom: "var(--space-2)" }}>
        <input
          className="input"
          style={{ fontSize: 13 }}
          placeholder="Search…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          maxHeight: 520,
          overflowY: "auto",
          paddingRight: 2,
        }}
      >
        {filtered.map((session) => (
          <Blueprint
            key={session.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(session)}
            onKeyDown={onKeyActivate(() => onSelect(session))}
            aria-label={session.title}
            style={{
              cursor: "pointer",
              position: "relative",
              background: session.id === selectedSessionId ? "var(--color-accent-100)" : undefined,
            }}
          >
            {onToggleAdvice && (
              <label
                title="Select for advice export"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                style={{ position: "absolute", top: 6, right: 6, lineHeight: 0 }}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${session.title} for advice`}
                  checked={adviceSelection?.has(session.id) ?? false}
                  onChange={() => onToggleAdvice(session)}
                />
              </label>
            )}
            <div
              style={{
                padding: "var(--space-3)",
                paddingRight: onToggleAdvice ? 26 : undefined,
                display: "flex",
                gap: "var(--space-2)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="card-kicker">{kicker(mode, session)}</div>
                <div className="card-title truncate" style={{ fontSize: 15, marginTop: 2 }}>
                  {session.title}
                </div>
                <div className="card-meta" style={{ marginTop: 6 }}>
                  {session.turnCount} {session.turnCount === 1 ? "turn" : "turns"}
                  {session.costAiCredits.known && (
                    <> · {formatAiCredits(session.costAiCredits)} AI Credits</>
                  )}
                </div>
              </div>
            </div>
          </Blueprint>
        ))}
        {filtered.length === 0 && (
          <p className="text-muted" style={{ fontSize: 12 }}>
            No matches.
          </p>
        )}
      </div>
    </div>
  );
}
