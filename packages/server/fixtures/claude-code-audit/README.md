# Claude Code audit fixture

`bash-failures-session.jsonl` is derived from a **real** Claude Code CLI
session transcript (v2.1.x, captured 2026-09-27), sanitized: paths rewritten
to `/home/dev/project`, ids shortened, session id replaced, harness-internal
fields dropped. Turn 0 is verbatim in shape and content: ten parallel
`tool_use` blocks in one assistant message, each `tool_result` parented to
its own `tool_use` entry, so nine of the ten results sit **off** the active
branch (`last-prompt.leafUuid` walk). Tool results carry `is_error`, an
`Exit code N` first line, and a string `toolUseResult` (`"Error: …"`) on
failure, or `{stdout, stderr, interrupted, isImage, noOutputExpected}` on
success.

Turn 1 copies the confirmed shapes onto new entries (a harness timeout
captured in the same session, `Exit code 143\nCommand timed out after 2s`,
plus a retry of the missing command and a follow-up probe) so that retry
detection has sequential, on-branch data to exercise.
