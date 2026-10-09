# User Guide

A walkthrough of the Cost & Token Usage Analyzer's two modes — **Learn** (guided,
bundled example sessions) and **Analyze** (your own real GitHub Copilot
Chat sessions) — with screenshots of every major feature. For install
steps, see the [README](../README.md); for the app's design/architecture,
see [architecture.md](architecture.md).

## Getting started

Run `npm install && npm run dev` from the repo root, then open
http://127.0.0.1:5173. Learn mode works immediately. Analyze mode lists
whatever real Copilot Chat sessions it finds in your local VS Code session
store — see [Analyze mode](#analyze-mode) below for what to expect there,
including turning on debug logging for full per-turn numbers.

![The app on load: header, Learn/Analyze mode switch, session list, and the config warning banner](images/landing-page.png)

## The shared layout

Both modes use the same three-column layout:

- **Header** (top) — brand mark, the **Learn / Analyze** mode switch, and
  a **Config** button.
- **Left column** — a searchable list of scenarios (Learn) or sessions
  (Analyze). Click a card to load it.
- **Center column** — the selected session's **turns table** (one row per
  turn) with a **timeline scrubber** underneath it.
- **Right column** — an **Explanation** panel for the selected turn; in
  Analyze mode this becomes a three-tab panel (Explanation / System
  prompt / Tools).

Clicking a table row, dragging the scrubber, or pressing **Enter/Space**
on a focused row or card all drive the same "selected turn" state, so the
table, scrubber, and explanation panel always stay in sync.

## Exporting an AI-advice bundle

Every session card — Learn or Analyze — has a checkbox in its top-right
corner. Tick one or more to select sessions for advice; a trigger bar
appears under the list showing how many are selected:

![Two sessions selected for advice, with the Export advice trigger bar underneath the session list](images/guide-advice-trigger-bar.png)

Click **Export advice** to open a dialog with a ready-to-paste prompt:
aggregated session/turn metadata — token usage, cache efficiency, tool
usage, prompt composition, AI Credits — formatted as JSON for an LLM chat
to give advice on your agentic-coding workflow. **Chat message text is
never included.** Click **Preview** to see the exact bundle before
copying it, optionally include tool-call arguments (which may contain
text snippets) via the checkbox, then **Copy advice prompt**:

![The Export advice bundle dialog with its preview open, showing the JSON metadata bundle](images/guide-advice-export-dialog.png)

If a selected session hasn't been opened yet in the list, the dialog
flags it — its turn-level detail (tokens, cache, tool usage) won't be in
the bundle until you open it first.

## Learn mode

Learn mode ships with 18 bundled example sessions, each illustrating one
concept from [agentic-coding-explained.md](agentic-coding-explained.md) —
prompt caching basics and TTL expiry, context compaction, an MCP tool
change, a model switch, `/clear`, `/rewind`, session forking, an
instructions-file edit, extended thinking/reasoning budget, a subagent
running on a cheaper model, and more. No setup is required — this data is
static and doesn't depend on anything on your machine.

### Picking a scenario and reading the turns table

Click a card in the left column to load it. Each row in the turns table is
one turn, with the token/AI Credit breakdown for that turn:

![A loaded scenario: turns table with per-turn token and AI Credit columns, AI Credits sparkline, and the explanation panel](images/guide-trigger-tag.png)

The columns are **Turn, Trigger, Rounds, Uncached in, Cache read, Cache
write, Tool, Vision, Reasoning, Output, AI Credits, Cumulative, Model**.
Rounds is how many LLM request/response round-trips made up that turn (a
tool call followed by a follow-up response counts as two) — always `1` for
mitmproxy sessions, since one HAR entry is one complete exchange. Cumulative
is a running AI Credits total across the session, up to and including that
row. An em dash (**—**) in any numeric cell means that figure is genuinely
unknown for that turn — the app never shows a fabricated `0` in its place,
and once one turn's own cost is unknown the cumulative total for that row
and every later row is also an em dash rather than a total that silently
skips it. The small line chart next
to the session title (when visible) is an AI-Credits-per-turn sparkline; it
only appears when every turn in the session has a known AI Credits value.

The **Trigger** column flags turns where something out of the ordinary
happened mid-session — a `compaction` event (shown above), a `tool
change`, a `model switch`, `/clear`, `/rewind`, cache expiry, or a
session fork. Most turns have no trigger and show a muted em dash instead.

### Stepping through turns

Click any row, or drag the **Timeline** scrubber at the bottom of the
table, to select a turn. Both stay in sync — dragging the scrubber
highlights the matching row, and clicking a row moves the scrubber:

![The timeline scrubber mid-session, with the matching row highlighted and its explanation shown](images/guide-scrubber.png)

The right-column **Explanation** panel always shows a plain-language
explanation for the currently selected turn — what happened, and why,
based on that turn's real cache/token numbers.

### Searching the scenario list

The left column has a search box that filters by title as you type:

![Filtering the scenario list by title](images/guide-search.png)

If nothing matches, the list shows a plain "No matches." message instead
of an empty box.

## Analyze mode

