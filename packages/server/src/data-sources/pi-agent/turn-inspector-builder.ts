import type { TurnInspectorDetail } from "@copilot-cost-analyzer/domain";
import { buildContentPart } from "../log-providers/build-content-parts.js";
import { assistantMessageOf, findToolCallBlock, messageOf, toolResultMessageOf, type PiAssistantMessage } from "./pi-message.js";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import type { PiTurnGroup } from "./turn-grouper.js";

function isThinkingBlock(block: unknown): boolean {
  return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "thinking";
}

// A content block's own text field, when present, so the wrapping
// `{ type, ... }` envelope isn't stringified alongside the actual text.
// Falls back to the raw block for shapes not yet confirmed against a real
// captured session (see usage-extractor.ts's UNCONFIRMED_REASON note).
function blockText(block: unknown): unknown {
  if (typeof block === "object" && block !== null) {
    const withText = block as { text?: unknown; content?: unknown };
    return withText.text ?? withText.content ?? block;
  }
  return block;
}

function entryText(entry: PiRawEntry): unknown {
  const message = messageOf(entry);
  if (!message) {
    return entry;
  }
  return typeof message.content === "string" ? message.content : (message.content ?? message);
}

// pi's JSONL entries are already incremental (each is only its own new
// content), unlike VS Code's main.jsonl where every round re-sends the
// entire cumulative conversation — so unlike turn-inspector-builder.ts's VS
// Code counterpart, no array-length diffing is needed here: one round per
// AssistantMessage, and "added since the previous round" is just the
// entries between the previous assistant message (exclusive) and this one.
export function buildTurnInspectorDetail(turnIndex: number, group: PiTurnGroup): TurnInspectorDetail {
  const assistantIndices = group.entries
    .map((entry, index) => (assistantMessageOf(entry) ? index : -1))
    .filter((index) => index !== -1);

  if (assistantIndices.length === 0) {
    return { turnIndex, userMessage: [], rounds: [] };
  }

  const assistantMessages = assistantIndices.map(
    (index) => assistantMessageOf(group.entries[index]) as PiAssistantMessage,
  );

  const rounds = assistantIndices.map((assistantIndex, roundIndex) => {
    const previousBoundary = roundIndex === 0 ? 0 : assistantIndices[roundIndex - 1] + 1;
    const addedEntries = group.entries.slice(previousBoundary, assistantIndex);

    const toolCalls = addedEntries.flatMap((entry) => {
      const toolResult = toolResultMessageOf(entry);
      if (!toolResult) {
        return [];
      }
      const toolCallId = typeof toolResult.toolCallId === "string" ? toolResult.toolCallId : undefined;
      const block = toolCallId ? findToolCallBlock(assistantMessages, toolCallId) : null;
      return [
        {
          name: typeof toolResult.toolName === "string" ? toolResult.toolName : "unknown",
          args: [buildContentPart(block?.args ?? null)],
          result: [buildContentPart(toolResult.content ?? null)],
        },
      ];
    });

    const addedMessages = addedEntries
      .filter((entry) => !toolResultMessageOf(entry))
      .map((entry) => buildContentPart(entryText(entry)));

    const contentBlocks = assistantMessages[roundIndex].content ?? [];
    const reasoningParts = contentBlocks.filter(isThinkingBlock).map((block) => buildContentPart(blockText(block)));
    const responseParts = contentBlocks
      .filter((block) => !isThinkingBlock(block))
      .map((block) => buildContentPart(blockText(block)));

    return {
      request: { index: roundIndex, addedMessages, toolCalls },
      response: {
        index: roundIndex,
        response: responseParts,
        ...(reasoningParts.length > 0 ? { reasoning: reasoningParts } : {}),
      },
    };
  });

  return { turnIndex, userMessage: [], rounds };
}
