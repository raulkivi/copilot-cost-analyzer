import type { MessageContentPart } from "@copilot-cost-analyzer/domain";

// Provider-neutral placeholder detection, shared by VscodeLogProvider's
// per-round message diffing and MitmproxyLogProvider's raw-exchange text —
// neither `main.jsonl`'s
// `inputMessages`/`args`/`result` nor a HAR body has a documented, stable
// schema, so this defensively handles arbitrary shapes rather than assuming
// one.
export const PLACEHOLDER_THRESHOLD_CHARS = 2000;

// Only tools confirmed, from a real captured fixture, to read a file by
// path — pi's `read_file`, and Claude Code CLI's own `Read` tool (confirmed
// against real `~/.claude/projects` captures). Extend as more are
// confirmed rather than guessing further tool names.
const FILE_READING_TOOL_NAMES = new Set(["read_file", "Read"]);

const PATH_KEYS = ["path", "filePath", "file_path", "uri"];

export interface BuildContentPartContext {
  toolName?: string;
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

// Best-effort — no real captured `inputMessages` payload with an image has
// been found on this machine to confirm the shape against. Matches common
// chat-message content-block
// conventions (a `type: "image"` block, or a raw data-URI string).
function detectImagePlaceholder(value: unknown): MessageContentPart | null {
  if (typeof value === "string") {
    return /^data:image\//.test(value.trim()) ? { placeholder: true, kind: "image" } : null;
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (obj.type === "image") {
      return { placeholder: true, kind: "image" };
    }
    if (typeof obj.image_url === "object" && obj.image_url !== null) {
      return { placeholder: true, kind: "image" };
    }
    const source = obj.source;
    if (typeof source === "object" && source !== null && (source as Record<string, unknown>).type === "base64") {
      return { placeholder: true, kind: "image" };
    }
  }
  return null;
}

function extractPath(value: unknown): string | undefined {
  let candidate: unknown = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
  if (typeof candidate !== "object" || candidate === null) {
    return undefined;
  }
  const obj = candidate as Record<string, unknown>;
  for (const key of PATH_KEYS) {
    if (typeof obj[key] === "string") {
      return obj[key] as string;
    }
  }
  return undefined;
}

// Two independent signals, in order: image detection first, then size (the
// safety net — always applied, regardless of what produced the content),
// then shape (a known file-reading tool's path, useful even under the size
// threshold).
export function buildContentPart(
  value: unknown,
  context: BuildContentPartContext = {},
): MessageContentPart {
  const imagePlaceholder = detectImagePlaceholder(value);
  if (imagePlaceholder) {
    return imagePlaceholder;
  }

  const text = stringifyContent(value);
  const path =
    context.toolName && FILE_READING_TOOL_NAMES.has(context.toolName) ? extractPath(value) : undefined;

  if (path !== undefined || text.length > PLACEHOLDER_THRESHOLD_CHARS) {
    return {
      placeholder: true,
      kind: "file",
      ...(path !== undefined ? { path } : {}),
      sizeBytes: byteLength(text),
    };
  }

  return { kind: "text", text };
}
