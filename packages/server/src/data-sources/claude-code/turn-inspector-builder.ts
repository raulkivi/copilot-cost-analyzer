import type { MessageContentPart, TurnInspectorDetail } from "@copilot-cost-analyzer/domain";
import { buildContentPart } from "../log-providers/build-content-parts.js";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { findToolResultFor, groupTurnEntriesByRound } from "./round-grouper.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";

function messageOf(entry: ClaudeCodeRawEntry): Record<string, unknown> | null {
  return typeof entry.message === "object" && entry.message !== null
    ? (entry.message as Record<string, unknown>)
    : null;
}

function isThinkingBlock(block: unknown): boolean {
  return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "thinking";
}

function isToolUseBlock(block: unknown): block is { type: "tool_use"; id?: unknown; name?: unknown; input?: unknown } {
  return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "tool_use";
}

function isToolResultBlock(block: unknown): boolean {
  return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "tool_result";
}

// A content block's own text, for the shapes confirmed against real
// captures: `{ type: "text", text }` and `{ type: "thinking", thinking }`
// use different field names for the same idea. Falls back to the raw block
// for anything else rather than guessing further.
function blockText(block: unknown): unknown {
  if (typeof block === "object" && block !== null) {
    const withText = block as { text?: unknown; thinking?: unknown };
    return withText.text ?? withText.thinking ?? block;
  }
  return block;
}

function contentBlocksOf(entry: ClaudeCodeRawEntry): unknown[] {
  const content = messageOf(entry)?.content;
  return Array.isArray(content) ? content : [];
}

// A real `attachment` entry's actual injected text (e.g. an `@file`
// reference's content) rather than the whole `{ type: "file", filename,
// content: { file: { filePath, content } } }` envelope, so buildContentPart
// sizes/placeholders the real text, not JSON padding around it.
function attachmentContentOf(entry: ClaudeCodeRawEntry): unknown {
  const attachment = entry.attachment as Record<string, unknown> | undefined;
  const content = attachment?.content as Record<string, unknown> | undefined;
  const file = content?.file as Record<string, unknown> | undefined;
  if (file && typeof file.content === "string") {
    return file.content;
  }
  return attachment ?? entry;
}

function buildUserMessageParts(entry: ClaudeCodeRawEntry): MessageContentPart[] {
  const content = messageOf(entry)?.content;
  if (typeof content === "string") {
    return [buildContentPart(content)];
  }
  if (Array.isArray(content)) {
    return content.filter((block) => !isToolResultBlock(block)).map((block) => buildContentPart(blockText(block)));
  }
  return [];
}

// Prefers the richer `toolUseResult` sibling field (present on the
// tool_result-delivery `user` entry itself, alongside `message`) over the
// raw `tool_result` content block, per the plan's decision — real captures
// show it often carries more structure (e.g. a Read call's `{ type, file:
// { filePath, content } }`) than the inline content block.
function resultContentOf(resultEntry: ClaudeCodeRawEntry | undefined, toolUseId: string): unknown {
  if (!resultEntry) {
    return null;
  }
  if (resultEntry.toolUseResult !== undefined) {
    return resultEntry.toolUseResult;
  }
  const block = contentBlocksOf(resultEntry).find(
    (candidate) =>
      isToolResultBlock(candidate) && (candidate as { tool_use_id?: unknown }).tool_use_id === toolUseId,
  ) as { content?: unknown } | undefined;
  return block?.content ?? null;
}

// No pi equivalent for `userMessage` (pi's own builder ships it empty) —
// this follows the vscode builder's precedent of actually populating it,
// since Claude Code's real user entry carries the text directly (unlike
// pi's incremental-but-still-per-entry format, this needed no extra
// justification once the field existed to fill).
export function buildTurnInspectorDetail(turnIndex: number, group: ClaudeCodeTurnGroup): TurnInspectorDetail {
  const userMessage = buildUserMessageParts(group.userMessageEntry);
  const rounds = groupTurnEntriesByRound(group.entries);

  if (rounds.length === 0) {
    return { turnIndex, userMessage, rounds: [] };
  }

  const entries = group.entries;
  const firstIndexOfRound = rounds.map((round) => entries.indexOf(round.entries[0]));
  const lastIndexOfRound = rounds.map((round) => entries.indexOf(round.entries[round.entries.length - 1]));
  const userMessageIndex = entries.indexOf(group.userMessageEntry);

  const detailRounds = rounds.map((round, roundIndex) => {
    const previousBoundary = roundIndex === 0 ? userMessageIndex + 1 : lastIndexOfRound[roundIndex - 1] + 1;
    const gapEntries = entries.slice(previousBoundary, firstIndexOfRound[roundIndex]);
    const addedMessages = gapEntries
      .filter((entry) => entry.type === "attachment")
      .map((entry) => buildContentPart(attachmentContentOf(entry)));

    const blocks = round.entries.flatMap((entry) => contentBlocksOf(entry));
    const toolUseBlocks = blocks.filter(isToolUseBlock);
    const thinkingBlocks = blocks.filter(isThinkingBlock);
    const responseBlocks = blocks.filter((block) => !isThinkingBlock(block) && !isToolUseBlock(block));

    const toolCalls = toolUseBlocks.map((block) => {
      const toolUseId = typeof block.id === "string" ? block.id : undefined;
      const resultEntry = toolUseId ? findToolResultFor(entries, toolUseId) : undefined;
      return {
        name: typeof block.name === "string" ? block.name : "unknown",
        args: [buildContentPart(block.input ?? null)],
        result: [buildContentPart(toolUseId ? resultContentOf(resultEntry, toolUseId) : null)],
      };
    });

    return {
      request: { index: roundIndex, addedMessages, toolCalls },
      response: {
        index: roundIndex,
        response: responseBlocks.map((block) => buildContentPart(blockText(block))),
        ...(thinkingBlocks.length > 0
          ? { reasoning: thinkingBlocks.map((block) => buildContentPart(blockText(block))) }
          : {}),
      },
    };
  });

  return { turnIndex, userMessage, rounds: detailRounds };
}
