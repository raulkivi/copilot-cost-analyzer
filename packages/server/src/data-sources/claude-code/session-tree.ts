import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";

// Claude Code's JSONL body is a `uuid`/`parentUuid` tree (forks happen on
// message-edit/resend), not an append-only flat history — same shape
// pi-agent/session-tree.ts already handles for a different agent's format,
// field names adapted (`parentId`→`parentUuid`, entry `id`→`uuid`). A
// "leaf" is any entry that is nobody's parentUuid: the tip of one branch.
export function findLeafUuids(entries: ClaudeCodeRawEntry[]): string[] {
  const parentUuids = new Set(
    entries.map((e) => e.parentUuid).filter((id): id is string => typeof id === "string"),
  );
  return entries
    .map((e) => e.uuid)
    .filter((id): id is string => typeof id === "string" && !parentUuids.has(id));
}

// Walks parentUuid back from `leafUuid` to the root (an entry whose
// parentUuid is null/missing from `entries`), returning entries in
// root-to-leaf order. Sibling branches created by a fork are naturally
// excluded, since only one parentUuid chain leads to any given leaf.
export function walkBranch(entries: ClaudeCodeRawEntry[], leafUuid: string): ClaudeCodeRawEntry[] {
  const byUuid = new Map(
    entries
      .filter((e): e is ClaudeCodeRawEntry & { uuid: string } => typeof e.uuid === "string")
      .map((e) => [e.uuid, e]),
  );

  const chain: ClaudeCodeRawEntry[] = [];
  let currentUuid: string | null | undefined = leafUuid;
  while (typeof currentUuid === "string") {
    const current = byUuid.get(currentUuid);
    if (!current) {
      break;
    }
    chain.push(current);
    currentUuid = current.parentUuid;
  }

  return chain.reverse();
}

// Unlike pi (no on-disk marker for "the" active branch — every leaf becomes
// its own Session), Claude Code writes an authoritative pointer: the most
// recently written `type: "last-prompt"` entry's `leafUuid` names the
// active branch tip directly, confirmed against real captures. Only when
// that's absent (e.g. a session with no prompts sent yet) does this fall
// back to the last-occurring leaf from findLeafUuids.
export function resolveActiveLeafUuid(entries: ClaudeCodeRawEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.type === "last-prompt" && typeof entry.leafUuid === "string") {
      return entry.leafUuid;
    }
  }
  const leaves = findLeafUuids(entries);
  return leaves.length > 0 ? leaves[leaves.length - 1] : null;
}

// Any uuid claimed as `parentUuid` by more than one other entry is a fork
// point — direct port of pi-agent's findForkPointIds, field names adapted.
// Consumers should only test a turn's own userMessageEntry.parentUuid
// against this set (mirroring pi-agent-log-provider.ts's
// triggeredEventFor), never every entry indiscriminately: a parallel
// tool-call response also produces parentUuid multiplicities in real
// Claude Code captures (one child continues the same response, another is
// that block's own tool_result), but neither child is ever a genuine new
// user turn, so checking specifically against a turn-opening user entry's
// parentUuid avoids misreporting those as "fork".
export function findForkPointIds(entries: ClaudeCodeRawEntry[]): Set<string> {
  const childCounts = new Map<string, number>();
  for (const entry of entries) {
    if (typeof entry.parentUuid === "string") {
      childCounts.set(entry.parentUuid, (childCounts.get(entry.parentUuid) ?? 0) + 1);
    }
  }
  return new Set([...childCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id));
}
