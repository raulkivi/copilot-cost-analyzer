import { describe, expect, it } from "vitest";
import { sessionSchema } from "@copilot-cost-analyzer/domain";
import { getLearnScenario, listLearnScenarios } from "./loader.js";

describe("learn-scenarios loader", () => {
  it("lists bundled scenarios as valid learn-mode Sessions", () => {
    const scenarios = listLearnScenarios();

    expect(scenarios.length).toBeGreaterThanOrEqual(18);
    for (const scenario of scenarios) {
      expect(() => sessionSchema.parse(scenario)).not.toThrow();
      expect(scenario.mode).toBe("learn");
      expect(scenario.turns.length).toBeGreaterThan(0);
    }
  });

  it("returns each scenario's full Session by id", () => {
    const [first] = listLearnScenarios();

    expect(getLearnScenario(first.id)).toEqual(first);
  });

  it("returns undefined for an unknown scenario id", () => {
    expect(getLearnScenario("does-not-exist")).toBeUndefined();
  });
});
