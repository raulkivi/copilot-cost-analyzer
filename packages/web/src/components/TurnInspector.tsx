import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
  ContentPlaceholder,
  MessageContentPart,
  TriggeredEvent,
  TurnInspectorDetail,
} from "@copilot-cost-analyzer/domain";
import { fetchTurnInspectorDetail } from "../api-client/sessions.js";
import { TRIGGER_LABELS } from "../lib/trigger-labels.js";
import { buildPrettyTokens, PAYLOAD_TOKEN_COLORS, unescapeText } from "../lib/turn-payload-pretty.js";
import type { PayloadToken } from "../lib/turn-payload-pretty.js";
import { Blueprint } from "./ui/Blueprint.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";
import { Tag } from "./ui/Tag.js";

interface TurnInspectorProps {
  sessionId: string;
  turnIndex: number;
  sessionTitle?: string;
  triggeredEvent?: TriggeredEvent;
  // Session.usageDataAvailable, already known from the GET /api/sessions/:id
  // call the UI made before this could be opened — lets the empty state
  // pick the right message without waiting on this endpoint's own fetch.
  usageDataAvailable: boolean;
  onClose: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; detail: TurnInspectorDetail };

type PayloadFormat = "pretty" | "raw";

const FORMAT_OPTIONS = [
  { value: "pretty", label: "Pretty" },
  { value: "raw", label: "Raw" },
] as const;

const SUB_LABEL_STYLE = {
  fontSize: 10,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
};

const PAYLOAD_PRE_STYLE = {
  margin: 0,
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
  fontFamily: "monospace",
  fontSize: 12,
  lineHeight: 1.6,
};

const NO_LOGGING_MESSAGE =
  "No request/response data captured for this session — enable agentDebugLog.fileLogging.enabled and reload VS Code.";
const NO_ROUND_TRIP_MESSAGE = "This turn made no request to the model.";
const LOAD_FAILED_MESSAGE = "Failed to load this turn's request/response data.";
const ENCRYPTED_REASONING_TEXT = "[encrypted]";

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentLabel(part: ContentPlaceholder): string {
  if (part.kind === "image") {
    return "image";
  }
  const size = part.sizeBytes !== undefined ? formatBytes(part.sizeBytes) : undefined;
  if (part.path) {
    return size ? `${part.path} · ${size}` : part.path;
  }
  return size ?? "file";
}

function payloadTokens(text: string, format: PayloadFormat): PayloadToken[] {
  if (format === "raw") {
    return [{ text, color: PAYLOAD_TOKEN_COLORS.plain }];
  }
  return buildPrettyTokens(text) ?? [{ text: unescapeText(text), color: PAYLOAD_TOKEN_COLORS.plain }];
}

function renderTokens(tokens: PayloadToken[]): ReactNode {
  return tokens.map((token, index) => (
    <span key={index} style={{ color: token.color }}>
      {token.text}
    </span>
  ));
}

// A round's reasoning is a known condition, not content, when the provider
// withholds it entirely — recognizable as a lone text part whose literal
// value is the provider's own placeholder string.
function isEncryptedReasoning(parts: MessageContentPart[]): boolean {
  return parts.length === 1 && parts[0].kind === "text" && parts[0].text.trim() === ENCRYPTED_REASONING_TEXT;
}

function SubLabel({ children }: { children: ReactNode }) {
  return <div style={{ ...SUB_LABEL_STYLE, marginBottom: 4 }}>{children}</div>;
}

function ContentPartsView({
  parts,
  format,
  maxHeight,
}: {
  parts: MessageContentPart[];
  format: PayloadFormat;
  maxHeight: number;
}) {
  if (parts.length === 0) {
    return (
      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
        —
      </p>
    );
  }
  return (
    <div style={{ maxHeight, overflowY: "auto" }}>
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <pre key={index} style={PAYLOAD_PRE_STYLE}>
            {renderTokens(payloadTokens(part.text, format))}
          </pre>
        ) : (
          <Tag key={index} variant="outline" style={{ display: "inline-flex", margin: "2px 4px 2px 0" }}>
            {attachmentLabel(part)}
          </Tag>
        ),
      )}
    </div>
  );
}

function UserMessageView({ parts }: { parts: MessageContentPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <p key={index} style={{ margin: 0, fontSize: 14 }}>
            {part.text}
          </p>
        ) : (
          <Tag key={index} variant="outline" style={{ display: "inline-flex", margin: "2px 4px 2px 0" }}>
            {attachmentLabel(part)}
          </Tag>
        ),
      )}
    </>
  );
}

