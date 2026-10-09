import { isUserMessage } from "./pi-message.js";
import type { PiRawEntry } from "./pi-jsonl-reader.js";

export interface PiTurnGroup {
  userMessageEntry: PiRawEntry;
  // Entries before the first user message (the leading system message, a
  // model_change, an early `usage` entry) — attributed to the first turn so
  // usage they carry isn't lost; always empty for every later turn. Kept
  // apart from `entries` so per-round consumers (the turn inspector, tool
  // calls) see only the turn's own span.
  precedingEntries: PiRawEntry[];
  entries: PiRawEntry[];
}

// Groups one branch's linear entry list (session-tree.ts's walkBranch output)
// into turns: everything from a user message up to (not including) the next
// user message belongs to that turn. Directly mirrors
// session-usage-spans.ts's groupEnvelopesByUserMessage, already used for the
// VS Code provider's main.jsonl turn boundaries. Entries before the first
// user message become the first turn's `precedingEntries`; with no user
// message at all there is no turn to attribute them to.
export function groupBranchEntriesByUserMessage(branchEntries: PiRawEntry[]): PiTurnGroup[] {
  const groups: PiTurnGroup[] = [];
  const leading: PiRawEntry[] = [];

  for (const entry of branchEntries) {
    if (isUserMessage(entry)) {
      groups.push({ userMessageEntry: entry, precedingEntries: groups.length === 0 ? leading : [], entries: [entry] });
      continue;
    }
    (groups.at(-1)?.entries ?? leading).push(entry);
  }

  return groups;
}
