import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogProviderStatus } from "@copilot-cost-analyzer/domain";
import { fetchLogProviderStatus, setActiveLogProvider } from "./log-providers.js";

const status: LogProviderStatus = {
  providers: [
    { id: "vscode", label: "VS Code", available: true },
    { id: "mitmproxy", label: "mitmproxy", available: false, unavailableReason: "not configured" },
  ],
  activeProviderId: "vscode",
};

describe("log-providers api-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the provider status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(status) }),
    );

    const result = await fetchLogProviderStatus();

    expect(fetch).toHaveBeenCalledWith("/api/log-providers");
    expect(result).toEqual(status);
  });

  it("throws when fetching the provider status fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(fetchLogProviderStatus()).rejects.toThrow(/500/);
  });

  it("PUTs the chosen provider id and returns the updated status", async () => {
    const updated = { ...status, activeProviderId: "mitmproxy" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await setActiveLogProvider("mitmproxy");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/log-providers/active",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ id: "mitmproxy" }) }),
    );
    expect(result).toEqual(updated);
  });

  it("throws when setting the active provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    await expect(setActiveLogProvider("does-not-exist")).rejects.toThrow(/400/);
  });
});
