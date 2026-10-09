# Tool-call audit: outcomes, failure classification, and per-session audit reports

Status: **complete (Phase 9.10)** — see §12 for what shipped and known
limitations. Originally: The user's decisions on the
open questions are recorded in §9. The user also asked for an **MCP
interface** (§10) and **strong UX with data visualization** (§11).

## 1. Context

Analyze mode today answers *"what did this session cost?"* It can't yet
answer the audit question: *"what did the agent actually do, and how much of
it failed?"* For example:

- How many Bash/terminal commands ran in this session, and which ones?
- How many failed, and why: the executable wasn't installed (`command not
  found`), the working directory was wrong (`No such file or directory`, `not
  a git repository`), the arguments were wrong (`unknown option`, usage
  text, exit code 2), permission was denied, the command timed out, or the
  user rejected it?
- How many tokens and how much time went into recovering from those
  failures (retries, re-reads, extra rounds)?

This document covers two things. §2–§3 review the current code from this
angle. §4–§8 propose an incremental, TDD-first design that fits the
existing architecture: provider-extensible, constraint 6 "explicit
unavailable, never fabricated", and SOLID.

## 2. Review summary: what already works well

- **Provider-neutral domain model** (`packages/domain`). Adding audit fields
  to `ToolCallRecord` flows through every provider and the UI without API
  churn (constraint 12).
- **Explicit-unavailable discipline** (`TokenCount.known/reason`). The same
  pattern fits "outcome unknown for this provider" directly.
- **Pairing of `tool_use` and `tool_result` already exists** for the
  inspector: `claude-code/turn-inspector-builder.ts` (`findToolResultFor`,
  `resultContentOf`) and `pi-agent/pi-message.ts` (`findToolCallBlock`).
  The audit extractor can reuse this logic instead of reinventing it.
- **Defensive parsing and bounded memory** (`main-jsonl-reader.ts`'s
  `createAttrsProjector` allow-list). New audit fields should be added to
  the allow-lists explicitly, not by widening to the whole payload.
- **Strong test culture**: co-located `*.test.ts` and realistic fixtures
  under `packages/server/fixtures/`.

## 3. Findings: gaps for audit (and a few general ones)

| # | Severity | Where | Finding |
|---|---|---|---|
| F1 | High (audit) | `packages/domain/src/tool-call-record.ts` | `ToolCallRecord` is `{ name, argsSummary, filesTouched?, tokenCount? }`. It has **no call id, no outcome/status, no error text, no exit code, no duration, no timestamp**. No provider can report "failed" even when the source log says so. |
| F2 | High (audit correctness) | `services/session-enricher/session-enricher.ts:121-128` (`buildToolCalls`) | VS Code tool calls are **deduplicated by name** (`new Set(invokedToolNames)`), and file-based calls are grouped per tool name. Two `run_in_terminal` calls in one turn show up as one. That is fine for a tool *inventory*, but wrong for a call *count*. The real fixture `jsonl/real-session-with-usage.jsonl` already has two `manage_todo_list` calls in one turn. |
| F3 | High (audit) | `claude-code/usage-extractor.ts` `extractToolCalls` | Reads only `tool_use` blocks. The paired `tool_result.is_error` flag and the `toolUseResult` sibling (`stdout`/`stderr`/`interrupted` for Bash) are ignored, although the same file tree already locates them for the inspector. |
| F4 | High (audit) | `pi-agent/usage-extractor.ts` `extractToolCalls` | Iterates `ToolResultMessage`s but drops `isError`. The field exists in pi's schema, and this repo's own tests already construct it (`usage-extractor.test.ts:27`). `PiToolResultMessage` in `pi-message.ts` doesn't declare it. |
| F5 | Medium (audit) | `jsonl/tool-inventory.ts` `extractInvokedToolNamesByTurn` | Keeps only `envelope.name`. The envelope's own `status` and `dur` (already parsed by `main-jsonl-reader.ts`) are discarded, so VS Code tool-call success/failure and latency are lost even though they're on disk. Only `status: "ok"` has been observed so far; the error value is unconfirmed (§5). |
| F6 | Medium (audit) | `mitmproxy/decoders/{anthropic,openai}.ts` | Every decoder returns `toolCalls: []`. HAR request bodies carry the full message history, including `tool_use`/`tool_result` (with `is_error` for Anthropic) and OpenAI `tool_calls`/`role:"tool"` messages. |
| F7 | Medium (perf/privacy) | `claude-code/usage-extractor.ts:117`, `pi-agent/usage-extractor.ts:80` | `argsSummary` is the *entire* `JSON.stringify(input)`. For `Write`/`Edit` that is the full file content, and it is sent for every turn in `GET /api/sessions/:id`. It should be a bounded summary (for example, the command string or path, truncated), with the full payload left to the on-demand inspector endpoint (the Phase 9.5 design intent). |
| F8 | Low (general) | `claude-code-log-provider.ts` `listSessions` | Fully parses and builds every session file (turns, usage, tool calls) just to return summaries with `turns: []`. With hundreds of sessions this is O(total log size) per list call. Consider a lightweight summary path or an mtime-keyed cache. The same applies to `readTurnDetail` re-reading the file. |
| F9 | Low (scope/docs) | `docs/vision.md` §6 | Non-goals say "not activity reporting". An audit view is a deliberate scope extension and needs a vision/architecture update in the same change (per CLAUDE.md "update the relevant doc rather than drift"). |
| F10 | Low (privacy) | `web/src/lib/build-advice-bundle.ts` | The advice export promises "never chat message text". Any new stderr/stdout snippet must stay out of that bundle. Only categories and counts may be exported. |

## 4. Proposed domain changes (`packages/domain`)

Additive and optional, so Learn fixtures and current providers stay valid
(constraint 4). Each new field is either known or carries an explicit reason
(constraint 6).

```ts
// tool-call-outcome.ts (new)
export const toolCallStatusSchema = z.enum([
  "success",      // source says it succeeded (is_error false / status ok / exit 0)
  "error",        // source says it failed
  "interrupted",  // user/agent interrupted, timed out mid-run
  "denied",       // permission prompt rejected / policy blocked (never executed)
  "unknown",      // the source doesn't record an outcome: must carry `reason`
]);

