import type { FailureCategory, ToolCallStatus } from "@copilot-cost-analyzer/domain";

// Outcome is a *state*, so it gets a status encoding rather than a
// categorical one. Success deliberately wears the app's own steel-blue
// accent instead of a green: successes are the expected, quiet majority,
// failures are what should draw the eye — and blue-vs-red stays separable
// for red-green colour-vision deficiency (validated with the dataviz
// validator against --color-bg #f2f2f3, all pairs: CVD ΔE ≥ 16, normal-
// vision ΔE ≥ 16.5). Amber/grey sit below 3:1 contrast, so every use pairs
// the colour with an icon + text label, a legend and a table view.
export const STATUS_ORDER: ToolCallStatus[] = ["success", "error", "interrupted", "denied", "unknown"];

export const STATUS_META: Record<ToolCallStatus, { label: string; icon: string; color: string }> = {
  success: { label: "Succeeded", icon: "✓", color: "#597ea3" },
  error: { label: "Failed", icon: "✕", color: "#d03b3b" },
  interrupted: { label: "Interrupted", icon: "⏸", color: "#eba524" },
  denied: { label: "Denied", icon: "⛔", color: "#3d2f5c" },
  unknown: { label: "Unknown", icon: "?", color: "#c4c4c7" },
};

export const CATEGORY_LABELS: Record<FailureCategory, string> = {
  "command-not-found": "Command not found",
  "wrong-directory": "Wrong directory",
  "invalid-arguments": "Invalid arguments",
  "tool-input-invalid": "Invalid tool input",
  "file-not-found": "File not found",
  "permission-denied": "Permission denied",
  timeout: "Timeout",
  network: "Network",
  "dependency-missing": "Missing dependency",
  "git-state": "Git state",
  "test-or-build-failure": "Test/build failure",
  "user-rejected": "Rejected by user",
  "blocked-by-policy": "Blocked by permissions",
  "other-nonzero-exit": "Other non-zero exit",
  unclassified: "Unclassified",
};

export function formatFailureRate(rate: number | null): string {
  if (rate === null) {
    return "—";
  }
  const percent = rate * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return value.toLocaleString("en-US");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function failedCountOf(counts: { failed: number; interrupted: number; denied: number }): number {
  return counts.failed + counts.interrupted + counts.denied;
}
