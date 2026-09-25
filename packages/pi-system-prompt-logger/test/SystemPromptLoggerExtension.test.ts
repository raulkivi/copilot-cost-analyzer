import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { SystemPromptLoggerExtension } from "../src/SystemPromptLoggerExtension.js";
import { InMemorySeenTracker } from "../src/adapters/InMemorySeenTracker.js";
import type { SystemPromptSink } from "../src/ports/SystemPromptSink.js";
import type { SystemPromptRecord } from "../src/domain/SystemPromptRecord.js";

class RecordingSink implements SystemPromptSink {
  readonly records: SystemPromptRecord[] = [];
  async write(record: SystemPromptRecord): Promise<void> {
    this.records.push(record);
  }
}

class ThrowingSink implements SystemPromptSink {
  async write(): Promise<void> {
    throw new Error("disk full");
  }
}

type PiEventHandler = (event: unknown, ctx: unknown) => unknown;

/** Minimal fake standing in for Pi's ExtensionAPI: captures the registered handler. */
function fakePi() {
  const handlers: Record<string, PiEventHandler> = {};
  return {
    on: (event: string, handler: PiEventHandler) => {
      handlers[event] = handler;
    },
    trigger: (event: string, evt: unknown, ctx: unknown) =>
      handlers[event](evt, ctx),
  };
}

function fakeCtx(sessionId: string, notify = vi.fn()) {
  return {
    cwd: "/repo",
    model: { provider: "anthropic", id: "claude-sonnet-5" },
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => `/sessions/${sessionId}.jsonl`,
    },
    ui: { notify },
  };
}

describe("SystemPromptLoggerExtension", () => {
  it("registers exactly one before_agent_start handler", () => {
    const pi = fakePi();
    const onSpy = vi.spyOn(pi, "on");
    new SystemPromptLoggerExtension({
      sink: new RecordingSink(),
      tracker: new InMemorySeenTracker(),
    }).register(pi as unknown as ExtensionAPI);

    expect(onSpy).toHaveBeenCalledTimes(1);
    expect(onSpy).toHaveBeenCalledWith(
      "before_agent_start",
      expect.any(Function),
    );
  });

  it("logs the system prompt on the first turn of a session", async () => {
    const pi = fakePi();
    const sink = new RecordingSink();
    new SystemPromptLoggerExtension({
      sink,
      tracker: new InMemorySeenTracker(),
    }).register(pi as unknown as ExtensionAPI);

    await pi.trigger(
      "before_agent_start",
      { systemPrompt: "You are Pi." },
      fakeCtx("session-1"),
    );

    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].sessionId).toBe("session-1");
    expect(sink.records[0].systemPrompt).toBe("You are Pi.");
  });

  it("does not re-log on a later turn of the same session", async () => {
    const pi = fakePi();
    const sink = new RecordingSink();
    new SystemPromptLoggerExtension({
      sink,
      tracker: new InMemorySeenTracker(),
    }).register(pi as unknown as ExtensionAPI);

    await pi.trigger(
      "before_agent_start",
      { systemPrompt: "You are Pi." },
      fakeCtx("session-1"),
    );
    await pi.trigger(
      "before_agent_start",
      { systemPrompt: "You are Pi." },
      fakeCtx("session-1"),
    );

    expect(sink.records).toHaveLength(1);
  });

  it("logs again for a different session id", async () => {
    const pi = fakePi();
    const sink = new RecordingSink();
    new SystemPromptLoggerExtension({
      sink,
      tracker: new InMemorySeenTracker(),
    }).register(pi as unknown as ExtensionAPI);

    await pi.trigger(
      "before_agent_start",
      { systemPrompt: "A" },
      fakeCtx("session-1"),
    );
    await pi.trigger(
      "before_agent_start",
      { systemPrompt: "B" },
      fakeCtx("session-2"),
    );

    expect(sink.records).toHaveLength(2);
    expect(sink.records.map((r) => r.sessionId)).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  it("does not throw when the sink fails, and notifies the user once", async () => {
    const pi = fakePi();
    new SystemPromptLoggerExtension({
      sink: new ThrowingSink(),
      tracker: new InMemorySeenTracker(),
    }).register(pi as unknown as ExtensionAPI);
    const notify = vi.fn();

    await expect(
      pi.trigger(
        "before_agent_start",
        { systemPrompt: "A" },
        fakeCtx("session-1", notify),
      ),
    ).resolves.not.toThrow();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toBe("warning");
  });

  it("does not retry a session after a failed attempt (avoids notify spam)", async () => {
    const pi = fakePi();
    new SystemPromptLoggerExtension({
      sink: new ThrowingSink(),
      tracker: new InMemorySeenTracker(),
    }).register(pi as unknown as ExtensionAPI);
    const notify = vi.fn();

    await pi.trigger(
      "before_agent_start",
      { systemPrompt: "A" },
      fakeCtx("session-1", notify),
    );
    await pi.trigger(
      "before_agent_start",
      { systemPrompt: "A" },
      fakeCtx("session-1", notify),
    );

    expect(notify).toHaveBeenCalledTimes(1);
  });
});
