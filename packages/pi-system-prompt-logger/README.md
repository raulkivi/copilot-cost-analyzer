# pi-system-prompt-logger

A Pi coding-agent extension that captures the fully assembled system prompt
(base prompt + tools + guidelines + context files + skills) once per session
and appends it to a JSONL log. See `DESIGN.md` for the architecture and
verified API details.

This package lives inside the `copilot-cost-analyzer` monorepo as
`packages/pi-system-prompt-logger`, one of its npm workspaces. It has no
runtime dependency on `packages/server`/`packages/web` and isn't consumed by
them yet — it's a standalone extension you build and install into your own
`pi` installation, same as when it was a separate repo.

## Requirements

- Node.js 18+
- Pi coding agent (tested against `@mariozechner/pi-coding-agent@0.73.1`)

## Install

Build the drop-in bundle from the repo root:

```bash
npm run bundle --workspace=packages/pi-system-prompt-logger
```

**Global** (logs every project's sessions):

```bash
mkdir -p ~/.pi/agent/extensions
cp packages/pi-system-prompt-logger/dist/pi-system-prompt-logger.js ~/.pi/agent/extensions/
```

**Project-local** (this project only):

```bash
mkdir -p .pi/extensions
cp packages/pi-system-prompt-logger/dist/pi-system-prompt-logger.js .pi/extensions/
```

Then inside a running Pi session: `/reload` (or just restart Pi).

## Configure

Default log path: `~/.pi/agent/logs/system-prompts.jsonl`

Override with an environment variable before launching Pi:

```bash
export PI_SYSTEM_PROMPT_LOG_PATH=/custom/path/system-prompts.jsonl
```

## Verify

```bash
tail -f ~/.pi/agent/logs/system-prompts.jsonl
```

...then start a new Pi session (`pi` or `/new`) in another terminal and send
one message. You should see one JSON line appear with `sessionId`,
`systemPrompt`, `systemPromptChars`, `selectedTools`, etc. Sending a second
message in the same session should **not** add another line — the second
message in the same session **will not** add another line (logged once per
session, by design, to preserve prompt caching and avoid log bloat).

## Development

From the repo root, scoped to this workspace:

```bash
npm install
npm test --workspace=packages/pi-system-prompt-logger    # vitest, 15 tests across 4 files
npm run build --workspace=packages/pi-system-prompt-logger # tsc -p tsconfig.build.json, compiles src/ -> dist/
npm run bundle --workspace=packages/pi-system-prompt-logger
  # produces dist/pi-system-prompt-logger.js, the single drop-in file used above
```

Or from inside `packages/pi-system-prompt-logger/`, the bare `npm test` /
`npm run build` / `npm run bundle` commands work the same way.

All logic outside `src/index.ts` (the composition root) is unit-tested with
fakes — no real Pi process or real disk I/O is required to run the suite.
