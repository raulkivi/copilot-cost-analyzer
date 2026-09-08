import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";

export interface ClaudeCodeRound {
  messageId: string;
  entries: ClaudeCodeRawEntry[];
}

function messageOf(entry: ClaudeCodeRawEntry): Record<string, unknown> | null {
  return typeof entry.message === "object" && entry.message !== null
    ? (entry.message as Record<string, unknown>)
    : null;
}

function assistantMessageIdOf(entry: ClaudeCodeRawEntry): string | undefined {
  if (entry.type !== "assistant") {
    return undefined;
  }
  const id = messageOf(entry)?.id;
  return typeof id === "string" ? id : undefined;
}

// No pi equivalent — this absorbs the real structural difference between
// the two agents' JSONL shapes: pi writes one JSONL entry per assistant
// response, but Claude Code writes one *line per content block* of a
// response, chained by parentUuid and sharing one `message.id`. Under
// parallel tool calls, a tool-result `user` line for an earlier block in
// the same response can appear *between* that block and the next one —
// confirmed against a real captured session (this repo's own logs): four
// `tool_use` blocks of a single response, each immediately followed by its
// own `tool_result` line, all four still sharing one `message.id`. Line
// adjacency therefore cannot define a "round" — grouping by `message.id`
// can, since it survives that interleaving. Rounds are emitted in order of
// each message.id's first appearance among `turnEntries`.
export function groupTurnEntriesByRound(turnEntries: ClaudeCodeRawEntry[]): ClaudeCodeRound[] {
  const rounds: ClaudeCodeRound[] = [];
  const roundByMessageId = new Map<string, ClaudeCodeRound>();

  for (const entry of turnEntries) {
    const messageId = assistantMessageIdOf(entry);
    if (!messageId) {
      continue;
    }
    let round = roundByMessageId.get(messageId);
    if (!round) {
      round = { messageId, entries: [] };
      roundByMessageId.set(messageId, round);
      rounds.push(round);
    }
    round.entries.push(entry);
  }

  return rounds;
}

// Scans every `type: "user"` entry in the turn for a `tool_result` content
// block whose `tool_use_id` matches — a plain linear scan (not scoped to
// one round) since, per the interleaving above, a tool_use block's result
// can sit between two other blocks of the *same* response, not necessarily
// right after the block that requested it relative to other rounds.
export function findToolResultFor(turnEntries: ClaudeCodeRawEntry[], toolUseId: string): ClaudeCodeRawEntry | undefined {
  return turnEntries.find((entry) => {
    if (entry.type !== "user") {
      return false;
    }
    const content = messageOf(entry)?.content;
    return (
      Array.isArray(content) &&
      content.some(
        (block) =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "tool_result" &&
          (block as { tool_use_id?: unknown }).tool_use_id === toolUseId,
      )
    );
  });
}
