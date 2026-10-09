import type { AuditRollup, SessionAudit } from "@copilot-cost-analyzer/domain";
import { getJson } from "./http.js";

export interface RollupQuery {
  since?: string;
  until?: string;
  limit?: number;
}

export function fetchSessionAudit(sessionId: string): Promise<SessionAudit> {
  return getJson<SessionAudit>(`/api/sessions/${encodeURIComponent(sessionId)}/audit`);
}

export function fetchAuditRollup(query: RollupQuery): Promise<AuditRollup> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return getJson<AuditRollup>(search ? `/api/audit?${search}` : "/api/audit");
}
