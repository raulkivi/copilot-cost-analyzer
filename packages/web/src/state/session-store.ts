import { useState } from "react";
import type { Session } from "@copilot-cost-analyzer/domain";

export type Mode = "learn" | "analyze";
export type RightTab = "explanation" | "system-prompt" | "tools";

// Analyze mode's default provider until GET /api/log-providers resolves —
// matches the server registry's own default (app-settings.ts).
const DEFAULT_PROVIDER_ID = "vscode";

export function useSessionStore() {
  const [session, setSession] = useState<Session | null>(null);
  const [selectedTurnIndex, setSelectedTurnIndex] = useState(0);
  const [mode, setModeState] = useState<Mode>("learn");
  const [rightTab, setRightTab] = useState<RightTab>("explanation");
  const [activeProviderId, setActiveProviderIdState] = useState(DEFAULT_PROVIDER_ID);

  function loadSession(next: Session): void {
    setSession(next);
    setSelectedTurnIndex(0);
    setRightTab("explanation");
  }

  function setMode(next: Mode): void {
    if (next === mode) {
      return;
    }
    setModeState(next);
    setSession(null);
    setSelectedTurnIndex(0);
    setRightTab("explanation");
  }

  // Changing the active Analyze-mode log provider clears the selected
  // session (architecture.md §5: "changing the active provider clears the
  // selected Analyze session and reloads the same GET /api/sessions
  // resource"), the same way setMode clears a stale cross-mode session.
  function setActiveProviderId(next: string): void {
    if (next === activeProviderId) {
      return;
    }
    setActiveProviderIdState(next);
    setSession(null);
    setSelectedTurnIndex(0);
    setRightTab("explanation");
  }

  return {
    session,
    selectedTurnIndex,
    mode,
    rightTab,
    activeProviderId,
    loadSession,
    selectTurn: setSelectedTurnIndex,
    setMode,
    setRightTab,
    setActiveProviderId,
  };
}
