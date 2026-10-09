import {
  sumTokenCounts,
  unavailableTokenCount,
  type AuditedToolCall,
  type FailureCategory,
  type RetryGroup,
  type Session,
  type SessionAudit,
  type TokenCount,
  type Turn,
} from "@copilot-cost-analyzer/domain";
import {
  addToTotals,
  emptyTotals,
  failureRateOf,
  isFailedCall,
  normalizeCommand,
  RankedCounter,
  rankCategories,
  statusOf,
  unknownReasonOf,
} from "./outcome-tally.js";

const NO_AFFECTED_TURNS_REASON = "No turn contained a failed tool call.";
const AFFECTED_USAGE_UNKNOWN_REASON = "At least one affected turn has no known usage figure.";

function flattenCalls(session: Session): AuditedToolCall[] {
  return session.turns.flatMap((turn) => turn.toolCalls.map((call) => ({ turnIndex: turn.index, call })));
}

function breakdowns(calls: AuditedToolCall[]) {
  const byTool = new RankedCounter<string>();
  const byProgram = new RankedCounter<string>();
  const byCategory = new Map<FailureCategory, number>();

  for (const { call } of calls) {
    const failed = isFailedCall(call) ? 1 : 0;
    byTool.add(call.name, 1, failed, call.durationMs);
    if (call.shell?.program) {
      byProgram.add(call.shell.program, 1, failed);
    }
    const category = call.outcome?.failureCategory;
    if (failed && category) {
      byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    }
  }

  return {
    byTool: byTool.ranked().map(({ key, calls: n, failed, durationMs }) => ({
      name: key,
      calls: n,
      failed,
      ...(durationMs !== undefined ? { totalDurationMs: durationMs } : {}),
    })),
    byShellProgram: byProgram.ranked().map(({ key, calls: n, failed }) => ({ program: key, calls: n, failed })),
    byFailureCategory: rankCategories(byCategory),
  };
}

function perTurn(session: Session): SessionAudit["perTurn"] {
  return session.turns.map((turn) => {
    const totals = emptyTotals();
    turn.toolCalls.forEach((call) => addToTotals(totals, call));
    return {
      turnIndex: turn.index,
      succeeded: totals.succeeded,
      failed: totals.failed,
      interrupted: totals.interrupted,
      denied: totals.denied,
      unknown: totals.unknown,
    };
  });
}

// A retry is the exact same (whitespace-normalized) shell command issued
// again after an earlier attempt failed. Deliberately exact: fuzzier
// "similar command" matching would be a guess about intent.
function findRetries(calls: AuditedToolCall[]): RetryGroup[] {
  const attemptsByCommand = new Map<string, AuditedToolCall[]>();
  for (const audited of calls) {
    if (!audited.call.shell) {
      continue;
    }
    const key = normalizeCommand(audited.call.shell.command);
    attemptsByCommand.set(key, [...(attemptsByCommand.get(key) ?? []), audited]);
  }

  const retries: RetryGroup[] = [];
  for (const [command, attempts] of attemptsByCommand) {
    const firstFailure = attempts.findIndex((a) => isFailedCall(a.call));
    if (attempts.length < 2 || firstFailure === -1 || firstFailure === attempts.length - 1) {
      continue;
    }
    retries.push({
      command,
      attempts: attempts.length,
      eventuallySucceeded: statusOf(attempts[attempts.length - 1].call) === "success",
      turnIndexes: [...new Set(attempts.map((a) => a.turnIndex))].sort((a, b) => a - b),
    });
  }
  return retries.sort((a, b) => b.attempts - a.attempts || a.command.localeCompare(b.command));
}

function sumOver(turns: Turn[], pick: (turn: Turn) => TokenCount[]): TokenCount {
  if (turns.length === 0) {
    return unavailableTokenCount(NO_AFFECTED_TURNS_REASON);
  }
  return sumTokenCounts(turns.flatMap(pick), AFFECTED_USAGE_UNKNOWN_REASON);
}

function failureRecoveryCost(session: Session): SessionAudit["failureRecoveryCost"] {
  const failedRounds = new Set<string>();
  const affected: Turn[] = [];
  for (const turn of session.turns) {
    const failures = turn.toolCalls.filter(isFailedCall);
    if (failures.length === 0) {
      continue;
    }
    affected.push(turn);
    failures.forEach((call) => failedRounds.add(`${turn.index}:${call.roundIndex ?? "?"}`));
  }
  return {
    recoveryRounds: failedRounds.size,
    affectedTurns: affected.map((turn) => turn.index),
    affectedTurnsOutputTokens: sumOver(affected, (turn) => [turn.usage.output]),
    affectedTurnsInputTokens: sumOver(affected, (turn) => [turn.usage.uncachedInput, turn.usage.cacheWrite, turn.usage.cacheRead]),
  };
}

// Pure: normalized Session in, SessionAudit out — provider-agnostic, since
// every provider already normalizes into ToolCallRecords.
export function buildSessionAudit(session: Session): SessionAudit {
  const calls = flattenCalls(session);
  const totals = emptyTotals();
  const unknownReasons = new Set<string>();
  for (const { call } of calls) {
    addToTotals(totals, call);
    if (statusOf(call) === "unknown") {
      unknownReasons.add(unknownReasonOf(call));
    }
  }

  return {
    sessionId: session.id,
    ...(session.providerId ? { providerId: session.providerId } : {}),
    title: session.title,
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    totals,
    failureRate: failureRateOf(totals),
    ...breakdowns(calls),
    perTurn: perTurn(session),
    calls,
    retries: findRetries(calls),
    failureRecoveryCost: failureRecoveryCost(session),
    outcomeCoverage: { known: totals.toolCalls - totals.unknown, unknown: totals.unknown, unknownReasons: [...unknownReasons] },
  };
}
