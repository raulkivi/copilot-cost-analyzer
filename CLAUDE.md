# CLAUDE.md

Project-specific guidance for working in this repo. Full context lives in
the docs below — read them before making changes; don't duplicate their
content here.

- [README.md](README.md) — doc index
- [docs/vision.md](docs/vision.md) — product scope, non-goals
- [docs/architecture.md](docs/architecture.md) — system design, guiding
  constraints, engineering practices (TDD + SOLID)
- [docs/implementation-plan.md](docs/implementation-plan.md) — phase order,
  exit criteria, current default tech choices
- [docs/agentic-coding-explained.md](docs/agentic-coding-explained.md) —
  domain reference Learn mode is seeded from

## Rules for this repo

- Treat the docs above as the source of truth. If an implementation
  decision conflicts with them, update the relevant doc in the same change
  rather than letting it drift.
- Follow `architecture.md`'s numbered constraints and §11.4/§11.5 (TDD,
  SOLID) for any code change — write the failing test first.
- Follow `implementation-plan.md`'s phase order and each phase's exit
  criterion; don't start a later phase's work before its dependencies are
  met.
- Commit all changes to git as soon as a phase's exit criterion is met,
  before starting the next phase.
- Repo status: Phases 0-9.5 complete, Phase 9.6 built pending real-data
  verification (see below), Phases 9.7-9.9 complete — npm workspaces with
  `packages/domain`
  (zod schemas + types for every architecture.md §5 shape, including
  `Session.category`/`startedAt`/`providerId`, `ConfigWarning.severity`,
  `LogProviderDescriptor`/`LogProviderStatus`, and `TurnInspectorDetail`),
  `packages/server`
  (Express API: Learn-mode fixtures plus real Analyze-mode sessions read
  through a provider-extensible `LogProvider` registry — `VscodeLogProvider`
  (SQLite + `main.jsonl`, enriched with real per-turn token/cache numbers
  plus optional cache-write/reasoning tokens from `agent-traces.db`, and
  Analyze-mode-only system-prompt breakdown/tool-inventory detail) and
  `MitmproxyLogProvider` (local HAR captures, redacted, decoded through an
  Anthropic/OpenAI vendor-decoder registry), and `PiAgentLogProvider` (reads
  the pi coding agent's own JSONL session format directly, one branch-tree
  leaf per `Session`; built from pi's published docs schema — `tool`/
  `vision`/`reasoning`/`costAiCredits` stay unavailable pending verification
  against a real captured session, see architecture.md §6.2.5), and
  `ClaudeCodeLogProvider` (reads the Claude Code CLI's own JSONL session
  format directly from `~/.claude/projects/`, one `Session` per file using
  the format's own authoritative active-branch pointer; every shape
  confirmed against real captures on this machine, so per-turn usage
  including cache read/write and reasoning tokens is populated for real —
  `systemPrompt`/`toolInventory` stay unset, see architecture.md §6.2.6);
  `GET /api/log-providers` and
  `PUT /api/log-providers/active` select the source; a startup config check
  reads `settings.json` and exposes `GET /api/config/status`),
  `packages/web` (Vite + React, styled with the "Industry" design system
  ported from `Design/` into `theme.css` — header with mode switch and an
  Analyze-mode provider select, a searchable session list showing each
  session's total AI Credits, a 13-column turns table (incl. a running
  cumulative AI Credits total per row; AI Credits figures are rounded to 2
  decimal places throughout), a tabbed Explanation/System-prompt/Tools right
  column, a dismissible structured config-warning banner (required vs.
  optional severity styled distinctly), zero-data empty states — built on
  shared `components/ui/*` primitives; `charts/AiCreditsSparkline` is the
  sole remaining D3 chart, in the center column's header row; `TurnInspector`
  is a per-turn request/response drill-down opened from `ExplanationPanel`,
  showing one Request/Response card pair per LLM round-trip with
  oversized/file/image content collapsed into placeholder chips), Vitest
  wired with TDD-first tests, and `packages/pi-system-prompt-logger`
  (a vendored Pi coding-agent extension — captures the assembled pi system
  prompt to a JSONL sidecar log; `PiAgentLogProvider` optionally consumes
  it when installed and a session matches, populating `Session.systemPrompt`
  and the system prompt inspector for pi sessions, `toolInventory` still
  unpopulated; `npm run configure`/`unconfigure` install/remove it, see
  architecture.md §6.2.5). Phase 10 (VS Code extension packaging) is
  future/out of MVP scope — see implementation-plan.md.
