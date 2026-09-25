import { describe, expect, it, vi, afterEach } from "vitest";
import type { ConfigStatus } from "@copilot-cost-analyzer/domain";
import { fetchConfigStatus, updateRetentionThreshold } from "./config-status.js";

const status = {
  checkedAt: "2026-08-08T00:00:00.000Z",
  vscodeUserSettingsPath: null,
  loggingEnabled: false,
  maxRetainedSessionLogs: null,
  minRetainedSessionLogsThreshold: 200,
  warnings: [],
} as unknown as ConfigStatus;

describe("config-status api-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the config status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(status) }),
    );

    const result = await fetchConfigStatus();

    expect(fetch).toHaveBeenCalledWith("/api/config/status");
    expect(result).toEqual(status);
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(fetchConfigStatus()).rejects.toThrow(/500/);
  });

  it("PUTs the chosen retention threshold and returns the updated status", async () => {
    const updated = { ...status, minRetainedSessionLogsThreshold: 300 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateRetentionThreshold(300);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/config/retention-threshold",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ value: 300 }) }),
    );
    expect(result).toEqual(updated);
  });

  it("throws when updating the retention threshold fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    await expect(updateRetentionThreshold(300)).rejects.toThrow(/400/);
  });
});
