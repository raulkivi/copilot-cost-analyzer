import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Session, TurnInspectorDetail } from "@copilot-cost-analyzer/domain";
import { LogProviderRegistry, UnknownLogProviderIdError } from "./registry.js";
import type { LogProvider, LogProviderAvailability } from "./log-provider.js";

class StubProvider implements LogProvider {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly availability: LogProviderAvailability,
  ) {}

  async checkAvailability(): Promise<LogProviderAvailability> {
    return this.availability;
  }

  async listSessions(): Promise<Session[]> {
    return [];
  }

  async readSession(): Promise<Session | null> {
    return null;
  }

  async readTurnDetail(): Promise<TurnInspectorDetail | null> {
    return null;
  }
}

describe("LogProviderRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "log-provider-registry-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults the active provider to 'vscode' on first run", () => {
    const registry = new LogProviderRegistry(
      [new StubProvider("vscode", "VS Code", { available: true })],
      dir,
    );

    expect(registry.getActiveProviderId()).toBe("vscode");
  });

  it("lists descriptors reflecting each provider's availability", async () => {
    const registry = new LogProviderRegistry(
      [
        new StubProvider("vscode", "VS Code", { available: true }),
        new StubProvider("mitmproxy", "mitmproxy", {
          available: false,
          unavailableReason: "no captures configured",
        }),
      ],
      dir,
    );

    const status = await registry.getStatus();

    expect(status.activeProviderId).toBe("vscode");
    expect(status.providers).toEqual([
      { id: "vscode", label: "VS Code", available: true },
      {
        id: "mitmproxy",
        label: "mitmproxy",
        available: false,
        unavailableReason: "no captures configured",
      },
    ]);
  });

  it("setActive persists across a new registry instance reading the same settings dir", () => {
    const providers = () => [
      new StubProvider("vscode", "VS Code", { available: true }),
      new StubProvider("mitmproxy", "mitmproxy", { available: true }),
    ];
    const first = new LogProviderRegistry(providers(), dir);
    first.setActive("mitmproxy");

    const second = new LogProviderRegistry(providers(), dir);

    expect(second.getActiveProviderId()).toBe("mitmproxy");
  });

  it("throws UnknownLogProviderIdError when setting an unregistered id", () => {
    const registry = new LogProviderRegistry(
      [new StubProvider("vscode", "VS Code", { available: true })],
      dir,
    );

    expect(() => registry.setActive("does-not-exist")).toThrow(UnknownLogProviderIdError);
  });

  it("falls back to the default active id when the persisted id is no longer registered", () => {
    const stale = new LogProviderRegistry(
      [
        new StubProvider("vscode", "VS Code", { available: true }),
        new StubProvider("mitmproxy", "mitmproxy", { available: true }),
      ],
      dir,
    );
    stale.setActive("mitmproxy");

    const registry = new LogProviderRegistry(
      [new StubProvider("vscode", "VS Code", { available: true })],
      dir,
    );

    expect(registry.getActiveProviderId()).toBe("vscode");
  });

  // OCP proof: a third, test-only provider needs nothing beyond
  // constructing it and passing it into this same constructor alongside
  // vscode/mitmproxy — no change to
  // LogProviderRegistry, the LogProvider interface, or any other file in
  // data-sources/log-providers/ is required to add a provider.
  it("registers and serves a third, test-only provider with no other file changes", async () => {
    const thirdProvider = new StubProvider("test-only", "Test-only provider", { available: true });
    const registry = new LogProviderRegistry(
      [
        new StubProvider("vscode", "VS Code", { available: true }),
        new StubProvider("mitmproxy", "mitmproxy", { available: true }),
        thirdProvider,
      ],
      dir,
    );

    registry.setActive("test-only");

    expect(registry.getActiveProvider()).toBe(thirdProvider);
    const status = await registry.getStatus();
    expect(status.providers.map((p) => p.id)).toEqual(["vscode", "mitmproxy", "test-only"]);
    expect(status.activeProviderId).toBe("test-only");
  });
});
