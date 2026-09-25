import type { Session, TurnInspectorDetail } from "@copilot-cost-analyzer/domain";
import { describeLogProviderContract } from "./contract.js";
import type { LogProvider, LogProviderAvailability } from "./log-provider.js";

// Proves the shared contract harness's own assertions are correct before
// either concrete provider (VscodeLogProvider, MitmproxyLogProvider) exists
// — a minimal in-memory fake stands in for "any LogProvider" here.
function buildFakeSession(id: string): Session {
  return {
    id,
    mode: "analyze",
    providerId: "fake",
    title: `Fake session ${id}`,
    model: "unknown",
    turns: [],
    turnCount: 0,
    costAiCredits: { known: false, reason: "fake provider never has usage data" },
    usageDataAvailable: false,
  };
}

class FakeLogProvider implements LogProvider {
  readonly id = "fake";
  readonly label = "Fake";

  constructor(
    private readonly sessions: Session[],
    private readonly availability: LogProviderAvailability,
  ) {}

  async checkAvailability(): Promise<LogProviderAvailability> {
    return this.availability;
  }

  async listSessions(): Promise<Session[]> {
    return this.sessions;
  }

  async readSession(sessionId: string): Promise<Session | null> {
    return this.sessions.find((session) => session.id === sessionId) ?? null;
  }

  async readTurnDetail(sessionId: string, turnIndex: number): Promise<TurnInspectorDetail | null> {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!session || turnIndex !== 0) {
      return null;
    }
    return {
      turnIndex,
      userMessage: [{ kind: "text", text: "fake user message" }],
      rounds: [
        {
          request: { index: 0, addedMessages: [{ kind: "text", text: "fake request" }], toolCalls: [] },
          response: { index: 0, response: [{ kind: "text", text: "fake response" }] },
        },
      ],
    };
  }
}

describeLogProviderContract("fake in-memory provider", {
  buildAvailableProvider: () =>
    new FakeLogProvider([buildFakeSession("fake-1")], { available: true }),
  knownSessionId: "fake-1",
  unknownSessionId: "does-not-exist",
  buildUnavailableProvider: () =>
    new FakeLogProvider([], {
      available: false,
      unavailableReason: "Fake source not configured.",
    }),
  turnIndexWithRoundTrip: 0,
});
