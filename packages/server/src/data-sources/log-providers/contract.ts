import { describe, expect, it } from "vitest";
import { sessionSchema } from "@copilot-cost-analyzer/domain";
import type { LogProvider } from "./log-provider.js";

// Shared assertions every LogProvider must satisfy, regardless of source
// (architecture.md §11.4: "write contract tests that run the same
// list/read assertions against VS Code and mitmproxy fixtures before wiring
// either provider into the registry"). Each concrete provider's own test
// file calls this against a fixture-backed instance rather than duplicating
// these assertions per provider.
export interface LogProviderContractFixture {
  // A provider instance whose configured source is present and has at
  // least one readable session, `knownSessionId`.
  buildAvailableProvider: () => LogProvider;
  knownSessionId: string;
  // A session id `buildAvailableProvider()`'s provider does not have.
  unknownSessionId: string;
  // A provider instance whose configured source is missing/misconfigured.
  buildUnavailableProvider: () => LogProvider;
  // A turn index within knownSessionId that has captured round-trip data
  // (Phase 9.5) — used to assert readTurnDetail returns non-empty rounds.
  turnIndexWithRoundTrip: number;
}

export function describeLogProviderContract(
  label: string,
  fixture: LogProviderContractFixture,
): void {
  describe(`LogProvider contract: ${label}`, () => {
    it("listSessions returns schema-valid session summaries with non-empty ids", async () => {
      const provider = fixture.buildAvailableProvider();

      const sessions = await provider.listSessions();

      expect(sessions.length).toBeGreaterThan(0);
      for (const session of sessions) {
        expect(() => sessionSchema.parse(session)).not.toThrow();
        expect(session.id).not.toBe("");
      }
    });

    it("readSession returns a schema-valid session for a known id", async () => {
      const provider = fixture.buildAvailableProvider();

      const session = await provider.readSession(fixture.knownSessionId);

      expect(session).not.toBeNull();
      expect(() => sessionSchema.parse(session)).not.toThrow();
    });

    it("readSession returns null for an unknown id, predictably rather than throwing", async () => {
      const provider = fixture.buildAvailableProvider();

      await expect(
        provider.readSession(fixture.unknownSessionId),
      ).resolves.toBeNull();
    });

    it("checkAvailability reports available: true when the source is present", async () => {
      const provider = fixture.buildAvailableProvider();

      await expect(provider.checkAvailability()).resolves.toEqual({
        available: true,
      });
    });

    it("checkAvailability reflects a missing/misconfigured source", async () => {
      const provider = fixture.buildUnavailableProvider();

      const availability = await provider.checkAvailability();

      expect(availability.available).toBe(false);
      expect(availability.unavailableReason).toBeTruthy();
    });

    it("readTurnDetail returns null for an unknown session id", async () => {
      const provider = fixture.buildAvailableProvider();

      await expect(
        provider.readTurnDetail(fixture.unknownSessionId, 0),
      ).resolves.toBeNull();
    });

    it("readTurnDetail returns null for a turnIndex the session doesn't have", async () => {
      const provider = fixture.buildAvailableProvider();

      await expect(
        provider.readTurnDetail(fixture.knownSessionId, 999_999),
      ).resolves.toBeNull();
    });

    it("readTurnDetail returns non-empty rounds for a turn with captured round-trip data", async () => {
      const provider = fixture.buildAvailableProvider();

      const detail = await provider.readTurnDetail(
        fixture.knownSessionId,
        fixture.turnIndexWithRoundTrip,
      );

      expect(detail).not.toBeNull();
      expect(detail!.turnIndex).toBe(fixture.turnIndexWithRoundTrip);
      expect(detail!.rounds.length).toBeGreaterThan(0);
    });
  });
}
