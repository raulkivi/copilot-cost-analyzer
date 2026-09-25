import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildSystemPromptRecord } from "./domain/buildSystemPromptRecord.js";
import type { SeenSessionTracker } from "./ports/SeenSessionTracker.js";
import type { SystemPromptSink } from "./ports/SystemPromptSink.js";

export interface SystemPromptLoggerDeps {
  sink: SystemPromptSink;
  tracker: SeenSessionTracker;
}

/**
 * Orchestrates capture-once-per-session logging of Pi's assembled system
 * prompt. Depends only on the SystemPromptSink / SeenSessionTracker ports —
 * never on node:fs or a concrete storage mechanism (DIP). The only concrete
 * framework type it touches is ExtensionAPI, because that is the actual
 * attachment point Pi provides; everything below `register` is pure and
 * unit-tested without a running Pi process.
 */
export class SystemPromptLoggerExtension {
  constructor(private readonly deps: SystemPromptLoggerDeps) {}

  register(pi: ExtensionAPI): void {
    pi.on("before_agent_start", async (event, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId();
      if (this.deps.tracker.hasSeen(sessionId)) {
        return;
      }
      // Mark seen before attempting the write: we log at most once per
      // session, on success or failure, so a persistent sink failure
      // notifies the user once instead of spamming every turn.
      this.deps.tracker.markSeen(sessionId);

      try {
        const record = buildSystemPromptRecord(event, ctx);
        await this.deps.sink.write(record);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `pi-system-prompt-logger: failed to log system prompt (${message})`,
          "warning",
        );
      }
    });
  }
}