function ToolCallsView({
  toolCalls,
  format,
}: {
  toolCalls: TurnInspectorDetail["rounds"][number]["request"]["toolCalls"];
  format: PayloadFormat;
}) {
  if (toolCalls.length === 0) {
    return null;
  }
  return (
    <div
      style={{
        marginBottom: "var(--space-3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      {toolCalls.map((toolCall, index) => (
        <div key={`${toolCall.name}-${index}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Tag variant="neutral" style={{ fontFamily: "monospace", alignSelf: "flex-start" }}>
            {toolCall.name}
          </Tag>
          <SubLabel>Args</SubLabel>
          <ContentPartsView parts={toolCall.args} format={format} maxHeight={140} />
          <SubLabel>Result</SubLabel>
          <ContentPartsView parts={toolCall.result} format={format} maxHeight={140} />
        </div>
      ))}
    </div>
  );
}

export function TurnInspector({
  sessionId,
  turnIndex,
  sessionTitle,
  triggeredEvent,
  usageDataAvailable,
  onClose,
}: TurnInspectorProps) {
  const [state, setState] = useState<LoadState>(
    usageDataAvailable ? { status: "loading" } : { status: "error" },
  );
  const [format, setFormat] = useState<PayloadFormat>("pretty");
  const [selectedRound, setSelectedRound] = useState(0);

  useEffect(() => {
    setSelectedRound(0);
    if (!usageDataAvailable) {
      setState({ status: "error" });
      return;
    }
    let canceled = false;
    setState({ status: "loading" });
    fetchTurnInspectorDetail(sessionId, turnIndex)
      .then((detail) => {
        if (!canceled) setState({ status: "ready", detail });
      })
      .catch(() => {
        if (!canceled) setState({ status: "error" });
      });
    return () => {
      canceled = true;
    };
  }, [sessionId, turnIndex, usageDataAvailable]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          ← Back to session
        </button>
        {sessionTitle && (
          <span className="text-muted" style={{ fontSize: 12 }}>
            {sessionTitle}
          </span>
        )}
        <h4 style={{ margin: 0 }}>Turn {turnIndex + 1} inspector</h4>
        {triggeredEvent && <Tag variant="outline">{TRIGGER_LABELS[triggeredEvent]}</Tag>}
        <div style={{ marginLeft: "auto" }}>
          <SegmentedControl name="turnFormat" options={FORMAT_OPTIONS} value={format} onChange={setFormat} />
        </div>
      </div>

      {state.status === "loading" && <p className="text-muted">Loading turn detail…</p>}
      {state.status === "error" && (
        <p className="text-muted">{usageDataAvailable ? LOAD_FAILED_MESSAGE : NO_LOGGING_MESSAGE}</p>
      )}
      {state.status === "ready" && state.detail.rounds.length === 0 && (
        <p className="text-muted">{NO_ROUND_TRIP_MESSAGE}</p>
      )}

      {state.status === "ready" &&
        state.detail.rounds.length > 0 &&
        (() => {
          const { detail } = state;
          const round = detail.rounds.find((r) => r.request.index === selectedRound) ?? detail.rounds[0];
          const roundOptions = detail.rounds.map((r) => ({
            value: String(r.request.index),
            label: `Round ${r.request.index}`,
          }));

          return (
            <>
              {detail.userMessage.length > 0 && (
                <Blueprint style={{ padding: "var(--space-3)" }}>
                  <div className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>
                    User message
                  </div>
                  <UserMessageView parts={detail.userMessage} />
                </Blueprint>
              )}

              {detail.rounds.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
                  <SegmentedControl
                    name="turnRound"
                    options={roundOptions}
                    value={String(round.request.index)}
                    onChange={(value) => setSelectedRound(Number(value))}
                  />
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {detail.rounds.length} rounds in this turn
                  </span>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
                <Blueprint style={{ padding: "var(--space-3)" }}>
                  <div className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>
                    Request · round {round.request.index}
                  </div>
                  <ToolCallsView toolCalls={round.request.toolCalls} format={format} />
                  {round.request.addedMessages.length > 0 && (
                    <>
                      <SubLabel>Added messages</SubLabel>
                      <ContentPartsView parts={round.request.addedMessages} format={format} maxHeight={260} />
                    </>
                  )}
                </Blueprint>
                <Blueprint style={{ padding: "var(--space-3)" }}>
                  <div className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>
                    Response · round {round.response.index}
                  </div>
                  <ContentPartsView parts={round.response.response} format={format} maxHeight={320} />
                  {round.response.reasoning && isEncryptedReasoning(round.response.reasoning) && (
                    <div
                      style={{
                        marginTop: "var(--space-2)",
                        borderTop: "1px solid var(--color-divider)",
                        paddingTop: "var(--space-2)",
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                      }}
                    >
                      <div className="card-kicker">Reasoning</div>
                      <Tag variant="outline">encrypted</Tag>
                      <span className="text-muted" style={{ fontSize: 11 }}>
                        withheld by the provider
                      </span>
                    </div>
                  )}
                  {round.response.reasoning && !isEncryptedReasoning(round.response.reasoning) && (
                    <div
                      style={{
                        marginTop: "var(--space-2)",
                        borderTop: "1px solid var(--color-divider)",
                        paddingTop: "var(--space-2)",
                      }}
                    >
                      <div className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>
                        Reasoning
                      </div>
                      <ContentPartsView parts={round.response.reasoning} format={format} maxHeight={200} />
                    </div>
                  )}
                </Blueprint>
              </div>
            </>
          );
        })()}
    </div>
  );
}