export const failureCategorySchema = z.enum([
  "command-not-found",   // exit 127, "command not found", "is not recognized as…", spawn ENOENT
  "wrong-directory",     // cd/ENOENT on a path, "not a git repository", missing package.json/Cargo.toml at cwd
  "invalid-arguments",   // exit 2, "unknown/invalid/unrecognized option", usage text, missing required arg
  "tool-input-invalid",  // the *tool call itself* failed schema validation (e.g. InputValidationError), not the shell command
  "file-not-found",      // non-shell tool: Read/Edit on a missing path
  "permission-denied",   // exit 126, EACCES, "Permission denied" (OS level, distinct from status "denied")
  "timeout",
  "network",             // could not resolve host, connection refused, proxy 403
  "dependency-missing",  // Python "No module named", Node "Cannot find module", missing lib
  "git-state",           // "not a git repository", merge conflict, detached HEAD, non-fast-forward
  "test-or-build-failure", // command ran correctly but reported failures (npm test exit 1 with test output)
  "other-nonzero-exit",
  "unclassified",        // failed, but no rule matched: never guessed
]);

export const toolCallOutcomeSchema = z.object({
  status: toolCallStatusSchema,
  reason: z.string().optional(),        // required when status === "unknown"
  exitCode: z.number().optional(),      // only when the source states it explicitly
  failureCategory: failureCategorySchema.optional(),
  classificationEvidence: z.object({    // why this category was chosen (audit trail of the audit)
    ruleId: z.string(),                 // e.g. "shell.exit-127", "shell.stderr.command-not-found"
    excerpt: z.string(),                // ≤ 200 chars, redacted, from stderr/result
  }).optional(),
});

