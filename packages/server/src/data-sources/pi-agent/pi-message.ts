import type { PiRawEntry } from "./pi-jsonl-reader.js";

// Shared, defensive accessors over pi's `message`-wrapped entries
// (https://pi.dev/docs/latest/session-format) — every AgentMessage variant
// is a loosely-typed object here (role plus whatever fields that role
// carries), never re-validated beyond what each caller actually reads, same
// defensive posture as main-jsonl-reader.ts's attrs handling.
export interface PiAssistantMessage {
  role: "assistant";
  model?: unknown;
  content?: unknown[];
  usage?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
  };
}

export interface PiToolResultMessage {
  role: "toolResult";
  toolCallId?: unknown;
  toolName?: unknown;
  content?: unknown;
  isError?: unknown; // pi docs schema; not yet verified against a real capture
}

export interface PiToolCallBlock {
  type: "toolCall";
  id?: unknown;
  name?: unknown;
  args?: unknown;
}

export function messageOf(entry: PiRawEntry): Record<string, unknown> | null {
  return typeof entry.message === "object" && entry.message !== null
    ? (entry.message as Record<string, unknown>)
    : null;
}

export function isUserMessage(entry: PiRawEntry): boolean {
  return messageOf(entry)?.role === "user";
}

export function assistantMessageOf(entry: PiRawEntry): PiAssistantMessage | null {
  const message = messageOf(entry);
  return message?.role === "assistant" ? (message as unknown as PiAssistantMessage) : null;
}

export function toolResultMessageOf(entry: PiRawEntry): PiToolResultMessage | null {
  const message = messageOf(entry);
  return message?.role === "toolResult" ? (message as unknown as PiToolResultMessage) : null;
}

export function findToolCallBlock(
  assistantMessages: PiAssistantMessage[],
  toolCallId: string,
): PiToolCallBlock | null {
  for (const message of assistantMessages) {
    for (const block of message.content ?? []) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "toolCall" &&
        (block as { id?: unknown }).id === toolCallId
      ) {
        return block as PiToolCallBlock;
      }
    }
  }
  return null;
}
