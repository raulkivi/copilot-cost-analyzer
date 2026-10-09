import { isFailedStatus, type ToolCallOutcome, type ToolCallStatus, type ToolKind } from "@copilot-cost-analyzer/domain";
import { classifyFailure, defaultFailureRules, type FailureRule } from "./failure-classifier.js";

export interface RawToolOutcome {
  kind: ToolKind;
  status: ToolCallStatus;
  exitCode?: number;
  // The tool's own result/error text — only used to classify, never
  // returned whole (the evidence excerpt is redacted and bounded).
  text: string;
  reason?: string;
}

// Shared by every provider: the provider decides the status from its own
// source's structured signals; this turns that into the domain outcome,
// classifying only calls the source marked as failed.
export function buildToolCallOutcome(raw: RawToolOutcome, rules: FailureRule[] = defaultFailureRules): ToolCallOutcome {
  if (raw.status === "unknown") {
    return { status: "unknown", reason: raw.reason ?? "The source did not record an outcome for this call." };
  }
  const exitCode = raw.exitCode !== undefined ? { exitCode: raw.exitCode } : {};
  if (!isFailedStatus(raw.status)) {
    return { status: raw.status, ...exitCode };
  }
  const classification = classifyFailure({ kind: raw.kind, exitCode: raw.exitCode, text: raw.text }, rules);
  return {
    status: raw.status,
    ...exitCode,
    failureCategory: classification.failureCategory,
    classificationEvidence: classification.evidence,
  };
}
