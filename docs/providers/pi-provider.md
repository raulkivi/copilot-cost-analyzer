# pi coding-agent LogProvider — working notes

Internal engineering summary of the `PiAgentLogProvider`, kept alongside the
authoritative description in
[architecture.md §6.2.5](../architecture.md#625-pi-agent-provider-flow).
This doc exists to speed up the *next* round of work on this provider —
what it does, where the code lives, what changed most recently, and what's
still open.

## What it is

A third `LogProvider` (alongside VS Code and mitmproxy) that reads the
[pi coding agent](https://pi.dev)'s own JSONL session format directly —
`~/.pi/agent/sessions/--<cwd-with-slashes-as-dashes>--/<timestamp>_<uuid>.jsonl`
— with no OS-level store dependency and no vendor wire-protocol decoding,
since pi already normalizes token usage per message.

pi sessions are a **branchable tree** (fork/rewind create sibling entries
sharing an ancestor), not a linear history. Because `Session.turns` must
stay a flat array, the provider produces one `Session` per leaf branch —
the same "one file → N sessions" precedent as the mitmproxy provider's
idle-gap split.

## Code map

| File | Role |
|---|---|
| [pi-agent-log-provider.ts](../../packages/server/src/data-sources/pi-agent/pi-agent-log-provider.ts) | The `LogProvider` implementation — `listSessions`, `readSession`, `readTurnDetail`, `checkAvailability` |
| [pi-jsonl-reader.ts](../../packages/server/src/data-sources/pi-agent/pi-jsonl-reader.ts) | Parses raw JSONL lines into `PiSessionHeader` / `PiRawEntry` |
| [session-tree.ts](../../packages/server/src/data-sources/pi-agent/session-tree.ts) | `findLeafEntryIds` / `walkBranch` — tree reconstruction from `parentId` links |
| [session-id.ts](../../packages/server/src/data-sources/pi-agent/session-id.ts) | `computePiFileHash` / `computeBranchSessionId` — session IDs use a `__branch__` separator (pi's leaf ids are already uuids) |
| [turn-grouper.ts](../../packages/server/src/data-sources/pi-agent/turn-grouper.ts) | `groupBranchEntriesByUserMessage` — groups a branch into turns, mirroring the VS Code provider's grouping |
| [usage-extractor.ts](../../packages/server/src/data-sources/pi-agent/usage-extractor.ts) | Sums every usage carrier in a turn (assistant, toolResult, `usage` entries, compaction, branch_summary) into `uncachedInput`/`output`/`cacheRead`/`cacheWrite`/`reasoning`; also extracts tool calls |
| [pi-message.ts](../../packages/server/src/data-sources/pi-agent/pi-message.ts) | Type guards/accessors for pi's message shapes (`PiAssistantMessage`, `PiToolResultMessage`, `PiToolCallBlock`) |
| [turn-inspector-builder.ts](../../packages/server/src/data-sources/pi-agent/turn-inspector-builder.ts) | Builds `TurnInspectorDetail` from a turn's raw entries (Analyze-mode drill-down) |
| [resolve-pi-agent-sessions-dir.ts](../../packages/server/src/platform/pi-agent-paths/resolve-pi-agent-sessions-dir.ts) | Locates `~/.pi/agent/sessions/` and lists session files for the current cwd |
| [resolve-pi-system-prompt-log-path.ts](../../packages/server/src/platform/pi-agent-paths/resolve-pi-system-prompt-log-path.ts) | Resolves the optional `pi-system-prompt-logger` sidecar log path (`PI_SYSTEM_PROMPT_LOG_PATH` env override, else `~/.pi/agent/logs/system-prompts.jsonl`) |
| [system-prompt-sidecar-reader.ts](../../packages/server/src/data-sources/pi-agent/system-prompt-sidecar-reader.ts) | Reads the sidecar JSONL into a `Map` keyed by resolved `sessionFile` path (earliest-wins on duplicates) |
| [system-message-replay.ts](../../packages/server/src/data-sources/pi-agent/system-message-replay.ts) | `replaySystemMessages` — replays a branch's `role: "system"` messages (and compaction checkpoints) into the current prompt text, sections and tools, like pi-ai's `getCurrentSystemMessage` |
| [system-prompt-components.ts](../../packages/server/src/data-sources/pi-agent/system-prompt-components.ts) | `buildPiSystemPromptComponentsFromState` (in-file system prompt) and `buildPiSystemPromptComponents` (sidecar fallback) → `SystemPromptComponent[]`, mirroring `buildSystemPromptBreakdown`'s VS Code shape |
| `packages/server/fixtures/pi-agent/*.jsonl` | Test fixtures: `schema-v3-session` (follows the published schema in the vendored package: system messages, `arguments`, `thinking`, toolResult usage, a `cache_warm` usage entry, a compaction with usage and `systemMessage`), plus the older hand-authored `normal-session`, `forked-session`, `malformed-lines-session`, `no-usage-session`. No static sidecar-log fixture exists — its `sessionFile` would be checkout-path-dependent, so tests synthesize one into a tmpdir instead |

Each `.ts` above has a matching `.test.ts` (TDD-first, per `architecture.md`
§11.4); `pi-agent-log-provider.test.ts` also runs the shared
`describeLogProviderContract` conformance suite.

## System prompt and tool inventory: in-file first, sidecar fallback

pi persists the prompt and tool loadout in the session file as
`role: "system"` messages (vendored `docs/session-format.md`
"SessionMessageEntry"). `system-message-replay.ts` replays them along the
branch, and `Session.systemPrompt` (base content + one component per named
section + tool definitions, all with real tokenizer estimates),
`Session.toolInventory` (every tool declared on the branch, with the turns
that invoked it) and `readSystemPromptText` all come from that when present.

Older session files without system messages fall back to the sidecar:
`Session.systemPrompt` is populated, conditionally, since Phase 9.8: the
vendored `packages/pi-system-prompt-logger` extension (Phase 9.7, not part
of pi itself) captures the fully assembled system prompt plus selected
tools/skills/context files to a JSONL sidecar log
(`~/.pi/agent/logs/system-prompts.jsonl`) from outside pi's own session
format. When a user has installed it (`npm run configure` offers to) and a
session's file has a matching captured record,
`pi-agent-log-provider.ts` reads it via `system-prompt-sidecar-reader.ts`
(joined on resolved `sessionFile` path — see architecture.md §6.2.5 for the
full join-key reasoning and its known earliest-wins-on-fork simplification)
and builds `SystemPromptComponent[]` via `system-prompt-components.ts`.

Knock-on effects in the UI for pi sessions:

- `components/SystemPromptBreakdown` renders real meter rows when a match
  exists, same as any other provider. With no match, its empty-state text
  is pi-agent-specific ("No system prompt captured for this session yet —
  open the system prompt inspector for how to enable it"), distinct from
  mitmproxy's permanent "this provider does not capture..." message.
- Unlike other providers, its "Open system prompt inspector" button
  **always** renders for `pi-agent` sessions (not gated on a `built-in`
  component being present) — so the inspector itself can explain what to
  do when there's no capture yet.
- `components/SystemPromptInspector` fetches through the same
  `GET /api/sessions/:id/system-prompt` route VS Code uses;`app.ts` branches
  on `registry.getActiveProviderId() === "pi-agent"` before reaching the
  VS-Code-only session-store path, delegating to a new
  `PiAgentLogProvider.readSystemPromptText(sessionId)` method (not on the
  shared `LogProvider` interface — ISP, matching the existing
  VS-Code-special-case precedent). On success the real captured text
  renders identically to a VS Code prompt (Pretty/Raw/Icicle — that
  rendering machinery is already provider-agnostic, no changes needed
  there). On no match, the inspector shows a plain-text (no link — an
  earlier "link to the extension's README" idea was explicitly rejected)
  message pointing at `npm run configure` as the install path, instead of
  the VS Code-specific hint.
- `npm run configure`/`unconfigure` (`scripts/install.sh`/`uninstall.sh`)
  interactively offer to build (`npm run bundle
  --workspace=packages/pi-system-prompt-logger`) and install/remove
  `~/.pi/agent/extensions/pi-system-prompt-logger.js` — this is the actual
  install mechanism; the UI never links to the extension's own README.

## Most recent change (2026-10-09, schema verification)

Checked the provider against the published schema shipped in the vendored
`@earendil-works/pi-coding-agent` 0.87.1 (`docs/session-format.md`,
`docs/message-types.md`, pi-ai `dist/types.d.ts`) and fixed what it
dropped: top-level `usage` entries, optional usage on toolResult/compaction/
branch_summary, `Usage.reasoning`, `ToolCall.arguments`,
`ThinkingContent.thinking`, and the in-file system prompt/tool loadout. See
architecture.md §6.2.5 for the attribution rules.

## Earlier change (2026-09-04, Phase 9.8)

Wired `PiAgentLogProvider` to optionally read the `pi-system-prompt-logger`
sidecar log vendored in Phase 9.7, per two explicit UX requirements: the
system prompt inspector shows the real captured prompt when a sidecar
record matches, and a plain-text (no link) "run `npm run configure`"
message when it doesn't.

- [system-prompt-sidecar-reader.ts](../../packages/server/src/data-sources/pi-agent/system-prompt-sidecar-reader.ts) /
  [system-prompt-components.ts](../../packages/server/src/data-sources/pi-agent/system-prompt-components.ts) /
  [resolve-pi-system-prompt-log-path.ts](../../packages/server/src/platform/pi-agent-paths/resolve-pi-system-prompt-log-path.ts) —
  new, TDD-first (see Code map above)
- [pi-agent-log-provider.ts](../../packages/server/src/data-sources/pi-agent/pi-agent-log-provider.ts) —
  `PiAgentLogProviderOptions.systemPromptLogPath`, sidecar-index threading
  through `buildSessionForBranch`/`listSessions`/`readSession`, new
  `readSystemPromptText(sessionId)` method
- [app.ts](../../packages/server/src/app.ts) — `GET
  /api/sessions/:id/system-prompt` branches on
  `registry.getActiveProviderId() === "pi-agent"`
- [SystemPromptBreakdown.tsx](../../packages/web/src/components/SystemPromptBreakdown.tsx) —
  button gate becomes `hasBuiltIn || providerId === "pi-agent"`; new
  pi-agent-specific empty-state text
- [SystemPromptInspector.tsx](../../packages/web/src/components/SystemPromptInspector.tsx) /
  [App.tsx](../../packages/web/src/App.tsx) — new `providerId` prop,
  threaded through, branches the fetch-failure message
- [scripts/install.sh](../../scripts/install.sh) /
  [scripts/uninstall.sh](../../scripts/uninstall.sh) — interactive
  build+install / remove of the extension via `npm run configure`/
  `unconfigure`, independent of and non-fatal to the existing alias setup

Full server suite (439 tests) and full web suite (284 tests) pass after the
change; `install.sh`/`uninstall.sh` verified manually (no automated harness
exists for shell scripts in this repo).

## Previous change (2026-09-02, ~23:29 UTC)

Bug report: the "System prompt" tab showed a confusing empty state for pi
sessions — the fallback message told the user to "enable
agentDebugLog.fileLogging.enabled and reload VS Code," which is a VS Code
setting that doesn't apply to pi (or mitmproxy) sessions at all. Fix:
`SystemPromptBreakdown` gained an optional `providerId` prop (wired from
`session.providerId` in `App.tsx`) and a provider-neutral message for any
non-`vscode` session — since superseded by the pi-agent-specific message
above.

## Open items (pending real-data verification)

Per architecture.md §6.2.5, this provider is now verified against pi's
published schema as shipped in the vendored package, but still not pinned
against a real, redacted captured session. Until one is obtained:

- `tool`, `vision` token counts stay `{ known: false }` — confirmed: pi's
  `Usage` has no field for them.
- `costAiCredits` (per-turn and session-level) stays permanently
  `{ known: false }` — AI Credits is Copilot's own billing unit with no
  defined conversion for pi's own cost figures (may never be resolvable).
- Non-assistant usage is attributed to the turn whose span contains it; a
  `branch_summary`'s usage therefore lands on the previous turn of the new
  branch. Whether it should count toward the following turn instead is a
  judgement call worth revisiting with real data.
- Fork vs. rewind is approximate: any turn following a tree branch point is
  tagged `triggeredEvent: "fork"`; a real `branch_summary` entry's more
  specific intent isn't distinguished yet.

**Next step for real-data verification:** obtain one redacted real
`~/.pi/agent/sessions/**/*.jsonl` capture, diff its actual field names
against the fixtures in `packages/server/fixtures/pi-agent/`, and update the
extractors + this doc + architecture.md §6.2.5 together once confirmed.

**`packages/pi-system-prompt-logger`** (vendored Phase 9.7, consumed
starting Phase 9.8 — see "System prompt" section above) is a candidate tool
for unblocking this: installing it into a real pi session and running a
turn captures a real `sessionId` and `~/.pi/agent/sessions/**/*.jsonl` file
side by side with its own `system-prompts.jsonl` record, giving both the
real-session-format capture this section needs *and* a real look at
`selectedTools`/`skillNames`/`contextFilePaths`/`sessionId`-vs-`header.id`
semantics — the last of which Phase 9.8's `sessionFile`-based join
deliberately sidesteps rather than resolves (see architecture.md §6.2.5's
"known simplification" note). A real capture with a forked/rewound session
would additionally confirm or refute the earliest-record-wins assumption
for that case.
