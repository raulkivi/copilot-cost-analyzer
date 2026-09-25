import { useEffect, useRef, useState } from "react";
import type { ConfigWarning, LogProviderDescriptor, Session } from "@copilot-cost-analyzer/domain";
import { fetchConfigStatus, updateRetentionThreshold } from "./api-client/config-status.js";
import { fetchLearnScenarios } from "./api-client/learn-scenarios.js";
import { fetchLogProviderStatus, setActiveLogProvider } from "./api-client/log-providers.js";
import { fetchSession, fetchSessions } from "./api-client/sessions.js";
import { AdviceExportDialog } from "./components/AdviceExportDialog.js";
import { AdviceExportTriggerBar } from "./components/AdviceExportTriggerBar.js";
import { AppHeader } from "./components/AppHeader.js";
import { ConfigWarningBanner } from "./components/ConfigWarningBanner.js";
import { ExplanationPanel } from "./components/ExplanationPanel.js";
import { SessionList } from "./components/SessionList.js";
import { SystemPromptBreakdown } from "./components/SystemPromptBreakdown.js";
import { SystemPromptInspector } from "./components/SystemPromptInspector.js";
import { TimelineScrubber } from "./components/TimelineScrubber.js";
import { ToolInventoryPanel } from "./components/ToolInventoryPanel.js";
import { TurnInspector } from "./components/TurnInspector.js";
import { TurnsTable } from "./components/TurnsTable.js";
import { Blueprint } from "./components/ui/Blueprint.js";
import { SegmentedControl } from "./components/ui/SegmentedControl.js";
import { Tag } from "./components/ui/Tag.js";
import { AiCreditsSparkline } from "./charts/AiCreditsSparkline.js";
import { useSessionStore } from "./state/session-store.js";

interface HealthResponse {
  status: string;
  version: string;
}

const RIGHT_TAB_OPTIONS = [
  { value: "explanation", label: "Explanation" },
  { value: "system-prompt", label: "System prompt" },
  { value: "tools", label: "Tools" },
] as const;

