import type { LogProviderDescriptor } from "@copilot-cost-analyzer/domain";
import type { Mode } from "../state/session-store.js";
import { Blueprint } from "./ui/Blueprint.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";
import { Tag } from "./ui/Tag.js";

const MODE_OPTIONS = [
  { value: "learn", label: "Learn" },
  { value: "analyze", label: "Analyze" },
] as const;

interface AppHeaderProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  hasConfigWarnings: boolean;
  onConfigClick: () => void;
  // Analyze-mode-only log-provider select (architecture.md §4.2). Optional
  // so callers/tests that don't care about provider selection (or render
  // Learn mode) can omit them entirely.
  providers?: LogProviderDescriptor[];
  activeProviderId?: string;
  onProviderChange?: (id: string) => void;
  // Always-visible retention-threshold control (docs/plans/retention-
  // threshold-configurable.md) — unlike the provider select above, this is
  // not mode- or warning-gated. Optional so callers/tests that don't care
  // can omit them entirely.
  minRetainedSessionLogsThreshold?: number;
  onRetentionThresholdChange?: (value: number) => void;
}

export function AppHeader({
  mode,
  onModeChange,
  hasConfigWarnings,
  onConfigClick,
  providers = [],
  activeProviderId,
  onProviderChange,
  minRetainedSessionLogsThreshold,
  onRetentionThresholdChange,
}: AppHeaderProps) {
  return (
    <header className="nav">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginRight: "auto" }}>
        <Blueprint
          style={{ width: 32, height: 32, flex: "none", background: "var(--color-accent-900)" }}
        />
        <div>
          <div className="nav-brand">Session Analyzer</div>
          <div style={{ fontSize: 11, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
            GitHub Copilot Chat
          </div>
        </div>
      </div>
      <SegmentedControl name="mode" options={MODE_OPTIONS} value={mode} onChange={onModeChange} />
      {mode === "analyze" && providers.length > 0 && onProviderChange && (
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", marginLeft: "var(--space-2)" }}>
          <span className="text-muted" style={{ fontSize: 11 }}>
            Source
          </span>
          <select
            aria-label="Log provider"
            className="input"
            value={activeProviderId}
            onChange={(event) => onProviderChange(event.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id} disabled={!provider.available}>
                {provider.label}
                {provider.available ? "" : " (unavailable)"}
              </option>
            ))}
          </select>
        </label>
      )}
      {minRetainedSessionLogsThreshold !== undefined && onRetentionThresholdChange && (
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", marginLeft: "var(--space-2)" }}>
          <span className="text-muted" style={{ fontSize: 11 }}>
            Retention
          </span>
          <input
            aria-label="Retention threshold"
            className="input"
            type="number"
            min={1}
            step={1}
            defaultValue={minRetainedSessionLogsThreshold}
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value > 0) {
                onRetentionThresholdChange(value);
              }
            }}
          />
        </label>
      )}
      {hasConfigWarnings ? (
        <button
          className="btn btn-secondary"
          style={{ marginLeft: "var(--space-2)" }}
          onClick={onConfigClick}
        >
          Config
        </button>
      ) : (
        <Tag variant="neutral" style={{ marginLeft: "var(--space-2)" }}>
          Config &#10003;
        </Tag>
      )}
    </header>
  );
}