Switch to Analyze mode via the header's mode switch. This lists real
sessions read from a **log provider** — nothing is sent anywhere, the app
only reads local files.

### Choosing a log provider

Analyze mode reads from one of three local sources, picked via the **Source**
dropdown that appears in the header once you're in Analyze mode. The same
header area also holds the **Retention** field described below:

![The header's Source dropdown (VS Code selected) and Retention field, visible in Analyze mode](images/guide-analyze-provider-select.png)

- **VS Code (local Copilot Chat)** — the default. Reads directly from your
  local VS Code Copilot Chat session store (SQLite + debug logs), as
  described below.
- **mitmproxy (HAR capture)** — reads a local mitmproxy HAR capture instead,
  for Anthropic/OpenAI API traffic recorded outside VS Code. See
  [mitmproxy-setup.md](mitmproxy-setup.md) for how to record a capture. A
  single capture is automatically split into separate sessions wherever
  there's a 30+ minute idle gap between requests, so unrelated runs left
  recording in the background don't get mixed into one session.
- **pi coding agent** — reads session logs written by the [pi coding
  agent](https://pi.dev) directly from `~/.pi/agent/sessions/`, no capture
  step needed. Because a pi session can branch (fork/rewind to try a
  different approach mid-session), a session file with unmerged branches
  shows up as multiple sessions, titled `<name> (branch i of N)` — one per
  branch tip. Token totals include everything pi records — assistant
  replies, nested tool usage, cache warming and compaction/branch summaries
  — and reasoning tokens when the model's provider reports them. The
  system prompt and tool list come from the session file itself (or, for
  older sessions, from the optional `pi-system-prompt-logger` extension).
  Tool-call and vision token breakdowns, plus AI Credits (a GitHub
  Copilot-specific billing unit pi has no equivalent of), aren't available
  for pi sessions.

Switching the source clears the currently-selected session and reloads the
session list from the newly active provider. A provider shows
**(unavailable)** in the dropdown, and can't be selected, if its underlying
data isn't currently reachable (e.g. no capture file found yet).

### Enabling full per-turn numbers

By default, VS Code's Copilot Chat debug log doesn't record token/cache
usage, so Analyze mode's numbers are limited until you turn on a setting.
The app checks this automatically and shows a banner explaining exactly
what's missing and how to fix it:

![The config warning banner: exact setting name, current vs. recommended value, and numbered fix steps](images/guide-config-banner.png)

Click **Dismiss** to hide it for the session; the header's **Config**
button reopens it later. See the
[README's "Enabling GitHub Copilot Chat debug logging"](../README.md#enabling-github-copilot-chat-debug-logging)
section for the exact settings.json steps. Once every check passes, the
Config button becomes a static confirmation instead of something to click:

![The Config ✓ indicator shown once every prerequisite is met](images/guide-config-ok.png)

Sessions recorded *before* you enable logging still show up in Analyze
mode — they just show em dashes for the numeric columns, the same as any
other genuinely-unknown value.

The retention check requires VS Code to keep at least a minimum number of
session logs on disk; the header's **Retention** field (VS Code source
only) shows and lets you change that minimum — it defaults to 200, but you
can raise or lower it to match how far back you actually want Analyze mode
to be able to look. Changes save automatically when you click away from
the field.

Cache-write and reasoning tokens need a *separate*, optional setting on
top of the one above — see the README's
["Enabling richer cache-write/reasoning numbers"](../README.md#enabling-richer-cache-writereasoning-numbers-optional)
section for the steps. Skipping it doesn't limit anything else — every
other Analyze mode figure works the same either way — it just leaves
those two columns showing em dashes.

### The turns table in Analyze mode

Real sessions render with the identical 13-column table Learn mode
uses — this is a real (numbers-only) example, with em dashes for the
usage figures this particular log didn't capture:

![A real Analyze session's turns table, with em dashes for unrecorded figures](images/guide-analyze-table.png)

### The three-tab right panel

Analyze mode's right column adds two tabs beyond Explanation, since real
sessions carry more detail than Learn's curated examples:

**Explanation** — same plain-language summary as Learn mode, plus a "Tool
calls this turn" section listing which tools the assistant invoked during
that specific turn:

![The Explanation tab in Analyze mode, including the tool-calls-this-turn section](images/guide-analyze-explanation.png)

When the turn's raw request/response data was captured, an **Inspect
request/response** button also appears on the Explanation tab — see
[The turn inspector](#the-turn-inspector) below.

**System prompt** — a breakdown of what made up the system prompt for
this session (base instructions, `CLAUDE.md`/repo instructions, loaded
skills, tool definitions, …), each as a labeled bar sized to its share of
the total. When the base system prompt was captured, an **Open system
prompt inspector** button appears above the breakdown:

![The System prompt tab: one bar per system-prompt component, with the Open system prompt inspector button](images/guide-analyze-systemprompt.png)

**Tools** — every tool that was loaded for the session, cross-referenced
against whether it was actually invoked and how many turns used it:

![The Tools tab: loaded-vs-invoked status for every available tool](images/guide-analyze-tools.png)

If a session has no captured system-prompt or tool-inventory data (for
example, it predates enabling debug logging), each tab shows a short
explanation instead of an empty table.

### The system prompt inspector

Click **Open system prompt inspector** on the System prompt tab to
replace the session view with a full-detail breakdown of the captured
system prompt, in three panels:

- **Structure** (left) — a nav tree of every tagged section, color-coded
  to match its highlight in the raw text.
- **Raw text** (center) — the full captured prompt, toggled between
  **Pretty** (reformatted/indented) and **Raw** (exactly as captured);
  clicking a Structure entry scrolls to and highlights that section.
- **Component description** (right) — a plain-language explanation of
  the selected section's purpose, tagged **Sourced** when it's backed by
  a citation into the Copilot Chat extension's own source, or **Not
  independently sourced** when the description is inferred from the
  captured text alone.

![The system prompt inspector: structure tree, the Preamble section selected and highlighted in the raw text, and its description](images/guide-system-prompt-inspector.png)

Click **← Back to session** to return to the turns table.

### The turn inspector

Click **Inspect request/response** on the Explanation tab for a turn to see
that turn's actual LLM request/response round-trip(s) — scoped to only the
content that turn added, not the full conversation history each round
technically resent. A row of **Round** tabs across the top lets you step
through each round trip within the turn (the same number shown in the
turns table's Rounds column); each shows one Request/Response card pair,
tool-call name/arguments/result on the request side and reasoning shown
inline where captured on the response side. Oversized text and file/image
content is collapsed into small placeholder chips instead of being dumped
inline, to keep the view readable:

![The turn inspector open on Round 0 of a 13-round turn, with tool-call request detail on the left and the model's reasoning/response on the right](images/guide-turn-inspector.png)

If a turn has no captured round-trip data (for example, it predates
enabling debug logging, or its data has since aged out), the inspector
shows an explanatory empty state instead of a blank panel.

### Searching sessions and empty states

The left column's search box works the same way in Analyze mode — filter
by title as you type. If the app can't find *any* bundled Learn scenarios
or *any* Copilot Chat sessions at all, the whole three-column layout is
replaced with a single centered message explaining what's missing:

![Zero-scenario empty state (Learn mode)](images/guide-empty-learn.png)

![Zero-session empty state (Analyze mode)](images/guide-empty-analyze.png)

For Analyze mode, this normally means you haven't run a Copilot Chat
session yet, or the app can't find your VS Code session store — reload
the page after starting a chat session in VS Code.

### Auditing tool calls

Analyze mode's center column has a **Turns / Tool audit / All sessions**
switch. It shows what the agent actually ran and why calls failed: a
missing utility, a wrong working directory, bad arguments, a missing
dependency, git state, a blocked permission, and so on. Every
classification shows the rule that matched and a short, redacted excerpt
of the real error as evidence.

**Tool audit** audits the selected session:

- **Stat tiles.** Tool calls, failure rate (computed only over calls whose
  outcome is known), shell commands, retried commands, recovery rounds, and
  output tokens spent in turns that had a failure.
- **Outcomes per turn.** Stacked columns per turn. Hover or focus a column
  for its counts, and click a column to select that turn. **Show table**
  shows the same numbers as a table.
- **Why calls failed** and **Shell programs.** Ranked bars. Click a bar to
  filter the call table below; click it again to clear the filter.
- **Tool calls table.** Filter chips by outcome, plus the command, outcome,
  exit code, and evidence for each call. **Inspect** opens the turn
  inspector.
- **Retried commands.** The same command re-run after it failed.

![Tool audit for one session](images/audit-session.png)

**All sessions** rolls the audit up over the last 7, 30, or 90 days (or
all time). It shows failures per day, top failing commands with how many
sessions they failed in, and a sessions table. Click a session to open its
own audit.

![Tool-call audit across sessions](images/audit-all-sessions.png)

Outcome data depends on the log provider. Claude Code CLI sessions record
it in full. pi records it when its `isError` flag is present. VS Code's
debug log doesn't record whether a call succeeded, so those calls show as
**Unknown**, with the reason spelled out, rather than counting as zero
failures.

### Querying the audit from Claude Code (MCP)

The same audit is available as a local, read-only MCP server, so you can
ask an agent about your own sessions ("which commands failed most this
week, and why?"). Run `npm install` in this repo, then register the server:

```bash
claude mcp add copilot-cost-analyzer -- /absolute/path/to/copilot-cost-analyzer/scripts/mcp-server.sh
```

| Tool | What it returns |
|---|---|
| `list_log_providers` | Available log sources and which one is active |
| `list_sessions` | Sessions, most recent first, optionally within a date window |
| `get_session_audit` | One session's audit. Set `includeCalls` to also get every classified call |
| `list_tool_calls` | One session's calls, filtered by status, failure category, tool, program, or turn |
| `get_audit_rollup` | Cross-session totals, top failing commands, and per-day counts |

The `audit_session` prompt asks the model to explain a session's failures
and suggest fixes. Every tool takes an optional `provider` (for example
`"claude-code"`). The server reads local logs only and writes nothing.

## License

[MIT](../LICENSE)
