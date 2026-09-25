import type { ToolInventoryEntry } from "@copilot-cost-analyzer/domain";
import type { JsonlEnvelope } from "./main-jsonl-reader.js";
import { groupEnvelopesByUserMessage } from "./session-usage-spans.js";

// One entry per SQLite turn_index (array position), each the ordered list of
// tool_call event names within that turn's group — reuses the same
// positional user_message join as session-usage-spans.ts (architecture.md
// §6.2), since a tool_call's own attrs carry no turn/turnId reference.
export function extractInvokedToolNamesByTurn(
  envelopes: JsonlEnvelope[],
): string[][] {
  return groupEnvelopesByUserMessage(envelopes).map((group) =>
    group
      .filter((envelope) => envelope.type === "tool_call")
      .map((envelope) => envelope.name ?? "unknown tool"),
  );
}

// `loadedToolNames` is the ground-truth list from the session's tools_N.json
// artifact (prompt-artifact-reader.ts), or null when it couldn't be read. A
// tool invoked but absent from that list (older/mismatched artifact) is
// still surfaced rather than dropped, just marked loaded:false — the
// opposite case (claiming a tool was loaded when we have no evidence either
// way) would be constraint-6 fabrication, so when the loaded list itself is
// unavailable we only report tools we have direct proof of: the ones
// actually invoked.
export function buildToolInventory(
  loadedToolNames: string[] | null,
  invokedNamesByTurn: string[][],
): ToolInventoryEntry[] {
  const invokedTurnsByName = new Map<string, number[]>();
  invokedNamesByTurn.forEach((names, turnIndex) => {
    for (const name of names) {
      const turns = invokedTurnsByName.get(name) ?? [];
      if (!turns.includes(turnIndex)) {
        turns.push(turnIndex);
      }
      invokedTurnsByName.set(name, turns);
    }
  });

  if (loadedToolNames === null) {
    return Array.from(invokedTurnsByName.entries()).map(
      ([name, invokedInTurns]) => ({ name, loaded: true, invokedInTurns }),
    );
  }

  const entries: ToolInventoryEntry[] = loadedToolNames.map((name) => ({
    name,
    loaded: true,
    invokedInTurns: invokedTurnsByName.get(name) ?? [],
  }));

  const loadedNameSet = new Set(loadedToolNames);
  for (const [name, invokedInTurns] of invokedTurnsByName) {
    if (!loadedNameSet.has(name)) {
      entries.push({ name, loaded: false, invokedInTurns });
    }
  }

  return entries;
}
