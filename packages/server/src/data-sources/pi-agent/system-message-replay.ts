import { messageOf } from "./pi-message.js";
import type { PiRawEntry } from "./pi-jsonl-reader.js";

// pi-ai's `Tool` declaration (dist/types.d.ts) as persisted in a system
// message's `toolsAdded`.
export interface PiToolDeclaration {
  name: string;
  description?: unknown;
  parameters?: unknown;
}

export interface PiSystemPromptState {
  // Every system message's `content`, in order, joined by a blank line.
  baseContent: string;
  // Current named sections, in declaration order (removed ones dropped).
  sections: Array<{ name: string; text: string }>;
  // The complete prompt as pi renders it: base content then each section,
  // non-empty parts joined by a blank line.
  text: string;
  // Tools available at the end of the branch.
  tools: PiToolDeclaration[];
  // Every tool declared anywhere on the branch, in first-declaration order —
  // a tool can be removed mid-session after being available (and used).
  declaredToolNames: string[];
}

interface MutableState {
  content: string[];
  sections: Map<string, string>;
  tools: Map<string, PiToolDeclaration>;
}

function emptyState(): MutableState {
  return { content: [], sections: new Map(), tools: new Map() };
}

function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((block) => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text")
    .map((block) => (block as { text?: unknown }).text)
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

function toolsIn(value: unknown): PiToolDeclaration[] {
  return Array.isArray(value)
    ? value.filter(
        (tool): tool is PiToolDeclaration =>
          typeof tool === "object" && tool !== null && typeof (tool as { name?: unknown }).name === "string",
      )
    : [];
}

function applySystemMessage(state: MutableState, message: Record<string, unknown>, declared: Set<string>): void {
  const text = contentText(message.content);
  if (text.length > 0) {
    state.content.push(text);
  }
  if (typeof message.sections === "object" && message.sections !== null) {
    for (const [name, value] of Object.entries(message.sections as Record<string, unknown>)) {
      if (value === null) {
        state.sections.delete(name);
      } else if (typeof value === "string") {
        state.sections.set(name, value);
      }
    }
  }
  for (const tool of toolsIn(message.toolsRemoved)) {
    state.tools.delete(tool.name);
  }
  for (const tool of toolsIn(message.toolsAdded)) {
    state.tools.set(tool.name, tool);
    declared.add(tool.name);
  }
}

function systemMessageOf(entry: PiRawEntry): { message: Record<string, unknown>; isBaseline: boolean } | null {
  const message = messageOf(entry);
  if (entry.type === "message" && message?.role === "system") {
    return { message, isBaseline: message.replace === true };
  }
  // A compaction's `systemMessage` is a complete prompt/tool checkpoint that
  // supersedes every earlier system message (docs/session-format.md
  // "CompactionEntry"); absent on older sessions.
  if (entry.type === "compaction" && typeof entry.systemMessage === "object" && entry.systemMessage !== null) {
    return { message: entry.systemMessage as Record<string, unknown>, isBaseline: true };
  }
  return null;
}

// Replays one branch's system messages into the current system prompt and
// tool set, the way pi itself does (pi-ai's getCurrentSystemMessage /
// getSystemMessageText in dist/utils/transcript.js and dist/utils/text.js):
// later `content` is appended, `sections` are patched by name (`null`
// removes one), `toolsRemoved` then `toolsAdded` are applied by name, and a
// `replace: true` message or a compaction checkpoint resets to a new
// baseline. Returns null when the branch has no system message at all
// (sessions recorded before pi persisted them).
export function replaySystemMessages(branch: PiRawEntry[]): PiSystemPromptState | null {
  let state: MutableState | null = null;
  const declared = new Set<string>();

  for (const entry of branch) {
    const systemMessage = systemMessageOf(entry);
    if (!systemMessage) {
      continue;
    }
    if (state === null || systemMessage.isBaseline) {
      state = emptyState();
    }
    applySystemMessage(state, systemMessage.message, declared);
  }

  if (state === null) {
    return null;
  }

  const baseContent = state.content.join("\n\n");
  const sections = [...state.sections.entries()].map(([name, text]) => ({ name, text }));
  return {
    baseContent,
    sections,
    text: [baseContent, ...sections.map((section) => section.text)].filter((part) => part.length > 0).join("\n\n"),
    tools: [...state.tools.values()],
    declaredToolNames: [...declared],
  };
}