// tool-call-record.ts: extended
export const toolCallRecordSchema = z.object({
  id: z.string().optional(),             // tool_use id / toolCallId / spanId
  name: z.string(),
  kind: z.enum(["shell", "file-read", "file-write", "search", "web", "mcp", "subagent", "other"]).optional(),
  argsSummary: z.string(),               // bounded (F7), e.g. the command line or path
  shell: z.object({                      // only for kind === "shell"
    command: z.string(),                 // truncated, redacted
    program: z.string().optional(),      // first executable token, e.g. "npm", "git", "rg"
    cwd: z.string().optional(),          // only when the source records it
  }).optional(),
  outcome: toolCallOutcomeSchema.optional(),
  startedAt: z.string().optional(),
  durationMs: z.number().optional(),
  roundIndex: z.number().optional(),     // which LLM round issued it (links to the inspector)
  filesTouched: z.array(z.string()).optional(),
  tokenCount: tokenCountSchema.optional(),
});
```

A session-level aggregate is computed **server-side** from the normalized
records, so it is provider-agnostic:

```ts
// session-audit.ts (new)
export const sessionAuditSchema = z.object({
  sessionId: z.string(),
  totals: z.object({ toolCalls: z.number(), succeeded: z.number(), failed: z.number(),
                     interrupted: z.number(), denied: z.number(), unknown: z.number() }),
  byTool: z.array(z.object({ name: z.string(), calls: z.number(), failed: z.number(),
                             totalDurationMs: z.number().optional() })),
  byShellProgram: z.array(z.object({ program: z.string(), calls: z.number(), failed: z.number() })),
  byFailureCategory: z.array(z.object({ category: failureCategorySchema, count: z.number() })),
  retries: z.array(z.object({            // same (normalized) command re-issued after a failure
    command: z.string(), attempts: z.number(), eventuallySucceeded: z.boolean(),
    turnIndexes: z.array(z.number()),
  })),
  failureRecoveryCost: z.object({        // rounds immediately following a failed call
    rounds: z.number(),
    outputTokens: tokenCountSchema,      // unavailable when the provider has no per-round usage
  }),
  outcomeCoverage: z.object({            // how much of this audit is actually known
    known: z.number(), unknown: z.number(), unknownReasons: z.array(z.string()),
  }),
});
```

`outcomeCoverage` is the key constraint 6 guarantee. A VS Code session
without content capture shows "outcome unknown for 14 of 14 calls: reason
…" instead of a misleading "0 failures".

## 5. Per-provider data availability

Everything marked *unverified* must be confirmed against a real capture and
recorded as a fixture before code relies on it, the same rule the pi and
Claude Code providers followed (architecture.md §6.2.5/§6.2.6).

| Signal | Claude Code JSONL | pi JSONL | VS Code `main.jsonl` | mitmproxy (Anthropic) | mitmproxy (OpenAI) |
|---|---|---|---|---|---|
| Call id | `tool_use.id` ✅ | `toolCallId` ✅ | `spanId` ✅ | `tool_use.id` ✅ | `tool_calls[].id` ✅ |
| Success/fail flag | `tool_result.is_error` ✅ | `isError` ✅ (docs; unverified on real capture) | span `status` (only `"ok"` observed; error value **unverified**) | `tool_result.is_error` in the *next* request ✅ | none: text heuristics only |
| stdout/stderr | `toolUseResult.stdout/stderr` (Bash), *unverified shape across versions* | `content` text | `attrs.result` (redacted unless content capture is on) | `tool_result.content` | `role:"tool"` content |
| Exit code | embedded in error text (`Exit code N`), *unverified*; parse only an explicit pattern | text only | inside `result` text | text only | text only |
| Interrupted | `toolUseResult.interrupted` *unverified* | ? | ? | n/a | n/a |
| User denial | tool_result text of the permission-rejection message, *unverified exact wording* | ? | ? | n/a | n/a |
| Timestamp / duration | entry `timestamp` (tool_use → tool_result delta) ✅ | entry `timestamp` | `ts` + `dur` ✅ | HAR `startedDateTime`/`time` (per request, not per tool) | same |
| cwd | entry `cwd` ✅ (session-level; `cd` inside a command isn't tracked) | ? | ? | n/a | n/a |

Priority follows data quality: **Claude Code → pi → VS Code → mitmproxy**.

## 6. Server design (SOLID)

```
LogProvider.extractToolCalls(group)          (existing, per provider: SRP)
        │ now also pairs call ⇄ result and fills id/status/exitCode/stderrExcerpt/timing
        ▼
ToolCallRecord[] (normalized)
        │
        ├─► ToolKindResolver           maps provider tool names → kind
        │     ("Bash" | "run_in_terminal" | "bash" | "exec_command" → "shell"), table-driven
        ├─► ShellCommandParser         command → { program, normalized } (strips env assignments,
        │     sudo, `cd x &&` prefixes; pure function, heavily unit-tested)
        ├─► FailureClassifier          ordered list of FailureRule strategies (OCP):
        │     interface FailureRule { id; appliesTo(kind); match(outcome, text): Match | null }
        │     first match wins; no match → "unclassified" (never guessed)
        └─► OutputRedactor             reuses mitmproxy's credential redaction ideas: masks
              tokens/keys (`ghp_…`, `sk-…`, `AKIA…`, bearer headers) and truncates to 200 chars
        ▼
