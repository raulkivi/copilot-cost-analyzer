# Pi System Prompt Logger — Design

## Goal

Automatically capture the fully-assembled system prompt for every Pi coding-agent
session going forward, and persist it to an append-only log for later inspection
(debugging, auditing, prompt-drift detection).

## How Pi actually exposes the system prompt

Verified by installing `@mariozechner/pi-coding-agent@0.73.1` and reading its
shipped `.d.ts` files directly (not assumed from docs/blog posts). Re-verified
against `@earendil-works/pi-coding-agent@0.87.1` (the package was renamed when Pi
moved to `earendil-works/pi`): same event, fields, `ctx` accessors and `~/.pi/agent/`
paths; `systemPromptOptions` is now typed `NormalizedBuildSystemPromptOptions`.

- Extensions are TS/JS modules: `export default function(pi: ExtensionAPI) { ... }`,
  placed in `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project-local),
  hot-reloadable via `/reload`.
- `pi.on("before_agent_start", handler)` fires **after the user submits a prompt,
  before the agent loop runs**, once per turn. The event is:

  ```ts
  interface BeforeAgentStartEvent {
    type: "before_agent_start";
    prompt: string; // raw user prompt
    images?: ImageContent[];
    systemPrompt: string; // <-- the fully assembled system prompt
    systemPromptOptions: BuildSystemPromptOptions; // tools/skills/context metadata
  }
  ```

- The handler's `ctx: ExtensionContext` additionally exposes:
  - `ctx.sessionManager.getSessionId(): string` / `getSessionFile(): string | undefined`
  - `ctx.model: Model<any> | undefined` → `{ id, provider, ... }`
  - `ctx.cwd: string`
  - `ctx.getSystemPrompt(): string` — same content, available as a general accessor
    (used by Pi's own official example, `examples/extensions/system-prompt-header.ts`).
- A handler returning nothing (`undefined`) is a pure observer — it does not alter
  the prompt or the turn.
- Other extensions (`pi-today`, `pi-model-agents`) confirm the operational
  constraint: **`before_agent_start` fires on every turn**, so a naive logger would
  write the (typically unchanged) prompt on every message. To avoid log bloat and
  to stay consistent with Pi's own prompt-caching guidance, we log **once per
  session id**, on the first turn only.

No public event carries a session id directly on `session_start` — the id is read
from `ctx.sessionManager` inside any handler, so `before_agent_start` alone is
sufficient; we don't need a separate `session_start` subscription.

## Architecture (ports & adapters, SOLID)

```
packages/pi-system-prompt-logger/
  src/
    domain/
      SystemPromptRecord.ts        # data shape + pure builder function
    ports/
      SystemPromptSink.ts          # where records go
      SeenSessionTracker.ts        # de-dup per session id
      FileSystemPort.ts            # minimal fs abstraction
    adapters/
      JsonlFileSink.ts             # SystemPromptSink -> newline-delimited JSON file
      InMemorySeenTracker.ts       # SeenSessionTracker -> process-lifetime Set
      NodeFileSystem.ts            # FileSystemPort -> node:fs/promises
    SystemPromptLoggerExtension.ts # orchestrator, depends only on the ports above
    index.ts                       # composition root / Pi entry point
```

- **SRP** — extraction (`buildSystemPromptRecord`), de-dup (`SeenSessionTracker`),
  and persistence (`SystemPromptSink`) are separate, independently testable units.
  The orchestrator's only job is wiring them to the `before_agent_start` event.
- **OCP** — a new destination (e.g. a remote log collector) is a new
  `SystemPromptSink` implementation; the orchestrator and Pi wiring don't change.
- **LSP** — any `SystemPromptSink` / `SeenSessionTracker` is substitutable; tests use
  in-memory fakes, production uses the file-backed adapters.
- **ISP** — `SystemPromptSink`, `SeenSessionTracker`, and `FileSystemPort` are each
  a single method or two, not one bloated "logger" interface.
- **DIP** — `SystemPromptLoggerExtension` depends on the port interfaces, not on
  `node:fs` or the Pi runtime directly. `index.ts` is the only place concrete
  adapters are constructed and wired to the real `ExtensionAPI`.

## Record shape

```ts
interface SystemPromptRecord {
  sessionId: string;
  sessionFile?: string;
  capturedAt: string; // ISO-8601
  cwd: string;
  provider?: string;
  modelId?: string;
  systemPromptChars: number;
  systemPrompt: string;
  selectedTools?: string[];
  skillNames?: string[];
  contextFilePaths?: string[];
}
```

`selectedTools` / `skillNames` / `contextFilePaths` come from
`event.systemPromptOptions`, so the log records _what was loaded_ structurally,
not just the raw text — useful for diffing prompt composition across sessions
without re-parsing prose.

## Failure handling

Logging must never break a coding session. `JsonlFileSink.write` errors are
caught in the orchestrator; on failure it calls `ctx.ui.notify(..., "warning")`
once and continues — it never throws back into Pi's event loop.

## Storage

Default: `~/.pi/agent/logs/system-prompts.jsonl` (override via
`PI_SYSTEM_PROMPT_LOG_PATH`). Directory is created on first write if missing.
Append-only JSONL — safe for concurrent Pi processes, trivial to `tail -f` or
parse with `jq`.

## Test plan (TDD, written before implementation)

1. `buildSystemPromptRecord` — maps a fake event/ctx to the record shape;
   handles missing `model`/`sessionFile`/`systemPromptOptions` fields.
2. `InMemorySeenTracker` — `hasSeen` false until `markSeen`, then true; distinct
   ids tracked independently.
3. `JsonlFileSink` — given a fake `FileSystemPort`, ensures the log directory
   exists, appends exactly one JSON line terminated with `\n`, and that line
   parses back to the original record.
4. `SystemPromptLoggerExtension` —
   - registers exactly one `before_agent_start` handler;
   - first call for a session writes a record and marks it seen;
   - second call for the _same_ session id does not write again;
   - a different session id writes again;
   - a sink failure is swallowed and surfaced via `ctx.ui.notify`, not thrown.

## Installation

1. From the monorepo root: `npm run build --workspace=packages/pi-system-prompt-logger`
   (typechecks and compiles `src/` → `dist/`), then
   `npm run bundle --workspace=packages/pi-system-prompt-logger` (bundles
   `src/index.ts` → the single-file `dist/pi-system-prompt-logger.js`).
2. Copy or symlink `packages/pi-system-prompt-logger/dist/pi-system-prompt-logger.js`
   into `~/.pi/agent/extensions/pi-system-prompt-logger.js` (all projects) or
   `.pi/extensions/` (this project only).
3. `/reload` inside Pi, or restart it.
4. Confirm: `tail -f ~/.pi/agent/logs/system-prompts.jsonl` while starting a new
   Pi session.

## Status: vendored, not yet consumed

This package was originally a standalone repo; it was vendored into
`copilot-cost-analyzer` as `packages/pi-system-prompt-logger` to become a
first-class part of the app rather than an external companion tool. As of
this vendoring, **nothing in `packages/server` or `packages/web` reads the
`system-prompts.jsonl` sidecar log this extension produces** — the `pi-agent`
`LogProvider` (`packages/server/src/data-sources/pi-agent/`) still leaves
`Session.systemPrompt`/`Session.toolInventory` empty for pi sessions, exactly
as documented in `docs/architecture.md` §6.2.5 and
`docs/providers/pi-provider.md`. Wiring that provider to read this sidecar
log and populate those fields is tracked as a separate follow-up.
