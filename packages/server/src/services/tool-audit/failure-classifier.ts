import { MAX_EVIDENCE_EXCERPT_LENGTH, type FailureCategory, type ToolKind } from "@copilot-cost-analyzer/domain";
import { excerptOf } from "./output-redactor.js";

// Rule-based failure classification (docs/plans/tool-call-audit.md §6).
// Only ever called for a call the source itself marked as failed — this
// decides *why*, never *whether*. Ordered strategies, first match wins;
// nothing matches → "unclassified" (constraint 6: never guessed). Each
// result carries the rule id plus the matched line so a user can see why a
// call got its label.

export interface FailureInput {
  kind: ToolKind;
  exitCode?: number;
  text: string;
}

export interface FailureRule {
  id: string;
  category: FailureCategory;
  // Returns the evidence line when the rule applies, else null.
  match(input: FailureInput): string | null;
}

export interface FailureClassification {
  failureCategory: FailureCategory;
  evidence: { ruleId: string; excerpt: string };
}

function firstMatchingLine(text: string, pattern: RegExp): string | null {
  const lines = text.split(/\r?\n/);
  const line = lines.find((candidate) => pattern.test(candidate));
  if (line !== undefined) {
    return line;
  }
  // Multi-line patterns (e.g. Node's loader stack) — fall back to the
  // first non-empty line when the whole text matches.
  return pattern.test(text) ? (lines.find((l) => l.trim()) ?? text) : null;
}

function textRule(category: FailureCategory, pattern: RegExp, kinds?: ToolKind[]): FailureRule {
  return {
    id: `text.${category}`,
    category,
    match: (input) => (kinds && !kinds.includes(input.kind) ? null : firstMatchingLine(input.text, pattern)),
  };
}

function exitCodeRule(code: number, category: FailureCategory): FailureRule {
  return {
    id: `shell.exit-${code}`,
    category,
    match: (input) =>
      input.kind === "shell" && input.exitCode === code ? (input.text.split(/\r?\n/).find((l) => l.trim()) ?? `exit ${code}`) : null,
  };
}

export const defaultFailureRules: FailureRule[] = [
  textRule(
    "user-rejected",
    /user doesn't want to proceed|tool use was rejected|permission to use \S+ (?:with .* )?has been denied|user (?:denied|rejected)/i,
  ),
  textRule("tool-input-invalid", /InputValidationError|<tool_use_error>.*(?:parameter|invalid)|invalid tool (?:input|parameters)/i),
  textRule(
    "network",
    /Could not resolve host|Connection refused|getaddrinfo|Network is unreachable|Failed to connect|Temporary failure in name resolution|SSL certificate problem/i,
  ),
  // Node/libc error codes are matched case-sensitively as whole words — a
  // case-insensitive "ENOTFOUND" also matches inside "ModuleNotFoundError".
  { ...textRule("network", /\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH)\b/), id: "text.network-code" },
  textRule("timeout", /Command timed out|timed out after|\bETIMEDOUT\b|deadline exceeded/i),
  exitCodeRule(124, "timeout"),
  textRule(
    "command-not-found",
    /command not found|is not recognized as (?:an internal or external command|the name of a cmdlet)|spawn \S+ ENOENT|: not found$|No such file or directory.*\bexec\b/im,
  ),
  exitCodeRule(127, "command-not-found"),
  textRule(
    "wrong-directory",
    /\bcd: .*(?:No such file or directory|not a directory)|can't cd to|cannot change to '.*'|Could not read package\.json|no such file or directory, open '[^']*(?:package\.json|tsconfig\.json)'|could not find `Cargo\.toml`|go\.mod file not found|no pyproject\.toml|The system cannot find the path specified/i,
  ),
  textRule(
    "dependency-missing",
    /No module named|ModuleNotFoundError|Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|node:internal\/modules\/cjs\/loader|cannot open shared object file|Could not find a (?:package|version)|is not installed|LoadError: cannot load such file/i,
  ),
  textRule(
    "git-state",
    /not a git repository|CONFLICT \(|merge conflict|detached HEAD|non-fast-forward|Updates were rejected|would be overwritten by (?:merge|checkout)|refusing to merge unrelated histories|You have unstaged changes/i,
  ),
  textRule("permission-denied", /Permission denied|Operation not permitted|Access is denied/i),
  { ...textRule("permission-denied", /\b(?:EACCES|EPERM)\b/), id: "text.permission-denied-code" },
  exitCodeRule(126, "permission-denied"),
  textRule(
    "file-not-found",
    /File does not exist|No such file or directory|\bENOENT\b|cannot find the file specified|does not exist/,
  ),
  textRule(
    "invalid-arguments",
    /unrecognized option|unknown option|invalid option|illegal option|unrecognized arguments?|unknown (?:flag|shorthand flag|command|argument|subcommand)|unexpected argument|missing (?:required )?(?:argument|operand)|requires an argument|arguments are required|too many arguments|^\s*usage:|Try '.*--help'/im,
  ),
  exitCodeRule(2, "invalid-arguments"),
  textRule(
    "test-or-build-failure",
    /\b\d+ (?:failed|failing)\b|Tests?:\s+\d+ failed|\bFAIL\b|error TS\d+|BUILD FAILED|compilation failed|AssertionError|npm ERR! Test failed|ELIFECYCLE|error\[E\d+\]/,
  ),
  {
    id: "shell.nonzero-exit",
    category: "other-nonzero-exit",
    match: (input) =>
      input.exitCode !== undefined && input.exitCode !== 0
        ? (input.text.split(/\r?\n/).find((l) => l.trim()) ?? `exit ${input.exitCode}`)
        : null,
  },
];

export function classifyFailure(
  input: FailureInput,
  rules: FailureRule[] = defaultFailureRules,
): FailureClassification {
  for (const rule of rules) {
    const evidenceLine = rule.match(input);
    if (evidenceLine !== null) {
      return {
        failureCategory: rule.category,
        evidence: { ruleId: rule.id, excerpt: excerptOf(evidenceLine, MAX_EVIDENCE_EXCERPT_LENGTH) },
      };
    }
  }
  const firstLine = input.text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return {
    failureCategory: "unclassified",
    evidence: { ruleId: "unclassified", excerpt: excerptOf(firstLine, MAX_EVIDENCE_EXCERPT_LENGTH) },
  };
}
