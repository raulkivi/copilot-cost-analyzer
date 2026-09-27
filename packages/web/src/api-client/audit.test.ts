import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAuditRollup, fetchSessionAudit } from "./audit.js";

function stubFetch(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));
}

describe("audit api-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches one session's audit", async () => {
    stubFetch({ sessionId: "s1" });
    await expect(fetchSessionAudit("s1")).resolves.toEqual({ sessionId: "s1" });
    expect(fetch).toHaveBeenCalledWith("/api/sessions/s1/audit");
  });

  it("encodes the session id", async () => {
    stubFetch({});
    await fetchSessionAudit("a/b");
    expect(fetch).toHaveBeenCalledWith("/api/sessions/a%2Fb/audit");
  });

  it("fetches a rollup with only the filters that are set", async () => {
    stubFetch({ sessionCount: 0 });
    await fetchAuditRollup({ since: "2026-09-01", limit: 100 });
    expect(fetch).toHaveBeenCalledWith("/api/audit?since=2026-09-01&limit=100");
  });

  it("fetches an unfiltered rollup", async () => {
    stubFetch({ sessionCount: 0 });
    await fetchAuditRollup({});
    expect(fetch).toHaveBeenCalledWith("/api/audit");
  });
});
