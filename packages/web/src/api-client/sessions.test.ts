import { describe, expect, it, vi, afterEach } from "vitest";
import type { Session, TurnInspectorDetail } from "@copilot-cost-analyzer/domain";
import {
  fetchSession,
  fetchSessions,
  fetchSystemPromptText,
  fetchTurnInspectorDetail,
  systemPromptTextUrl,
} from "./sessions.js";

const sessionSummary = { id: "session-1", mode: "analyze" } as unknown as Session;
const turnDetail: TurnInspectorDetail = { turnIndex: 2, userMessage: [], rounds: [] };

describe("sessions api-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the list of sessions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([sessionSummary]),
      }),
    );

    const sessions = await fetchSessions();

    expect(fetch).toHaveBeenCalledWith("/api/sessions");
    expect(sessions).toEqual([sessionSummary]);
  });

  it("fetches a single session by id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(sessionSummary),
      }),
    );

    const session = await fetchSession("session-1");

    expect(fetch).toHaveBeenCalledWith("/api/sessions/session-1");
    expect(session).toEqual(sessionSummary);
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );

    await expect(fetchSession("does-not-exist")).rejects.toThrow(/404/);
  });

  it("builds the system-prompt text URL for a session id", () => {
    expect(systemPromptTextUrl("session-1")).toBe("/api/sessions/session-1/system-prompt");
  });

  it("fetches the raw system-prompt text for a session id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("You are an expert AI assistant.") }),
    );

    const text = await fetchSystemPromptText("session-1");

    expect(fetch).toHaveBeenCalledWith("/api/sessions/session-1/system-prompt");
    expect(text).toBe("You are an expert AI assistant.");
  });

  it("throws when fetching the system-prompt text fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchSystemPromptText("does-not-exist")).rejects.toThrow(/404/);
  });

  it("fetches a turn's inspector detail by session id and turn index", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(turnDetail) }),
    );

    const detail = await fetchTurnInspectorDetail("session-1", 2);

    expect(fetch).toHaveBeenCalledWith("/api/sessions/session-1/turns/2");
    expect(detail).toEqual(turnDetail);
  });

  it("throws when fetching turn inspector detail fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchTurnInspectorDetail("session-1", 99)).rejects.toThrow(/404/);
  });
});
