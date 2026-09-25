import type { LogProviderDescriptor, LogProviderStatus } from "@copilot-cost-analyzer/domain";
import {
  DEFAULT_ACTIVE_PROVIDER_ID,
  readActiveProviderId,
  writeActiveProviderId,
} from "./app-settings.js";
import type { LogProvider } from "./log-provider.js";

export class UnknownLogProviderIdError extends Error {
  constructor(readonly providerId: string) {
    super(`Unknown log provider id "${providerId}"`);
    this.name = "UnknownLogProviderIdError";
  }
}

// Server-owned registry (architecture.md §4.1/§6.2.1): explicit provider
// registration at server composition time (not dynamic loading), a
// persisted active-provider setting, and the generic descriptors the
// GET /api/log-providers endpoint returns. Registering a new provider is
// exactly "construct it and pass it into this constructor" — nothing else
// in the API/UI layer needs to change (see the OCP proof in
// registry.test.ts).
export class LogProviderRegistry {
  private readonly providers: Map<string, LogProvider>;
  private activeId: string;

  constructor(providers: LogProvider[], private readonly settingsDir: string) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
    const persisted = readActiveProviderId(settingsDir);
    this.activeId = this.providers.has(persisted) ? persisted : DEFAULT_ACTIVE_PROVIDER_ID;
  }

  getActiveProviderId(): string {
    return this.activeId;
  }

  // Only throws if no provider with the (persisted-default-or-set) active
  // id was ever registered — a server composition bug, not a runtime state
  // to handle gracefully.
  getActiveProvider(): LogProvider {
    const provider = this.providers.get(this.activeId);
    if (!provider) {
      throw new UnknownLogProviderIdError(this.activeId);
    }
    return provider;
  }

  setActive(providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new UnknownLogProviderIdError(providerId);
    }
    this.activeId = providerId;
    writeActiveProviderId(this.settingsDir, providerId);
  }

  private async listDescriptors(): Promise<LogProviderDescriptor[]> {
    return Promise.all(
      [...this.providers.values()].map(async (provider) => {
        const availability = await provider.checkAvailability();
        return {
          id: provider.id,
          label: provider.label,
          available: availability.available,
          ...(availability.unavailableReason
            ? { unavailableReason: availability.unavailableReason }
            : {}),
        };
      }),
    );
  }

  async getStatus(): Promise<LogProviderStatus> {
    return {
      providers: await this.listDescriptors(),
      activeProviderId: this.activeId,
    };
  }
}
