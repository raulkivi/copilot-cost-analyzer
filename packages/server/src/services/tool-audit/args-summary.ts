import type { ToolKind } from "@copilot-cost-analyzer/domain";
import { excerptOf } from "./output-redactor.js";

// Bounded, redacted one-line description of a tool call's input (plan F7):
// GET /api/sessions/:id sends every turn's tool calls up front, so this
// must never carry a Write/Edit's whole file content — the full payload
// stays behind the on-demand turn-inspector endpoint.
export const MAX_ARGS_SUMMARY_LENGTH = 300;

const PATH_KEYS = ["file_path", "filePath", "path", "notebook_path", "uri"];

function stringField(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function describe(kind: ToolKind, input: Record<string, unknown>): string {
  if (kind === "shell") {
    const command = stringField(input, ["command", "cmd", "script"]);
    if (command) {
      return command;
    }
  }
  if (kind === "file-read" || kind === "file-write") {
    const filePath = stringField(input, PATH_KEYS);
    if (filePath) {
      return filePath;
    }
  }
  if (kind === "search") {
    const pattern = stringField(input, ["pattern", "query", "glob"]);
    const where = stringField(input, PATH_KEYS);
    if (pattern) {
      return where ? `${pattern} in ${where}` : pattern;
    }
  }
  if (kind === "web") {
    const target = stringField(input, ["url", "query"]);
    if (target) {
      return target;
    }
  }
  return JSON.stringify(input);
}

export function summarizeToolArgs(kind: ToolKind, input: unknown): string {
  if (input === undefined || input === null) {
    return "";
  }
  const text = typeof input === "object" ? describe(kind, input as Record<string, unknown>) : String(input);
  return excerptOf(text, MAX_ARGS_SUMMARY_LENGTH);
}
