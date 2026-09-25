import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { InMemorySeenTracker } from "./adapters/InMemorySeenTracker.js";
import { JsonlFileSink } from "./adapters/JsonlFileSink.js";
import { NodeFileSystem } from "./adapters/NodeFileSystem.js";
import { SystemPromptLoggerExtension } from "./SystemPromptLoggerExtension.js";

function defaultLogPath(): string {
  return (
    process.env.PI_SYSTEM_PROMPT_LOG_PATH ??
    join(homedir(), ".pi", "agent", "logs", "system-prompts.jsonl")
  );
}

export default function (pi: ExtensionAPI) {
  const sink = new JsonlFileSink(defaultLogPath(), new NodeFileSystem());
  const tracker = new InMemorySeenTracker();
  new SystemPromptLoggerExtension({ sink, tracker }).register(pi);
}
