import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sessionSchema,
  sumTokenCounts,
  unavailableTokenCount,
  type Session,
  type TokenCount,
} from "@copilot-cost-analyzer/domain";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/learn-scenarios",
);

const SCENARIO_COST_UNKNOWN_REASON =
  "AI Credits total is unavailable because at least one turn in this scenario has an unknown cost.";

// Fixtures don't carry a session-level costAiCredits — it's derived from
// each turn's already-required TurnUsage.costAiCredits, so authoring a
// fixture never means hand-computing (and risking a stale) running total.
function deriveScenarioCost(raw: unknown): TokenCount {
  const turns = (raw as { turns?: { usage?: { costAiCredits?: TokenCount } }[] }).turns ?? [];
  return sumTokenCounts(
    turns.map((turn) => turn.usage?.costAiCredits ?? unavailableTokenCount(SCENARIO_COST_UNKNOWN_REASON)),
    SCENARIO_COST_UNKNOWN_REASON,
  );
}

function loadScenarios(): Map<string, Session> {
  const scenarios = new Map<string, Session>();
  const files = readdirSync(fixturesDir).filter((file) => file.endsWith(".json"));

  for (const file of files) {
    const raw: unknown = JSON.parse(readFileSync(path.join(fixturesDir, file), "utf-8"));
    // Fail fast: an invalid bundled fixture must break startup, not serve bad data.
    const scenario = sessionSchema.parse({
      ...(raw as object),
      costAiCredits: deriveScenarioCost(raw),
    });

    if (scenario.mode !== "learn") {
      throw new Error(`Learn scenario fixture "${file}" must have mode "learn"`);
    }
    if (scenarios.has(scenario.id)) {
      throw new Error(`Duplicate learn scenario id "${scenario.id}" (from "${file}")`);
    }
    scenarios.set(scenario.id, scenario);
  }

  return scenarios;
}

const scenarios = loadScenarios();

export function listLearnScenarios(): Session[] {
  return Array.from(scenarios.values());
}

export function getLearnScenario(id: string): Session | undefined {
  return scenarios.get(id);
}
