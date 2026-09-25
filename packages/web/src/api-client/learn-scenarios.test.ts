import { describe, expect, it, vi, afterEach } from "vitest";
import type { Session } from "@copilot-cost-analyzer/domain";
import { fetchLearnScenario, fetchLearnScenarios } from "./learn-scenarios.js";

const scenarioSummary = { id: "cache-basics", mode: "learn" } as unknown as Session;

describe("learn-scenarios api-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the list of learn scenarios", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([scenarioSummary]),
      }),
    );

    const scenarios = await fetchLearnScenarios();

    expect(fetch).toHaveBeenCalledWith("/api/learn/scenarios");
    expect(scenarios).toEqual([scenarioSummary]);
  });

  it("fetches a single learn scenario by id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(scenarioSummary),
      }),
    );

    const scenario = await fetchLearnScenario("cache-basics");

    expect(fetch).toHaveBeenCalledWith("/api/learn/scenarios/cache-basics");
    expect(scenario).toEqual(scenarioSummary);
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );

    await expect(fetchLearnScenario("does-not-exist")).rejects.toThrow(/404/);
  });
});