const EMPTY_STATES = {
  learn: {
    title: "No bundled Learn scenarios found",
    body: "Scenario fixtures ship with the app — if this list is empty, the bundled fixtures failed to load. Check packages/server/fixtures.",
  },
  analyze: {
    title: "No Copilot Chat sessions found yet",
    body: "This reads your local Copilot Chat session store. Run a chat session in VS Code, then reload this page.",
  },
} as const;

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [scenarios, setScenarios] = useState<Session[]>([]);
  const [scenariosLoaded, setScenariosLoaded] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [configWarnings, setConfigWarnings] = useState<ConfigWarning[]>([]);
  const [retentionThreshold, setRetentionThreshold] = useState<number | undefined>(undefined);
  const [showConfigBanner, setShowConfigBanner] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [adviceSelection, setAdviceSelection] = useState<Set<string>>(new Set());
  const [adviceDialogOpen, setAdviceDialogOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [turnInspectorOpen, setTurnInspectorOpen] = useState(false);
  const [providers, setProviders] = useState<LogProviderDescriptor[]>([]);
  const {
    session,
    selectedTurnIndex,
    mode,
    rightTab,
    activeProviderId,
    loadSession,
    selectTurn,
    setMode,
    setRightTab,
    setActiveProviderId,
  } = useSessionStore();
  const latestSessionRequestId = useRef(0);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch((error: Error) => setFetchError(error.message));
  }, []);

  useEffect(() => {
    fetchLearnScenarios()
      .then((result) => {
        setScenarios(result);
        setScenariosLoaded(true);
      })
      .catch((error: Error) => setFetchError(error.message));
  }, []);

  useEffect(() => {
    fetchLogProviderStatus()
      .then((status) => {
        setProviders(status.providers);
        setActiveProviderId(status.activeProviderId);
      })
      .catch((error: Error) => setFetchError(error.message));
    // Only ever needs to run once — subsequent provider changes go through
    // handleProviderChange below, which already has the fresh status.
  }, []);

  // Re-fetches whenever the active Analyze-mode provider changes, so the
  // list reflects whichever provider GET /api/sessions currently reads from
  // (architecture.md §5's "reloads the same GET /api/sessions resource").
  useEffect(() => {
    setSessionsLoaded(false);
    fetchSessions()
      .then((result) => {
        setSessions(result);
        setSessionsLoaded(true);
      })
      .catch((error: Error) => setFetchError(error.message));
  }, [activeProviderId]);

  useEffect(() => {
    fetchConfigStatus()
      .then((status) => {
        setConfigWarnings(status.warnings);
        setRetentionThreshold(status.minRetainedSessionLogsThreshold);
      })
      .catch((error: Error) => setFetchError(error.message));
  }, []);

  const selectedTurn = session?.turns[selectedTurnIndex] ?? null;
  const listForMode = mode === "learn" ? scenarios : sessions;
  const listLoaded = mode === "learn" ? scenariosLoaded : sessionsLoaded;
  const showEmptyState = listLoaded && listForMode.length === 0;
  const allAiCreditsKnown =
    session !== null && session.turns.length > 0 && session.turns.every((turn) => turn.usage.costAiCredits.known);
  // toolInventory only comes from a parsed main.jsonl; a turn's toolCalls
  // come independently from SQLite session_files, so either source having
  // data means tool-call detail is available for the selected turn.
  const toolCallsAvailable =
    (selectedTurn?.toolCalls.length ?? 0) > 0 || (session?.toolInventory?.length ?? 0) > 0;
  // Use the fully-fetched session (with turns/systemPrompt/toolInventory) in
  // place of its lightweight list summary when it's the currently open one —
  // fetchSessions() only returns per-session summaries, so the advice bundle
  // would otherwise report an empty turn history for Analyze-mode sessions.
  const adviceSessions = listForMode
    .filter((candidate) => adviceSelection.has(candidate.id))
    .map((candidate) => (session?.id === candidate.id ? session : candidate));

  function handleProviderChange(id: string): void {
    setActiveLogProvider(id)
      .then((status) => {
        setProviders(status.providers);
        setActiveProviderId(status.activeProviderId);
      })
      .catch((error: Error) => setFetchError(error.message));
  }

  function handleRetentionThresholdChange(value: number): void {
    updateRetentionThreshold(value)
      .then((status) => {
        setConfigWarnings(status.warnings);
        setRetentionThreshold(status.minRetainedSessionLogsThreshold);
      })
      .catch((error: Error) => setFetchError(error.message));
  }

  function handleModeChange(next: typeof mode): void {
    setAdviceSelection(new Set());
    setAdviceDialogOpen(false);
    setInspectorOpen(false);
    setTurnInspectorOpen(false);
    setMode(next);
  }

  function handleToggleAdvice(picked: Session): void {
    setAdviceSelection((current) => {
      const next = new Set(current);
      if (next.has(picked.id)) {
        next.delete(picked.id);
      } else {
        next.add(picked.id);
      }
      return next;
    });
  }

  function handleSelectSession(picked: Session): void {
    setInspectorOpen(false);
    setTurnInspectorOpen(false);
    if (mode === "analyze") {
      const requestId = ++latestSessionRequestId.current;
      fetchSession(picked.id)
        .then((result) => {
          // Ignore a response for a session the user has since navigated
          // away from — otherwise a slower earlier request can resolve
          // after a faster later one and overwrite it.
          if (requestId === latestSessionRequestId.current) {
            loadSession(result);
          }
        })
        .catch((error: Error) => {
          if (requestId === latestSessionRequestId.current) {
            setFetchError(error.message);
          }
        });
    } else {
      loadSession(picked);
    }
  }

  return (
    <main>
      <AppHeader
        mode={mode}
        onModeChange={handleModeChange}
        hasConfigWarnings={configWarnings.length > 0}
        onConfigClick={() => setShowConfigBanner(true)}
        providers={providers}
        activeProviderId={activeProviderId}
        onProviderChange={handleProviderChange}
        minRetainedSessionLogsThreshold={retentionThreshold}
        onRetentionThresholdChange={handleRetentionThresholdChange}
      />
      <p className="text-muted" style={{ fontSize: 11, margin: "var(--space-2) var(--space-4) 0" }}>
        {health ? `status: ${health.status} · v${health.version}` : "Checking server…"}
      </p>
      {fetchError && (
        <p
          role="alert"
          style={{ fontSize: 12, margin: "var(--space-2) var(--space-4) 0", color: "var(--color-accent-800)" }}
        >
          {fetchError}
        </p>
      )}
      {showConfigBanner && (
        <ConfigWarningBanner warnings={configWarnings} onDismiss={() => setShowConfigBanner(false)} />
      )}

      {inspectorOpen && session ? (
        <SystemPromptInspector
          sessionId={session.id}
          sessionTitle={session.title}
          model={session.model}
          providerId={session.providerId}
          onClose={() => setInspectorOpen(false)}
        />
      ) : turnInspectorOpen && session ? (
        <TurnInspector
          sessionId={session.id}
          turnIndex={selectedTurnIndex}
          sessionTitle={session.title}
          triggeredEvent={selectedTurn?.triggeredEvent}
          usageDataAvailable={session.usageDataAvailable}
          onClose={() => setTurnInspectorOpen(false)}
        />
      ) : showEmptyState ? (
        <div style={{ padding: "var(--space-8) var(--space-4)", display: "flex", justifyContent: "center" }}>
          <Blueprint style={{ maxWidth: 420, padding: "var(--space-4)", textAlign: "center" }}>
            <div className="card-title" style={{ marginBottom: 6 }}>
              {EMPTY_STATES[mode].title}
            </div>
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              {EMPTY_STATES[mode].body}
            </p>
          </Blueprint>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "280px 1fr 340px",
            gap: "var(--space-4)",
            padding: "var(--space-4)",
            alignItems: "start",
          }}
        >
          <div>
            <SessionList
              mode={mode}
              sessions={listForMode}
              selectedSessionId={session?.id ?? null}
              onSelect={handleSelectSession}
              adviceSelection={adviceSelection}
              onToggleAdvice={handleToggleAdvice}
            />
            <AdviceExportTriggerBar count={adviceSessions.length} onExport={() => setAdviceDialogOpen(true)} />
            <AdviceExportDialog
              sessions={adviceSessions}
              open={adviceDialogOpen}
              onClose={() => setAdviceDialogOpen(false)}
            />
          </div>

          <div>
            {session ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    flexWrap: "wrap",
                    marginBottom: "var(--space-3)",
                  }}
                >
                  <h3 className="truncate" style={{ margin: 0, maxWidth: 360 }}>
                    {session.title}
                  </h3>
                  <Tag variant="accent">{session.model}</Tag>
                  <Tag variant={session.usageDataAvailable ? "accent" : "outline"}>
                    {session.usageDataAvailable ? "usage: known" : "usage: unavailable"}
                  </Tag>
                  {allAiCreditsKnown ? (
                    <AiCreditsSparkline turns={session.turns} />
                  ) : (
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      AI Credits: unavailable
                    </span>
                  )}
                </div>
                <TurnsTable turns={session.turns} selectedTurnIndex={selectedTurnIndex} onSelectTurn={selectTurn} />
                <div style={{ marginTop: "var(--space-4)" }}>
                  <TimelineScrubber
                    turnCount={session.turns.length}
                    selectedTurnIndex={selectedTurnIndex}
                    onSelectTurn={selectTurn}
                  />
                </div>
              </>
            ) : (
              <p className="text-muted" style={{ fontSize: 13 }}>
                Select a {mode === "learn" ? "scenario" : "session"} to view its turns.
              </p>
            )}
          </div>

          <div>
            {mode === "analyze" ? (
              <SegmentedControl
                name="right-tab"
                options={RIGHT_TAB_OPTIONS}
                value={rightTab}
                onChange={setRightTab}
                className="right-tab-seg"
              />
            ) : (
              <h6 style={{ margin: "0 0 0 var(--space-1)" }}>Explanation</h6>
            )}
            <div style={{ marginTop: "var(--space-2)" }}>
              {(mode === "learn" || rightTab === "explanation") && (
                <ExplanationPanel
                  turn={selectedTurn}
                  mode={mode}
                  toolCallsAvailable={toolCallsAvailable}
                  onOpenTurnInspector={
                    mode === "analyze" && session ? () => setTurnInspectorOpen(true) : undefined
                  }
                />
              )}
              {mode === "analyze" && rightTab === "system-prompt" && (
                <SystemPromptBreakdown
                  components={session?.systemPrompt ?? []}
                  providerId={session?.providerId}
                  onOpenInspector={session ? () => setInspectorOpen(true) : undefined}
                />
              )}
              {mode === "analyze" && rightTab === "tools" && (
                <ToolInventoryPanel entries={session?.toolInventory ?? []} />
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
