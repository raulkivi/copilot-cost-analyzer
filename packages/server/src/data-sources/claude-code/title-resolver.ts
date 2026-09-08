import path from "node:path";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { isRealUserMessage } from "./turn-grouper.js";

const GENERIC_FALLBACK_TITLE = "Claude Code session";

// Cascade, each step real-data-confirmed: an `ai-title` entry (Claude Code's
// own AI-generated conversation title — several can appear across a
// session as it evolves, so the *latest* one wins), then the `slug` field
// carried by every real user entry (Claude Code's own kebab-case slug for
// the session, e.g. used for its plan-file name), then the project
// directory name, then a generic fallback.
export function resolveClaudeCodeTitle(entries: ClaudeCodeRawEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.type === "ai-title" && typeof entry.aiTitle === "string" && entry.aiTitle.length > 0) {
      return entry.aiTitle;
    }
  }

  const firstRealUserEntry = entries.find(isRealUserMessage);
  if (typeof firstRealUserEntry?.slug === "string" && firstRealUserEntry.slug.length > 0) {
    return firstRealUserEntry.slug;
  }

  if (typeof firstRealUserEntry?.cwd === "string" && firstRealUserEntry.cwd.length > 0) {
    return path.basename(firstRealUserEntry.cwd);
  }

  return GENERIC_FALLBACK_TITLE;
}
