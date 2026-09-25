import type { ConfigStatus } from "@copilot-cost-analyzer/domain";
import { getJson, putJson } from "./http.js";

export function fetchConfigStatus(): Promise<ConfigStatus> {
  return getJson<ConfigStatus>("/api/config/status");
}

export function updateRetentionThreshold(value: number): Promise<ConfigStatus> {
  return putJson<ConfigStatus>("/api/config/retention-threshold", { value });
}
