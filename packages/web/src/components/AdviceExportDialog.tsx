import { useEffect, useState } from "react";
import type { Session } from "@copilot-cost-analyzer/domain";
import { buildAdviceBundle } from "../lib/build-advice-bundle.js";

interface AdviceExportDialogProps {
  sessions: Session[];
  open: boolean;
  onClose: () => void;
}

export function AdviceExportDialog({ sessions, open, onClose }: AdviceExportDialogProps) {
  const [includeToolArgs, setIncludeToolArgs] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [sessions, includeToolArgs]);

  if (!open) {
    return null;
  }

  const bundle = buildAdviceBundle(sessions, { includeToolArgs });
  const missingDetailCount = sessions.filter(
    (candidate) => candidate.turnCount > 0 && candidate.turns.length === 0,
  ).length;

  function handleCopy(): void {
    navigator.clipboard
      .writeText(bundle)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  }

  return (
    <div
      className="dialog-backdrop"
      data-testid="advice-dialog-backdrop"
      onClick={onClose}
    >
      <div className="dialog" style={{ maxWidth: 560 }} onClick={(event) => event.stopPropagation()}>
        <div className="dialog-title">Export advice bundle</div>
        <div className="dialog-body">
          <p className="text-muted" style={{ fontSize: 12, margin: "0 0 var(--space-2)" }}>
            Paste this into an LLM chat for advice on your agentic-coding workflow. Chat message text is never
            included — only session/turn metadata (token usage, cache efficiency, tool usage, prompt composition,
            AI Credits).
          </p>
          <div className="card-kicker" style={{ marginBottom: 6 }}>
            {sessions.length} session{sessions.length === 1 ? "" : "s"} selected for advice
          </div>
          {missingDetailCount > 0 && (
            <p style={{ fontSize: 12, margin: "0 0 var(--space-2)", color: "var(--color-accent-800)" }}>
              {missingDetailCount} selected session{missingDetailCount === 1 ? " hasn't" : "s haven't"} been opened
              yet — open {missingDetailCount === 1 ? "it" : "each"} in the list first to include its turn-level
              detail (tokens, cache, tool usage).
            </p>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: "var(--space-2)" }}>
            <input
              type="checkbox"
              aria-label="Include tool call args"
              checked={includeToolArgs}
              onChange={(event) => setIncludeToolArgs(event.target.checked)}
            />
            Include tool call args (may contain text snippets)
          </label>
          {previewOpen && (
            <pre
              data-testid="advice-preview"
              style={{
                maxHeight: 220,
                overflow: "auto",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                background: "var(--color-surface)",
                border: "1px solid var(--color-divider)",
                padding: "var(--space-2)",
                margin: 0,
              }}
            >
              {bundle}
            </pre>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setPreviewOpen((next) => !next)}>
            {previewOpen ? "Hide preview" : "Preview"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy advice prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}
