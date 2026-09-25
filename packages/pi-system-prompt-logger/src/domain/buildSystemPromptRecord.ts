import type { SystemPromptRecord } from "./SystemPromptRecord.js";

/**
 * The slice of BeforeAgentStartEvent this module actually needs.
 * Deliberately structural (not imported from @earendil-works/pi-coding-agent)
 * so this module has zero dependency on the Pi runtime and stays trivially
 * unit-testable. Real BeforeAgentStartEvent objects satisfy this shape.
 */
export interface SystemPromptEventInput {
  systemPrompt: string;
  systemPromptOptions?: {
    selectedTools?: string[];
    skills?: Array<{ name: string }>;
    contextFiles?: Array<{ path: string }>;
  };
}

/**
 * The slice of ExtensionContext this module actually needs.
 */
export interface SystemPromptContextInput {
  cwd: string;
  model?: { provider?: string; id?: string };
  sessionManager: {
    getSessionId(): string;
    getSessionFile(): string | undefined;
  };
}

export function buildSystemPromptRecord(
  event: SystemPromptEventInput,
  ctx: SystemPromptContextInput,
  now: () => Date = () => new Date(),
): SystemPromptRecord {
  const options = event.systemPromptOptions;

  return {
    sessionId: ctx.sessionManager.getSessionId(),
    sessionFile: ctx.sessionManager.getSessionFile(),
    capturedAt: now().toISOString(),
    cwd: ctx.cwd,
    provider: ctx.model?.provider,
    modelId: ctx.model?.id,
    systemPromptChars: event.systemPrompt.length,
    systemPrompt: event.systemPrompt,
    selectedTools: options?.selectedTools,
    skillNames: options?.skills?.map((skill) => skill.name),
    contextFilePaths: options?.contextFiles?.map((file) => file.path),
  };
}
