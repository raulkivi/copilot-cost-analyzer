import type { LogProviderStatus } from "@copilot-cost-analyzer/domain";
import { getJson, putJson } from "./http.js";

export function fetchLogProviderStatus(): Promise<LogProviderStatus> {
  return getJson<LogProviderStatus>("/api/log-providers");
}

export function setActiveLogProvider(id: string): Promise<LogProviderStatus> {
  return putJson<LogProviderStatus>("/api/log-providers/active", { id });
}
