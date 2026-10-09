import { z } from "zod";

// Phase 9.10 tool-call audit (docs/plans/tool-call-audit.md §4). "unknown"
// is a first-class status rather than an absent field so a provider whose
// source records no outcome says so explicitly (constraint 6) instead of
// being counted as a success.
export const toolCallStatusSchema = z.enum(["success", "error", "interrupted", "denied", "unknown"]);

export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

export const failureCategorySchema = z.enum([
  "command-not-found",
  "wrong-directory",
  "invalid-arguments",
  "tool-input-invalid",
  "file-not-found",
  "permission-denied",
  "timeout",
  "network",
  "dependency-missing",
  "git-state",
  "test-or-build-failure",
  "user-rejected",
  "blocked-by-policy", // harness permission rule / safety check, not the user
  "other-nonzero-exit",
  "unclassified",
]);

export type FailureCategory = z.infer<typeof failureCategorySchema>;

export const MAX_EVIDENCE_EXCERPT_LENGTH = 200;

export const classificationEvidenceSchema = z.object({
  ruleId: z.string(),
  // Redacted and truncated server-side before it ever reaches this shape.
  excerpt: z.string().max(MAX_EVIDENCE_EXCERPT_LENGTH),
});

export type ClassificationEvidence = z.infer<typeof classificationEvidenceSchema>;

export const toolCallOutcomeSchema = z
  .object({
    status: toolCallStatusSchema,
    reason: z.string().optional(),
    exitCode: z.number().int().optional(),
    failureCategory: failureCategorySchema.optional(),
    classificationEvidence: classificationEvidenceSchema.optional(),
  })
  .superRefine((outcome, ctx) => {
    if (outcome.status === "unknown" && !outcome.reason) {
      ctx.addIssue({ code: "custom", message: "An unknown outcome must carry a reason.", path: ["reason"] });
    }
    if ((outcome.status === "success" || outcome.status === "unknown") && outcome.failureCategory) {
      ctx.addIssue({
        code: "custom",
        message: "Only a failed, interrupted or denied call can carry a failure category.",
        path: ["failureCategory"],
      });
    }
  });

export type ToolCallOutcome = z.infer<typeof toolCallOutcomeSchema>;

export function isFailedStatus(status: ToolCallStatus): boolean {
  return status === "error" || status === "interrupted" || status === "denied";
}
