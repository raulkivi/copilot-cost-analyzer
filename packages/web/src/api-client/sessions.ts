import type { Session, TurnInspectorDetail } from "@copilot-cost-analyzer/domain";
import { getJson, getText } from "./http.js";

export function fetchSessions(): Promise<Session[]> {
  return getJson<Session[]>("/api/sessions");
}

export function fetchSession(id: string): Promise<Session> {
  return getJson<Session>(`/api/sessions/${id}`);
}

// Useful on its own (e.g. opened directly by the browser for a raw view);
// fetchSystemPromptText below reuses it for the in-app inspector.
export function systemPromptTextUrl(id: string): string {
  return `/api/sessions/${id}/system-prompt`;
}

export function fetchSystemPromptText(id: string): Promise<string> {
  return getText(systemPromptTextUrl(id));
}

export function fetchTurnInspectorDetail(sessionId: string, turnIndex: number): Promise<TurnInspectorDetail> {
  return getJson<TurnInspectorDetail>(`/api/sessions/${sessionId}/turns/${turnIndex}`);
}
