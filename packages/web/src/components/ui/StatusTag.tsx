import type { ToolCallOutcome } from "@copilot-cost-analyzer/domain";
import { CATEGORY_LABELS, STATUS_META } from "../../lib/audit-format.js";

interface StatusTagProps {
  outcome?: ToolCallOutcome;
}

// Icon + text + colour swatch: status is never conveyed by colour alone.
export function StatusTag({ outcome }: StatusTagProps) {
  const status = outcome?.status ?? "unknown";
  const meta = STATUS_META[status];
  const category = outcome?.failureCategory ? CATEGORY_LABELS[outcome.failureCategory] : undefined;
  const title =
    outcome?.status === "unknown"
      ? (outcome.reason ?? meta.label)
      : [meta.label, category, outcome?.exitCode !== undefined ? `exit ${outcome.exitCode}` : undefined]
          .filter(Boolean)
          .join(" · ");

  return (
    <span className="status-tag" title={title}>
      <span className="status-tag-dot" style={{ background: meta.color }} aria-hidden="true" />
      <span aria-hidden="true">{meta.icon}</span>
      <span>{category ? `${meta.label} · ${category}` : meta.label}</span>
    </span>
  );
}
