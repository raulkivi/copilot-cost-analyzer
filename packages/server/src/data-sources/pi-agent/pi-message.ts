import type { PiRawEntry } from "./pi-jsonl-reader.js";

// Shared, defensive accessors over pi's `message`-wrapped entries
// (https://pi.dev/docs/latest/session-format) — every AgentMessage variant
// is a loosely-typed object here (role plus whatever fields that role
// carries), never re-validated beyond what each caller actually reads, same
// defensive posture as main-jsonl-reader.ts's attrs handling.
// pi-ai's `Usage` (dist/types.d.ts; docs/message-types.md "Usage"):
// `reasoning` is optional and already included in `output`.
export interface PiUsage {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  reasoning?: unknown;
}

export interface PiAssistantMessage {
  role: "assistant";
  model?: unknown;
  content?: unknown[];
  usage?: PiUsage;
}

export interface PiToolResultMessage {
  role: "toolResult";
  toolCallId?: unknown;
  toolName?: unknown;
  content?: unknown;
  isError?: unknown;
  usage?: PiUsage; // optional: nested model work the tool performed
}

export interface PiToolCallBlock {
  type: "toolCall";
  id?: unknown;
  name?: unknown;
  arguments?: unknown; // published schema (docs/message-types.md "ToolCall")
  args?: unknown; // pre-schema fixtures named it `args`; read as a fallback only
}

export function toolCallArgumentsOf(block: PiToolCallBlock | null): unknown {
  return block ? (block.arguments ?? block.args) : undefined;
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
