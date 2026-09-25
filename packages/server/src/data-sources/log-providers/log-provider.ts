import type { Session, TurnInspectorDetail } from "@copilot-cost-analyzer/domain";

// The provider-neutral boundary (architecture.md §6.2.1/§12): every log
// source — VS Code local logs, mitmproxy captures, or a future source —
// implements this and nothing else crosses into services/session-enricher,
// the API, or the frontend. A provider returns full, already-normalized
// `Session` values directly (mode: "analyze", providerId set to its own
// id) rather than a separate intermediate shape: since `Session` is already
// the one normalized contract the API/UI consume (domain §5), adding a
// second "normalized record" shape between a provider and that contract
// would be an extra translation step with nothing to translate for — the
// provider *is* the translation from source-specific data into `Session`.
export interface LogProviderAvailability {
  available: boolean;
  unavailableReason?: string;
}

export interface LogProvider {
  readonly id: string;
  readonly label: string;
  // Reflects whether this provider's configured local source can currently
  // be read — never throws; a missing/misconfigured source is a normal,
  // expected state (constraint 6), not an error.
  checkAvailability(): Promise<LogProviderAvailability>;
  // Session summaries (turns: [] per the existing GET /api/sessions
  // contract) for every session this provider can currently see.
  listSessions(): Promise<Session[]>;
  // The full Session for one id, or null if this provider has no session
  // with that id (the API layer turns that into a 404). A source-level
  // failure (e.g. a corrupted store) should reject/throw so the API layer's
  // existing 500 handling applies — only "not found" is a null return.
  readSession(sessionId: string): Promise<Session | null>;
  // One turn's actual LLM request/response round-trip(s) (turn-inspector-
  // plan.md §5.3), fetched on demand rather than up front. `null` has
  // exactly one meaning, matching readSession's null-for-404 convention:
  // the session or the turn index doesn't exist. It does NOT mean "no
  // round-trip data available" — that's a valid, non-null
  // TurnInspectorDetail with `rounds: []`.
  readTurnDetail(sessionId: string, turnIndex: number): Promise<TurnInspectorDetail | null>;
}
