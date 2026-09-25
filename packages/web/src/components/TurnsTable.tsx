import type { TokenCount, Turn } from "@copilot-cost-analyzer/domain";
import { sumTokenCounts } from "@copilot-cost-analyzer/domain";
import { formatAiCredits } from "../lib/format-ai-credits.js";
import { onKeyActivate } from "../lib/on-key-activate.js";
import { TRIGGER_LABELS } from "../lib/trigger-labels.js";
import { Tag } from "./ui/Tag.js";

const CUMULATIVE_COST_UNKNOWN_REASON =
  "Cumulative AI Credits is unavailable because at least one earlier turn's cost is unknown.";

function formatTokenCount(tokenCount: TokenCount): string {
  return tokenCount.known ? tokenCount.value.toLocaleString() : "—";
}

function formatRoundsCount(roundsCount: number | undefined): string {
  return roundsCount === undefined ? "—" : roundsCount.toLocaleString();
}

// Running total through and including this row — all-or-nothing (an
// earlier turn with unknown cost makes every later row's total unknown too).
function cumulativeCostThrough(turns: Turn[], turnIndex: number): TokenCount {
  return sumTokenCounts(
    turns.slice(0, turnIndex + 1).map((turn) => turn.usage.costAiCredits),
    CUMULATIVE_COST_UNKNOWN_REASON,
  );
}

interface TurnsTableProps {
  turns: Turn[];
  selectedTurnIndex: number;
  onSelectTurn: (turnIndex: number) => void;
}

export function TurnsTable({ turns, selectedTurnIndex, onSelectTurn }: TurnsTableProps) {
  return (
    <table className="table" style={{ minWidth: 760 }}>
      <thead>
        <tr>
          <th>Turn</th>
          <th>Trigger</th>
          <th>Rounds</th>
          <th>Uncached in</th>
          <th>Cache read</th>
          <th>Cache write</th>
          <th>Tool</th>
          <th>Vision</th>
          <th>Reasoning</th>
          <th>Output</th>
          <th>AI Credits</th>
          <th>Cumulative</th>
          <th>Model</th>
        </tr>
      </thead>
      <tbody>
        {turns.map((turn, turnIndex) => (
          <tr
            key={turn.index}
            aria-selected={turnIndex === selectedTurnIndex}
            tabIndex={0}
            style={{
              cursor: "pointer",
              background: turnIndex === selectedTurnIndex ? "var(--color-accent-100)" : undefined,
            }}
            onClick={() => onSelectTurn(turnIndex)}
            onKeyDown={onKeyActivate(() => onSelectTurn(turnIndex))}
          >
            <td>{turn.index}</td>
            <td className="truncate" style={{ maxWidth: 100 }}>
              {turn.triggeredEvent ? (
                <Tag variant="outline">{TRIGGER_LABELS[turn.triggeredEvent]}</Tag>
              ) : (
                <span className="text-muted">—</span>
              )}
            </td>
            <td>{formatRoundsCount(turn.usage.roundsCount)}</td>
            <td>{formatTokenCount(turn.usage.uncachedInput)}</td>
            <td>{formatTokenCount(turn.usage.cacheRead)}</td>
            <td>{formatTokenCount(turn.usage.cacheWrite)}</td>
            <td>{formatTokenCount(turn.usage.tool)}</td>
            <td>{formatTokenCount(turn.usage.vision)}</td>
            <td>{formatTokenCount(turn.usage.reasoning)}</td>
            <td>{formatTokenCount(turn.usage.output)}</td>
            <td>{formatAiCredits(turn.usage.costAiCredits)}</td>
            <td className="text-muted">{formatAiCredits(cumulativeCostThrough(turns, turnIndex))}</td>
            <td className="text-muted truncate" style={{ fontSize: 12, maxWidth: 110 }}>
              {turn.usage.model}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
