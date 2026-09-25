# Handoff: Turn Inspector (request/response) — UX design

## Overview
`TurnInspector.tsx` and its "Inspect request/response" entry point in `ExplanationPanel.tsx` shipped with no design coverage — they aren't mentioned in `docs/design-review-2026-08-10.md`. This package designs that view and fixes issues found in the shipped implementation. Everything else is unchanged; the earlier `design_handoff_session_analyser_ux_v2` package still governs the System Prompt Inspector, Advice Export, Tool Inventory, and AI Credits work.

## About the Design Files
`Session Analyser.dc.html` is a **design reference built in HTML** (a custom component format used by the design tool) — not production code. Recreate it in React against the existing `packages/web/src/components/*` and `theme.css` tokens; reuse `Blueprint`, `Tag`, `SegmentedControl` rather than porting markup verbatim.

The mock is populated with the two real captures in `examples/` (a 3-round turn and a 6-round turn), so layout decisions are tested against real payload shapes and lengths rather than invented data.

## Fidelity
High-fidelity for layout, spacing, and interaction structure. Map colors/type to `theme.css` custom properties — don't lift literal hex values.

## Entry point
An "Inspect request/response" secondary button (`.btn.btn-secondary`, 11px, `2px 8px`) sits right-aligned in the "Tool calls this turn" header inside the Explanation panel — analyze mode only, matching the existing `onOpenTurnInspector` guard. The inspector is a full takeover that **replaces** the session grid (same as the System Prompt Inspector), not an addition below it.

## Layout

**Breadcrumb header** (identical grammar to the System Prompt Inspector so the two views feel like one family): `← Back to session` secondary button, the session title (muted, 12px), an `h4` "Turn N inspector", the trigger tag if the turn has one, and — pushed right with `margin-left:auto` — the Pretty/Raw segmented control.

**User message** — a `.blueprint` card above the rounds showing the turn's originating user message at 14px body size (not monospace; it's prose, not payload). Attachments in the message render as outline tags. The shipped component drops this entirely, which makes a turn hard to orient in: the rounds only make sense against the question that started them.

**Round selector** — a `.seg` segmented control ("Round 0", "Round 1", …) plus a muted "N rounds in this turn" count, shown only when there's more than one round. One round is displayed at a time. The shipped component stacks every round vertically with no navigation; the 6-round example is unusable that way.

**Request / Response** — a two-column `1fr 1fr` grid of `.blueprint` cards per round.
- Request card: kicker "Request · round N", then each tool call as a monospace neutral tag with **Args** and **Result** sub-labels (10px uppercase, 0.06em tracking, 55% text), then an "Added messages" section.
- Response card: kicker "Response · round N", the response parts, then a divider + "Reasoning" section when present.

**Scroll caps** — every payload block is height-capped with internal scroll: args/result 140px, added messages 260px, response 320px, reasoning 200px. Without this a single long tool result makes the two columns wildly unequal and the page endless. This is the main structural fix over the shipped version.

## Pretty / Raw toggle
Payloads are raw JSON, frequently several concatenated top-level values on one line, with tool `arguments` carrying **JSON inside a JSON string**. Two views:

- **Raw** — the literal captured bytes, untouched.
- **Pretty** — splits concatenated top-level JSON values onto their own lines, indents 2 spaces, expands embedded JSON-in-string into real nested objects (this is where most of the readability win is), and color-codes tokens.

Non-JSON prose parts are not left alone in Pretty mode: literal escape sequences (`\n`, `\t`, `\r`, `\"`, `\'`, `\\`) are **interpreted**, so the model's final answer and any markdown tables lay out properly instead of rendering as a run-on blob with visible `|\n|` artifacts. Raw mode shows those escapes literally. This belongs in the renderer, not the fixture data — any capture can carry escaped prose.

Token colors:
| Token | Color |
|---|---|
| Object keys | `--color-accent-800` |
| String values | `--color-text` |
| Numbers, booleans, null | `--color-accent-600` |
| Braces, commas, colons | `color-mix(in srgb, var(--color-text) 62%, transparent)` |

Punctuation must stay at ~62% (not lower) — structural punctuation carries meaning in a JSON view, and 45% measured ~2.6:1 at 12px monospace, below the body-text floor.

## Empty & partial states
- Session logging off → "No request/response data captured for this session — enable agentDebugLog.fileLogging.enabled and reload VS Code."
- Fetch succeeded, no rounds → "This turn made no request to the model."
- **Encrypted reasoning** — the provider commonly returns `[encrypted]` instead of reasoning text. Render this as a labeled state (Reasoning + an outline `encrypted` tag + "withheld by the provider"), not as the literal string `[encrypted]` in a `<pre>`. It's a known condition, not content.
- Attachment parts frequently have a size but **no path** (`[📄 7.0 KB]`). The chip label must fall back to size-only rather than rendering `undefined`.

## Issues found in the shipped implementation
1. **Emoji** — 🖼️/📄 in attachment chips. The design system rules out emoji; use plain outline tags with a `path · size` label (or size alone).
2. **`Turn {turnIndex} inspector` is 0-indexed** while the Explanation panel and scrubber are 1-indexed for the same turn. Note the *rounds* genuinely are 0-indexed in the capture format — keep those as-is; only the turn number needs `+ 1`.
3. **Unbounded `<pre>` in a `1fr 1fr` grid** — see scroll caps above.
4. **Args and result render as two unlabeled identical `<pre>` blocks** — no way to tell which is which.
5. **No round navigation** — endless vertical stack.
6. **No user message** — the turn's originating question isn't shown.

## Design Tokens
Reference the "Industry" tokens; don't hard-code hex. Ground `--color-bg`, text `--color-text`, accent `--color-accent` with its 100–900 ramp (`--color-accent-800` for small solid marks, `--color-accent-100` for tinted highlights), `--font-heading` (Barlow Condensed) / `--font-body` (Barlow), `.blueprint` + four `<i class="corner tl/tr/bl/br">` marks on every card, `.btn-*`, `.tag-*`, `.seg`/`.seg-opt`.

Note the known design-system bug flagged previously and still unfixed: `.card, .dialog { background: transparent; }` breaks `.dialog` over its scrim.

## Files
- `Session Analyser.dc.html` — the full mock (Learn, Analyze, System Prompt Inspector, **Turn Inspector**, Advice Export dialog, empty states)
- `styles.css` — static reference copy of the design-system tokens
- `examples/TurnInspector-Example-Compact.txt` — the 3-round capture used for turn 1
- `examples/TurnInspector-Example-Multiround.txt` — the 6-round capture used for turn 2

## How to see it in the mock
Analyze mode → "copilot-cost-analyzer — Phase 4 build" → select turn 1 or 2 → "Inspect request/response".