SessionAuditBuilder (pure: ToolCallRecord[] + TurnUsage[] → SessionAudit)
        ▼
GET /api/sessions/:id/audit           (new; read-only; same id validation as other routes)
GET /api/audit?from=&to=&provider=    (optional follow-up: cross-session rollup)
```

Design notes:

- **Dependency inversion**: providers depend only on the domain types.
  `FailureClassifier` gets its rules injected, so tests can supply a minimal
  rule set, and a new failure category means adding a rule, not editing a
  switch.
- **Classify from structured signals first, text second.** Rule order is:
  explicit status or denial → explicit exit code (127, 126, 2) → stderr
  regex → `unclassified`. Every classification records `ruleId` and
  `excerpt`, so the user can see *why* a call was labelled
  `wrong-directory`.
- **Keep regexes locale- and shell-aware and deliberately narrow.** Cover
  bash/zsh (`command not found`), PowerShell/cmd (`is not recognized as the
  name of a cmdlet` / `…as an internal or external command`), Node (`spawn
  X ENOENT`), and Python (`No module named`, which is arguably a separate
  `dependency-missing` category, see §9).
- **Retries**: two shell calls count as one retry group when their
  normalized commands are equal, or the program is equal and the edit
  distance is small, and the earlier one failed. Keep the threshold a named
  constant with tests.
- **Failure-recovery cost**: the rounds (`roundIndex`) after a failed call
  up to the next successful call of the same program. Their `output` tokens
  are summed only where per-round usage is known. Otherwise the field is
  `unavailable` with a reason.
- **Memory**: add `status`/`dur` to `tool-inventory.ts`'s extraction and
  `result` (bounded) to an allow-list for the audit path only, so memory
  stays bounded (see the existing `KNOWN_ATTRS_KEYS` rationale).

## 7. UI design (`packages/web`)

- **Turns table**: add a "Tools (failed)" column, for example `7 (2)`, with
  the failed count in the error colour. For unknown outcomes, show `7 (?)`
  with a tooltip giving the reason.
- **ExplanationPanel tool list**: add a status tag per call (✓ / ✗ category
  / ⏸ interrupted / ⛔ denied / ? unknown). Shell calls show the truncated
  command and program. Clicking one opens `TurnInspector` scrolled to that
  `roundIndex`.
- **New "Audit" tab** in the right column (next to Explanation, System
  prompt, and Tools):
  - KPI tiles: tool calls · failure rate · shell calls · retries ·
    failure-recovery tokens · outcome coverage.
  - Table *By failure category* (count, example excerpt, turns). Each row
    filters the turns table.
  - Table *By shell program* (`npm 12 / 3 failed`, `git 8 / 0`, `rg 5 /
    1`…).
  - Retry groups list.
- **Export**: "Download audit (JSON/CSV)". It is local-only, like
  everything else. The **advice bundle** gets only counts and categories,
  never excerpts (F10).
- **Learn mode**: add one scenario ("19 – failing tool calls and retry
  loops") seeded in `agentic-coding-explained.md`. It shows how a `command
  not found` loop burns cache-read and output tokens, so both modes keep
  one visual language (constraint 4).

## 8. Implementation plan (TDD, one phase, small commits)

Proposed as **Phase 9.10: tool-call audit**. It depends only on 9.6/9.9
(providers) and 9.5 (inspector pairing). Each step starts with the failing
test.

1. **Domain.** Tests in `tool-call-outcome.test.ts` / `session-audit.test.ts`:
   schema accepts the new optional fields; `status:"unknown"` without a
   `reason` is rejected (`superRefine`); old records still parse.
2. **Fix F2 (count fidelity) first**, since it's a standalone bug. Test: a
   VS Code turn with two `run_in_terminal` spans yields two
   `ToolCallRecord`s. Keep the deduplicated view only in `buildToolInventory`.
3. **Pure helpers.** Table-driven tests for `ShellCommandParser`,
   `ToolKindResolver`, and `OutputRedactor`. Include `FOO=1 npm test`, `cd
   pkg && npm run build`, `sudo apt …`, pipes, quoted args, and PowerShell.
4. **FailureClassifier.** One test file per rule family, with a fixture
   string per category (bash, zsh, PowerShell, cmd, Node, Python). Include
   a "no rule matches → `unclassified`" test and a "success is never
   classified" test.
5. **Claude Code extractor (F3).** New fixture
   `claude-code/…/bash-failures-session.jsonl`, built from a **real**
   captured session, then redacted. It should contain:
   - one success
   - `command not found` (127)
   - a bad `cd`
   - a bad flag
   - a permission-rejected call
   - an interrupted call

   Assert id, status, exitCode, category, durationMs, and roundIndex.
6. **pi extractor (F4).** Add `isError` to `PiToolResultMessage`; tests with
   `isError: true`/`false`/missing (missing → `unknown` + reason).
7. **VS Code (F5).** Carry `status`/`dur`. Status other than `"ok"` stays
   `unknown` with reason "unverified error status value" until a real
   failing capture is recorded.
8. **F7.** Bound `argsSummary` (test: a 50 KB `Write` input produces a
   summary ≤ 300 chars; the inspector endpoint still returns the full args).
9. **SessionAuditBuilder** (pure) + `GET /api/sessions/:id/audit` (app tests:
   200 / 404 / id validation / provider without outcomes → coverage
   unknown).
10. **Web.** Component tests first (Vitest + RTL): the turns-table column,
    status tags, and the Audit tab with KPI tiles and zero-data/unknown
    states. Advice-bundle test asserts no excerpt text leaks.
11. **mitmproxy (F6)**, optional follow-up. Decode `tool_use`/`tool_result`
    from request history, de-duplicated across successive requests by id.
12. **Docs in the same change**: `vision.md` §6 (audit scope), `architecture.md`
    §5 (domain), §8 (API), §6.2.x (per provider), `implementation-plan.md`
    (Phase 9.10 with the exit criterion below), UserGuide, and CLAUDE.md
    status line.

**Exit criterion:** for a real Claude Code session containing failed Bash
calls, `GET /api/sessions/:id/audit` reports the correct total, failed, and
per-category counts, each with evidence. The Audit tab renders them. A VS
Code session without content capture reports its outcome coverage as
unknown with a reason, never zero failures.

## 9. Decisions (answered by the user, 2026-09-27)

1. **Scope**: audit is a first-class **Analyze-mode** feature. `vision.md`
   §6 is updated to say so.
2. **Cross-session rollups** are **in scope** for 9.10:
   `GET /api/audit` plus the MCP `get_audit_rollup` tool.
3. **Categories**: add `dependency-missing` and `git-state` to §4's list.
4. **Excerpts**: keep **redacted stderr excerpts** (≤ 200 chars) *and* the
   structured classification, so the UI and MCP clients can filter by
   category, status, tool, or program without text search. The advice
   bundle still gets counts only.
5. **Provider order**: **Claude Code first.** Then pi (`isError`), then VS
   Code (count fix now; status once a real failing span is captured), then
   mitmproxy.

### 9.1 Real-capture findings (Claude Code v2.1.x, captured 2026-09-27)

The new fixture `packages/server/fixtures/claude-code-audit/` comes from a
real session in which each failure category was triggered deliberately. It
confirmed:

- **Failure shape.** `tool_result.is_error: true`. `content` starts with
  `Exit code N\n`, followed by the combined stderr/stdout. `toolUseResult`
  is a **string** `"Error: Exit code N\n…"`.
- **Success shape.** `toolUseResult` is `{ stdout, stderr, interrupted,
  isImage, noOutputExpected }`.
- **Non-shell tool failures.** For example, Read on a missing file gives
  `is_error: true` with `"File does not exist. …"` and no exit code.
- **Harness timeout.** `Exit code 143\nCommand timed out after 2s`. This is
  classified as `status: "interrupted"`, category `timeout`.
- **Observed exit codes:** 127 (command not found), 126 (permission
  denied), 2 (bad option), 128 (git: not a repository), 6 (curl DNS
  failure), 1 (bad `cd`, Python `ModuleNotFoundError`, Node module).
- **Parallel tool calls change the tree shape.** When one assistant message
  carries N parallel `tool_use` blocks, each `tool_result` entry is
  parented to *its own* `tool_use` entry. Only the last result continues
  the chain. So **N-1 results are not on the `last-prompt` branch**, and
  `walkBranch` drops them.
  - Audit extraction must therefore pair results by `tool_use_id` across
    the **whole file**, not just the active branch.
  - The same gap affects the existing Turn Inspector's `result` parts. It
    is fixed by the same file-wide result index.

## 10. MCP interface

Users attach the analyzer to Claude Code (or any MCP-capable harness) and
query their own audit data conversationally, for example "which commands
failed most this week and why?"

- **Transport**: stdio, via `@modelcontextprotocol/sdk` (supports zod v4).
  Local-only, with no network listener, which is consistent with
  constraint 1 and §11.2.
- **Entry point**: `npm run mcp` runs `packages/server/src/mcp/stdio.ts`.
  To register it with Claude Code:
  `claude mcp add copilot-cost-analyzer -- npm run mcp --prefix <repo> --silent`.
- **Composition**: provider registry construction moves out of `createApp`
  into `composition/create-log-provider-registry.ts`, so the HTTP app and
  the MCP server share one wiring (SRP/DIP). Both depend on one
  `AuditQueryService`, which operates on normalized `Session`s and is
  therefore provider-agnostic.
- **Tools.** All are read-only and annotated `readOnlyHint: true`, and all
  return JSON text plus `structuredContent`:

  | Tool | Input | Returns |
  |---|---|---|
  | `list_log_providers` | none | providers, availability, and active id |
  | `list_sessions` | `provider?`, `since?`, `until?`, `limit?` | session summaries (id, title, startedAt, turnCount) |
  | `get_session_audit` | `sessionId`, `provider?` | `SessionAudit` |
  | `list_tool_calls` | `sessionId`, `status?`, `failureCategory?`, `tool?`, `program?`, `limit?` | filtered, classified tool calls with excerpts and turn indexes |
  | `get_audit_rollup` | `provider?`, `since?`, `until?`, `limit?` | cross-session `AuditRollup` (totals, top failing commands and programs, categories over time) |

- **Prompt.** `audit_session` is a canned prompt that asks the model to
  explain one session's failures and suggest fixes, for example "install
  X", "run from the package directory", or "use flag Y".

## 11. Visualization and UX

Charts are built with **D3**, which is already a dependency (constraint:
no new chart library), in `packages/web/src/charts/`. They use the
Industry theme tokens. Every chart has a text or table equivalent and an
empty/unknown state (constraint 6).

- **Audit tab, top row: KPI tiles.** Tool calls, failure rate, shell calls,
  retries, recovery tokens, and outcome coverage. Failure rate uses the
  error tone only when it is above 0.
- **`ToolOutcomeTimeline`.** One column per turn, with stacked counts of
  succeeded, failed, interrupted, denied, and unknown calls. Clicking a
  column selects that turn in the turns table, so the audit links back to
  cost.
- **`FailureCategoryBars`.** Horizontal bars, sorted by count. Clicking a
  bar applies the category as a filter.
- **`ProgramBars`.** Horizontal bars per shell program, showing succeeded
  versus failed.
- **Failures table.** Filter chips for status, category, tool, and program.
  Each row shows turn, tool, the command in monospace, a category tag, the
  exit code, and a redacted excerpt. Clicking a row opens the Turn
  Inspector.
- **Retry groups** list: command, attempts, and whether it eventually
  succeeded.
- **Turns table.** A "Tools" cell shows `n` plus a red `✗k` badge when any
  call in that turn failed.
- **ExplanationPanel.** A status tag on each tool call.
- **Cross-session view.** Header "Audit" toggle (Analyze mode only). It
  shows the rollup: failure rate per day as a line, top failing programs,
  and a category mix.

## 12. What shipped, and known limitations

Shipped:

- Domain schemas for outcomes, sessions, and rollups.
- Pure `services/tool-audit/*` helpers.
- Claude Code outcomes, with whole-file result pairing that also fixes the
  inspector.
- pi `isError` outcomes.
- The VS Code per-invocation count fix.
- Three HTTP endpoints, the stdio MCP server, and the web Audit views.
- A `blocked-by-policy` category, added after a live session showed
  harness safety-check blocks.

Rendering the UI against a live session also surfaced a rollup refetch
loop, which is fixed and has a regression test.

Known limitations, each deliberately not guessed at:

- **Program attribution in chains.** `a && b && c` is attributed to the
  first non-`cd` program. If a later program in the chain failed, the
  category is still right (it comes from the error text), but the program
  may not be.
- **Retries.** Only an exact, whitespace-normalized re-run counts as a
  retry. A tweaked re-run, such as a corrected flag, is not matched.
- **VS Code outcomes** stay `unknown` until a real failing `tool_call` span
  is captured and its status value is confirmed.
- **mitmproxy** tool calls (F6) are not decoded yet.
- **Recovery cost** is reported as recovery rounds plus the exact tokens of
  affected turns. Per-round token usage isn't part of the normalized
  `Session`, so it is not estimated.

