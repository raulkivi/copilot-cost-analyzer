import type { SystemPromptComponent, TokenCount } from "@copilot-cost-analyzer/domain";
import { Blueprint } from "./ui/Blueprint.js";

const ESTIMATED_TOOLTIP =
  "Estimate from a local tokenizer (o200k_base) run over the real captured text — " +
  "not the exact count the model provider actually billed.";

function formatTokenCount(tokenCount: TokenCount): string {
  if (!tokenCount.known) return "—";
  const formatted = tokenCount.value.toLocaleString();
  return tokenCount.estimated ? `~${formatted}` : formatted;
}

function barWidthPercent(tokenCount: TokenCount, maxValue: number): number {
  if (!tokenCount.known || maxValue === 0) return 0;
  return (tokenCount.value / maxValue) * 100;
}

interface SystemPromptBreakdownProps {
  components: SystemPromptComponent[];
  providerId?: string;
  onOpenInspector?: () => void;
}

export function SystemPromptBreakdown({ components, providerId, onOpenInspector }: SystemPromptBreakdownProps) {
  const maxValue = Math.max(
    0,
    ...components.map((component) => (component.tokenCount.known ? component.tokenCount.value : 0)),
  );
  const hasBuiltIn = components.some((component) => component.kind === "built-in");

  return (
    <Blueprint style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <div className="card-kicker">System prompt breakdown</div>
        {onOpenInspector && (hasBuiltIn || providerId === "pi-agent") && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: "2px 8px" }}
            onClick={onOpenInspector}
          >
            Open system prompt inspector
          </button>
        )}
      </div>
      {components.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {providerId === "pi-agent"
            ? "No system prompt captured for this session yet — open the system prompt inspector for how to enable it."
            : providerId && providerId !== "vscode"
              ? "This provider does not capture a system-prompt artifact, so no breakdown is available."
              : "No prompt artifacts captured for this session — enable agentDebugLog.fileLogging.enabled and reload VS Code."}
        </p>
      ) : (
        components.map((component) => (
          <div key={`${component.kind}-${component.label}`}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
              <span>{component.label}</span>
              <span
                className="text-muted"
                title={
                  component.tokenCount.known && component.tokenCount.estimated ? ESTIMATED_TOOLTIP : undefined
                }
              >
                {formatTokenCount(component.tokenCount)}
              </span>
            </div>
            <div style={{ height: 5, background: "var(--color-surface)", border: "1px solid var(--color-divider)" }}>
              <div
                data-testid={`prompt-bar-fill-${component.label}`}
                style={{
                  height: "100%",
                  background: "var(--color-accent)",
                  width: `${barWidthPercent(component.tokenCount, maxValue)}%`,
                }}
              />
            </div>
          </div>
        ))
      )}
    </Blueprint>
  );
}
