import type { MessageContentPart, TurnInspectorDetail } from "@copilot-cost-analyzer/domain";
import type { JsonlEnvelope } from "../../jsonl/main-jsonl-reader.js";
import { buildContentPart } from "../build-content-parts.js";

type Round = TurnInspectorDetail["rounds"][number];
type RequestRound = Round["request"];
type ResponseRound = Round["response"];

function partsOrEmpty(raw: unknown): MessageContentPart[] {
  return raw === undefined ? [] : [buildContentPart(raw)];
}

// Confirmed against this machine's own real, unredacted main.jsonl: both
// `llm_request.attrs.inputMessages` and `agent_response.attrs.response` are
// JSON-*encoded strings* of a message array (`[{role, parts: [...]}, ...]`),
// not raw arrays — a second layer of stringification on top of the
// already-JSON `main.jsonl` line. Returns null (not a throw) for anything
// that isn't a JSON-encoded array, so callers can fall back to best-effort
// raw-text display for an older/unrecognized shape.
function parseMessageArray(raw: unknown): unknown[] | null {
  const value = typeof raw === "string" ? tryParseJson(raw) : raw;
  return Array.isArray(value) ? value : null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// A message's real shape (confirmed live) is `{ role, parts: [...] }`, each
// part `{ type, ... }` — "text"/"reasoning" parts carry a `content` string,
// "tool_call"/"tool_call_response" parts carry structured fields instead
// (id, name, arguments / response) with no single string field, so those
// are stringified whole via buildContentPart's own defensive fallback.
function partToContentPart(part: unknown): MessageContentPart {
  if (typeof part === "object" && part !== null) {
    const obj = part as Record<string, unknown>;
    if ((obj.type === "text" || obj.type === "reasoning") && typeof obj.content === "string") {
      return buildContentPart(obj.content);
    }
  }
  return buildContentPart(part);
}

function messageToContentParts(message: unknown): MessageContentPart[] {
  if (typeof message === "object" && message !== null) {
    const parts = (message as Record<string, unknown>).parts;
    if (Array.isArray(parts)) {
      return parts.map(partToContentPart);
    }
  }
  // Older/unrecognized shape — best-effort rather than silently dropped.
  return [buildContentPart(message)];
}

function responseContentParts(raw: unknown): MessageContentPart[] {
  const messages = parseMessageArray(raw);
  if (messages) {
    return messages.flatMap(messageToContentParts);
  }
  return partsOrEmpty(raw);
}

function buildToolCallPart(envelope: JsonlEnvelope): Round["request"]["toolCalls"][number] {
  const name = envelope.name ?? "unknown tool";
  const args = envelope.attrs?.args;
  const result = envelope.attrs?.result;
  return {
    name,
    args: args === undefined ? [] : [buildContentPart(args, { toolName: name })],
    result: result === undefined ? [] : [buildContentPart(result, { toolName: name })],
  };
}

// envelopes -> TurnInspectorDetail: splits the span into rounds at each
// llm_request/agent_response pair; tool calls
// between one agent_response and the next llm_request belong to the round
// that follows, matching the log's own ordering.
export function buildTurnInspectorDetail(
  turnIndex: number,
  turnEnvelopes: JsonlEnvelope[],
  previousInputMessagesLength: number,
): TurnInspectorDetail {
  const first = turnEnvelopes[0];
  const userMessage =
    first?.type === "user_message" ? partsOrEmpty(first.attrs?.content) : [];

  const rounds: Round[] = [];
  let pendingToolCalls: RequestRound["toolCalls"] = [];
  let pendingRequest: RequestRound | null = null;
  let prevLength = previousInputMessagesLength;
  let roundIndex = 0;

  for (const envelope of turnEnvelopes) {
    if (envelope.type === "tool_call") {
      pendingToolCalls.push(buildToolCallPart(envelope));
      continue;
    }

    if (envelope.type === "llm_request") {
      const rawInputMessages = envelope.attrs?.inputMessages;
      const messages = parseMessageArray(rawInputMessages);
      pendingRequest = {
        index: roundIndex,
        addedMessages: messages
          ? messages.slice(prevLength).flatMap(messageToContentParts)
          : partsOrEmpty(rawInputMessages),
        toolCalls: pendingToolCalls,
      };
      pendingToolCalls = [];
      if (messages) {
        prevLength = messages.length;
      }
      continue;
    }

    if (envelope.type === "agent_response" && pendingRequest) {
      const reasoning = envelope.attrs?.reasoning;
      const response: ResponseRound = {
        index: roundIndex,
        response: responseContentParts(envelope.attrs?.response),
        ...(reasoning !== undefined ? { reasoning: partsOrEmpty(reasoning) } : {}),
      };
      rounds.push({ request: pendingRequest, response });
      pendingRequest = null;
      roundIndex += 1;
    }
  }

  return { turnIndex, userMessage, rounds };
}
