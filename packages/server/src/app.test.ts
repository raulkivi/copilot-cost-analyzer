import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  configStatusSchema,
  logProviderStatusSchema,
  sessionSchema,
  turnInspectorDetailSchema,
} from "@gh-cp-chat-analyser/domain";
import { createApp } from "./app.js";
import { listLearnScenarios } from "./data-sources/learn-scenarios/loader.js";
import {
  LOGGING_NEVER_ENABLED_REASON,
  TOOL_CALL_TOKEN_COUNT_UNAVAILABLE_REASON,
  USAGE_UNAVAILABLE_REASON,
} from "./services/session-enricher/session-enricher.js";
import { AGENT_TRACES_UNAVAILABLE_REASON } from "./data-sources/jsonl/session-usage-spans.js";
import { computePiFileHash } from "./data-sources/pi-agent/session-id.js";

const AGENT_TRACES_DB_SCHEMA = `
  CREATE TABLE spans (
    span_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, parent_span_id TEXT,
    name TEXT NOT NULL, start_time_ms INTEGER NOT NULL, end_time_ms INTEGER NOT NULL,
    status_code INTEGER NOT NULL DEFAULT 0, status_message TEXT,
    operation_name TEXT, provider_name TEXT, agent_name TEXT, conversation_id TEXT,
    request_model TEXT, response_model TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER, reasoning_tokens INTEGER,
    tool_name TEXT, tool_call_id TEXT, tool_type TEXT,
    chat_session_id TEXT, turn_index INTEGER, ttft_ms REAL
  );
  CREATE TABLE span_attributes (
    span_id TEXT NOT NULL REFERENCES spans(span_id) ON DELETE CASCADE,
    key TEXT NOT NULL, value TEXT, PRIMARY KEY (span_id, key)
  );
`;

function seedAgentTracesDb(
  dbPath: string,
  rows: Array<{ spanId: string; responseId: string; cacheWrite: number; reasoning: number }>,
): void {
  const db = new DatabaseSync(dbPath);
  db.exec(AGENT_TRACES_DB_SCHEMA);
  for (const row of rows) {
    db.prepare(
      `INSERT INTO spans (span_id, trace_id, name, start_time_ms, end_time_ms, operation_name, reasoning_tokens)
       VALUES (?, ?, 'chat', 0, 1, 'chat', ?)`,
    ).run(row.spanId, `trace-${row.spanId}`, row.reasoning);
    db.prepare(
      `INSERT INTO span_attributes (span_id, key, value) VALUES (?, 'gen_ai.response.id', ?)`,
    ).run(row.spanId, row.responseId);
    db.prepare(
      `INSERT INTO span_attributes (span_id, key, value) VALUES (?, 'gen_ai.usage.cache_creation.input_tokens', ?)`,
    ).run(row.spanId, String(row.cacheWrite));
  }
  db.close();
}

const SESSION_STORE_SCHEMA = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    cwd TEXT,
    repository TEXT,
    branch TEXT,
    host_type TEXT,
    summary TEXT,
    agent_name TEXT,
    agent_description TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    user_message TEXT,
    assistant_response TEXT,
    timestamp TEXT
  );
  CREATE TABLE checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    checkpoint_number INTEGER NOT NULL,
    title TEXT,
    overview TEXT,
    history TEXT,
    work_done TEXT,
    technical_details TEXT,
    important_files TEXT,
    next_steps TEXT,
    created_at TEXT
  );
  CREATE TABLE session_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    tool_name TEXT,
    turn_index INTEGER,
    first_seen_at TEXT
  );
`;

function seedFixtureDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec(SESSION_STORE_SCHEMA);
  db.exec(`
    INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at)
    VALUES
      ('session-1', '/repo', 'org/repo', 'main', 'desktop', 'Fix the bug', 'GitHub Copilot Chat', 'chat', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('session-2', '/repo', 'org/repo', 'main', 'desktop', 'Not chat', 'panel/editAgent', 'edit', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

    INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)
    VALUES
      ('session-1', 0, 'hi', 'hello', '2026-01-01T00:00:00.000Z');
  `);
  db.close();
}

// Missing "turns" table: the sessions table's turn_count subquery (and
// getTurnRows) throws a genuine SQLite error, simulating a corrupted store.
function seedCorruptedDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      repository TEXT,
      branch TEXT,
      host_type TEXT,
      summary TEXT,
      agent_name TEXT,
      agent_description TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    INSERT INTO sessions (id, cwd, repository, branch, host_type, summary, agent_name, agent_description, created_at, updated_at)
    VALUES ('session-1', '/repo', 'org/repo', 'main', 'desktop', 'Fix the bug', 'GitHub Copilot Chat', 'chat', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  `);
  db.close();
}

describe("GET /api/health", () => {
  it("returns ok status and the app version", async () => {
    const app = createApp();

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", version: "0.7.0" });
  });
});

describe("GET /api/learn/scenarios", () => {
  it("returns every bundled learn scenario as valid Sessions", async () => {
    const app = createApp();

    const response = await request(app).get("/api/learn/scenarios");

    expect(response.status).toBe(200);
    expect(response.body.length).toBe(listLearnScenarios().length);
    for (const scenario of response.body) {
      expect(() => sessionSchema.parse(scenario)).not.toThrow();
      expect(scenario.mode).toBe("learn");
    }
  });
});

describe("GET /api/learn/scenarios/:id", () => {
  it("returns the full Session for a known scenario id", async () => {
    const app = createApp();
    const [expected] = listLearnScenarios();

    const response = await request(app).get(
      `/api/learn/scenarios/${expected.id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expected);
  });

  it("returns 404 for an unknown scenario id", async () => {
    const app = createApp();

    const response = await request(app).get(
      "/api/learn/scenarios/does-not-exist",
    );

    expect(response.status).toBe(404);
  });
});

describe("GET /api/sessions", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-test-session-store-"));
    dbPath = path.join(dir, "session-store.db");
    seedFixtureDb(dbPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns only GitHub Copilot Chat sessions as schema-valid summaries", async () => {
    const app = createApp({ sessionStoreDbPath: dbPath });

    const response = await request(app).get("/api/sessions");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    const [session] = response.body;
    expect(() => sessionSchema.parse(session)).not.toThrow();
    expect(session.id).toBe("session-1");
    expect(session.mode).toBe("analyze");
    expect(session.turns).toEqual([]);
  });

  it("returns an empty list when no session store db is available", async () => {
    const app = createApp({
      sessionStoreDbPath: path.join(dir, "does-not-exist.db"),
    });

    const response = await request(app).get("/api/sessions");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("populates costAiCredits per session by reading its main.jsonl", async () => {
    const debugLogsDirPath = path.join(dir, "debug-logs");
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    const lines = [
      { v: 1, ts: 1, dur: 0, sid: "session-1", type: "user_message", name: "user_message", spanId: "u0", status: "ok", attrs: { content: "hi" } },
      {
        v: 1, ts: 2, dur: 5, sid: "session-1", type: "llm_request", name: "llm_request", spanId: "b", status: "ok",
        attrs: { model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 50, cachedTokens: 200, copilotUsageNanoAiu: 2_790_000_000 },
      },
    ];
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
    const app = createApp({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDirPath] });

    const response = await request(app).get("/api/sessions");

    const [session] = response.body;
    expect(() => sessionSchema.parse(session)).not.toThrow();
    expect(session.costAiCredits).toEqual({ known: true, value: 2.79 });
  });

  it("leaves costAiCredits unavailable when main.jsonl is missing for a session", async () => {
    const app = createApp({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [path.join(dir, "debug-logs")],
    });

    const response = await request(app).get("/api/sessions");

    const [session] = response.body;
    expect(session.costAiCredits).toEqual({
      known: false,
      reason: USAGE_UNAVAILABLE_REASON,
    });
  });
});

describe("GET /api/sessions/:id", () => {
  let dir: string;
  let dbPath: string;
  let debugLogsDirPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-test-session-store-"));
    dbPath = path.join(dir, "session-store.db");
    seedFixtureDb(dbPath);
    debugLogsDirPath = path.join(dir, "debug-logs");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the full analyzed session with real turns, usage marked unavailable", async () => {
    const app = createApp({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
    });

    const response = await request(app).get("/api/sessions/session-1");

    expect(response.status).toBe(200);
    expect(() => sessionSchema.parse(response.body)).not.toThrow();
    expect(response.body.turns).toHaveLength(1);
    expect(response.body.turns[0].userMessage).toBe("hi");
    expect(response.body.turns[0].usage.uncachedInput).toEqual({
      known: false,
      reason: USAGE_UNAVAILABLE_REASON,
    });
    expect(response.body.usageDataAvailable).toBe(false);
  });

  it("returns a 500 instead of hanging when an error occurs while building the session", async () => {
    const corruptDir = mkdtempSync(path.join(tmpdir(), "app-test-corrupt-store-"));
    const corruptDbPath = path.join(corruptDir, "session-store.db");
    seedCorruptedDb(corruptDbPath);

    const app = createApp({
      sessionStoreDbPath: corruptDbPath,
      debugLogsDirPaths: [path.join(corruptDir, "debug-logs")],
    });

    const response = await request(app).get("/api/sessions/session-1");

    expect(response.status).toBe(500);

    rmSync(corruptDir, { recursive: true, force: true });
  });

  it("uses the actionable reason when main.jsonl only has a session_start line", async () => {
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      `${JSON.stringify({ v: 1, ts: 1, dur: 0, sid: "session-1", type: "session_start", name: "session_start", spanId: "a", status: "ok", attrs: {} })}\n`,
    );
    const app = createApp({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
    });

    const response = await request(app).get("/api/sessions/session-1");

    expect(response.body.turns[0].usage.uncachedInput).toEqual({
      known: false,
      reason: LOGGING_NEVER_ENABLED_REASON,
    });
  });

  it("uses the generic reason when main.jsonl has events but the llm_request span has an older/unknown attrs shape", async () => {
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    const lines = [
      {
        v: 1,
        ts: 1,
        dur: 0,
        sid: "session-1",
        type: "session_start",
        name: "session_start",
        spanId: "a",
        status: "ok",
        attrs: {},
      },
      {
        v: 1,
        ts: 2,
        dur: 5,
        sid: "session-1",
        type: "llm_request",
        name: "llm_request",
        spanId: "b",
        status: "ok",
        attrs: {},
      },
    ];
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
    const app = createApp({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
    });

    const response = await request(app).get("/api/sessions/session-1");

    expect(response.body.turns[0].usage.uncachedInput).toEqual({
      known: false,
      reason: USAGE_UNAVAILABLE_REASON,
    });
    expect(response.body.usageDataAvailable).toBe(false);
  });

  it("returns real per-turn token numbers extracted from a session's llm_request spans", async () => {
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    const lines = [
      {
        v: 1,
        ts: 1,
        dur: 0,
        sid: "session-1",
        type: "session_start",
        name: "session_start",
        spanId: "a",
        status: "ok",
        attrs: {},
      },
      {
        v: 1,
        ts: 2,
        dur: 0,
        sid: "session-1",
        type: "user_message",
        name: "user_message",
        spanId: "u0",
        status: "ok",
        attrs: { content: "hi" },
      },
      {
        v: 1,
        ts: 3,
        dur: 5,
        sid: "session-1",
        type: "llm_request",
        name: "llm_request",
        spanId: "b",
        status: "ok",
        attrs: {
          model: "claude-sonnet-5",
          inputTokens: 1000,
          outputTokens: 50,
          cachedTokens: 200,
        },
      },
    ];
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
    const app = createApp({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
    });

    const response = await request(app).get("/api/sessions/session-1");

    expect(() => sessionSchema.parse(response.body)).not.toThrow();
    expect(response.body.turns[0].usage.uncachedInput).toEqual({
      known: true,
      value: 800,
    });
    expect(response.body.turns[0].usage.cacheRead).toEqual({
      known: true,
      value: 200,
    });
    expect(response.body.turns[0].usage.output).toEqual({
      known: true,
      value: 50,
    });
    expect(response.body.turns[0].usage.model).toBe("claude-sonnet-5");
    expect(response.body.usageDataAvailable).toBe(true);
    expect(response.body.model).toBe("claude-sonnet-5");
  });

  it("leaves cacheWrite/reasoning unavailable (actionable reason) when agent-traces.db isn't configured", async () => {
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    const lines = [
      { v: 1, ts: 1, dur: 0, sid: "session-1", type: "user_message", name: "user_message", spanId: "u0", status: "ok", attrs: { content: "hi" } },
      {
        v: 1, ts: 2, dur: 5, sid: "session-1", type: "llm_request", name: "llm_request", spanId: "b", status: "ok",
        attrs: { model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 50, cachedTokens: 200, responseId: "resp-a" },
      },
    ];
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
    const app = createApp({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
      agentTracesDbPath: null,
    });

    const response = await request(app).get("/api/sessions/session-1");

    expect(response.body.turns[0].usage.cacheWrite).toEqual({
      known: false,
      reason: AGENT_TRACES_UNAVAILABLE_REASON,
    });
    expect(response.body.turns[0].usage.reasoning).toEqual({
      known: false,
      reason: AGENT_TRACES_UNAVAILABLE_REASON,
    });
  });

  it("populates cacheWrite/reasoning, summed across a turn's requests, from agent-traces.db when available", async () => {
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    const lines = [
      { v: 1, ts: 1, dur: 0, sid: "session-1", type: "user_message", name: "user_message", spanId: "u0", status: "ok", attrs: { content: "hi" } },
      {
        v: 1, ts: 2, dur: 5, sid: "session-1", type: "llm_request", name: "llm_request", spanId: "b", status: "ok",
        attrs: { model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 50, cachedTokens: 200, responseId: "resp-a" },
      },
      {
        v: 1, ts: 3, dur: 5, sid: "session-1", type: "llm_request", name: "llm_request", spanId: "c", status: "ok",
        attrs: { model: "claude-sonnet-5", inputTokens: 500, outputTokens: 20, cachedTokens: 100, responseId: "resp-b" },
      },
    ];
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
    const agentTracesDbPath = path.join(dir, "agent-traces.db");
    seedAgentTracesDb(agentTracesDbPath, [
      { spanId: "span-a", responseId: "resp-a", cacheWrite: 16860, reasoning: 119 },
      { spanId: "span-b", responseId: "resp-b", cacheWrite: 1618, reasoning: 0 },
    ]);
    const app = createApp({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
      agentTracesDbPath,
    });

    const response = await request(app).get("/api/sessions/session-1");

    expect(response.body.turns[0].usage.cacheWrite).toEqual({ known: true, value: 18478 });
    expect(response.body.turns[0].usage.reasoning).toEqual({ known: true, value: 119 });
    // Unrelated fields are unaffected by this enrichment.
    expect(response.body.turns[0].usage.uncachedInput).toEqual({ known: true, value: 1200 });
  });

  it("populates systemPrompt, toolInventory, and merges jsonl-only tool calls (Phase 6)", async () => {
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    const lines = [
      {
        v: 1,
        ts: 1,
        dur: 0,
        sid: "session-1",
        type: "session_start",
        name: "session_start",
        spanId: "a",
        status: "ok",
        attrs: {},
      },
      {
        v: 1,
        ts: 2,
        dur: 0,
        sid: "session-1",
        type: "user_message",
        name: "user_message",
        spanId: "u0",
        status: "ok",
        attrs: { content: "hi" },
      },
      {
        v: 1,
        ts: 3,
        dur: 5,
        sid: "session-1",
        type: "tool_call",
        name: "read_file",
        spanId: "t0",
        status: "ok",
        attrs: {},
      },
      {
        v: 1,
        ts: 4,
        dur: 5,
        sid: "session-1",
        type: "llm_request",
        name: "llm_request",
        spanId: "b",
        status: "ok",
        attrs: {
          model: "claude-sonnet-5",
          inputTokens: 1000,
          outputTokens: 50,
          cachedTokens: 200,
          systemPromptFile: "system_prompt_0.json",
          toolsFile: "tools_0.json",
        },
      },
    ];
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
    writeFileSync(
      path.join(sessionLogDir, "system_prompt_0.json"),
      JSON.stringify({
        content: JSON.stringify([
          { type: "text", content: "You are a helpful assistant." },
        ]),
      }),
    );
    writeFileSync(
      path.join(sessionLogDir, "tools_0.json"),
      JSON.stringify({
        content: JSON.stringify([
          { type: "function", name: "read_file", description: "d", parameters: {} },
          { type: "function", name: "create_file", description: "d", parameters: {} },
        ]),
      }),
    );
    const app = createApp({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
    });

    const response = await request(app).get("/api/sessions/session-1");

    expect(() => sessionSchema.parse(response.body)).not.toThrow();
    expect(response.body.toolInventory).toEqual([
      { name: "read_file", loaded: true, invokedInTurns: [0] },
      { name: "create_file", loaded: true, invokedInTurns: [] },
    ]);
    expect(response.body.systemPrompt).toEqual([
      {
        kind: "built-in",
        label: "Base system prompt (28 characters)",
        tokenCount: { known: true, value: expect.any(Number), estimated: true },
      },
      {
        kind: "tool-definitions",
        label: "Tool definitions (2 tools)",
        tokenCount: { known: true, value: expect.any(Number), estimated: true },
      },
    ]);
    expect(response.body.turns[0].toolCalls).toEqual([
      {
        name: "read_file",
        argsSummary: "",
        tokenCount: {
          known: false,
          reason: TOOL_CALL_TOKEN_COUNT_UNAVAILABLE_REASON,
        },
      },
    ]);
  });

  it("returns 404 for a session filtered out by the agent_name scoping rule", async () => {
    const app = createApp({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
    });

    const response = await request(app).get("/api/sessions/session-2");

    expect(response.status).toBe(404);
  });

  it("returns 404 for an unknown session id", async () => {
    const app = createApp({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [debugLogsDirPath],
    });

    const response = await request(app).get("/api/sessions/does-not-exist");

    expect(response.status).toBe(404);
  });

  it("returns 404 when no session store db is available", async () => {
    const app = createApp({
      sessionStoreDbPath: path.join(dir, "does-not-exist.db"),
      debugLogsDirPaths: [debugLogsDirPath],
    });

    const response = await request(app).get("/api/sessions/session-1");

    expect(response.status).toBe(404);
  });
});

describe("GET /api/sessions/:id/turns/:turnIndex", () => {
  let dir: string;
  let dbPath: string;
  let debugLogsDirPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-test-turn-detail-"));
    dbPath = path.join(dir, "session-store.db");
    seedFixtureDb(dbPath);
    debugLogsDirPath = path.join(dir, "debug-logs");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a schema-valid TurnInspectorDetail for a turn with captured round-trip data", async () => {
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    const lines = [
      { type: "user_message", attrs: { content: "hi" } },
      { type: "llm_request", attrs: { inputMessages: [{ role: "system", content: "You are an agent." }] } },
      { type: "agent_response", attrs: { response: "hello" } },
    ];
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
    const app = createApp({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDirPath] });

    const response = await request(app).get("/api/sessions/session-1/turns/0");

    expect(response.status).toBe(200);
    expect(() => turnInspectorDetailSchema.parse(response.body)).not.toThrow();
    expect(response.body.rounds).toHaveLength(1);
  });

  it("returns 404 for an unknown session id", async () => {
    const app = createApp({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDirPath] });

    const response = await request(app).get("/api/sessions/does-not-exist/turns/0");

    expect(response.status).toBe(404);
  });

  it("returns 404 for a turnIndex the session doesn't have", async () => {
    const app = createApp({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDirPath] });

    const response = await request(app).get("/api/sessions/session-1/turns/99");

    expect(response.status).toBe(404);
  });

  it("returns 400 for a non-numeric turnIndex", async () => {
    const app = createApp({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDirPath] });

    const response = await request(app).get("/api/sessions/session-1/turns/not-a-number");

    expect(response.status).toBe(400);
  });

  it("returns 400 for a negative turnIndex", async () => {
    const app = createApp({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDirPath] });

    const response = await request(app).get("/api/sessions/session-1/turns/-1");

    expect(response.status).toBe(400);
  });
});

describe("GET /api/sessions/:id/system-prompt", () => {
  let dir: string;
  let dbPath: string;
  let debugLogsDirPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-test-system-prompt-"));
    dbPath = path.join(dir, "state.vscdb");
    debugLogsDirPath = path.join(dir, "debug-logs");
    seedFixtureDb(dbPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the full raw system prompt text as text/plain", async () => {
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    const lines = [
      {
        v: 1, ts: 1, dur: 0, sid: "session-1", type: "session_start", name: "session_start", spanId: "a", status: "ok",
        attrs: {},
      },
      {
        v: 1, ts: 2, dur: 5, sid: "session-1", type: "llm_request", name: "llm_request", spanId: "b", status: "ok",
        attrs: { model: "claude-sonnet-5", systemPromptFile: "system_prompt_0.json", toolsFile: "tools_0.json" },
      },
    ];
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
    writeFileSync(
      path.join(sessionLogDir, "system_prompt_0.json"),
      JSON.stringify({
        content: JSON.stringify([
          { type: "text", content: "You are a helpful assistant." },
        ]),
      }),
    );
    const app = createApp({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDirPath] });

    const response = await request(app).get("/api/sessions/session-1/system-prompt");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/plain/);
    expect(response.text).toBe("You are a helpful assistant.");
  });

  it("returns 404 when the session has no captured system-prompt artifact", async () => {
    const sessionLogDir = path.join(debugLogsDirPath, "session-1");
    mkdirSync(sessionLogDir, { recursive: true });
    writeFileSync(
      path.join(sessionLogDir, "main.jsonl"),
      `${JSON.stringify({ v: 1, ts: 1, dur: 0, sid: "session-1", type: "session_start", name: "session_start", spanId: "a", status: "ok", attrs: {} })}\n`,
    );
    const app = createApp({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDirPath] });

    const response = await request(app).get("/api/sessions/session-1/system-prompt");

    expect(response.status).toBe(404);
  });

  it("returns 404 for an unknown session id", async () => {
    const app = createApp({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDirPath] });

    const response = await request(app).get("/api/sessions/does-not-exist/system-prompt");

    expect(response.status).toBe(404);
  });
});

describe("GET /api/sessions/:id/system-prompt (pi-agent provider active)", () => {
  const piAgentFixturesDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../fixtures/pi-agent",
  );
  const normalSessionPath = path.join(piAgentFixturesDir, "normal-session.jsonl");

  let dir: string;
  let appSettingsDir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-test-pi-system-prompt-"));
    appSettingsDir = path.join(dir, "app-settings");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeSidecarLog(sessionFile: string): string {
    const logPath = path.join(dir, "system-prompts.jsonl");
    writeFileSync(
      logPath,
      `${JSON.stringify({
        sessionId: "session-1",
        sessionFile,
        capturedAt: "2026-09-03T10:00:00.000Z",
        cwd: "/home/dev/project",
        systemPromptChars: 11,
        systemPrompt: "You are Pi.",
      })}\n`,
    );
    return logPath;
  }

  async function activatePiAgent(app: ReturnType<typeof createApp>) {
    await request(app).put("/api/log-providers/active").send({ id: "pi-agent" });
  }

  it("returns the real captured system prompt as text/plain for a matching sidecar record", async () => {
    const systemPromptLogPath = writeSidecarLog(normalSessionPath);
    const app = createApp({
      appSettingsDir,
      piAgentSessionsDirPath: piAgentFixturesDir,
      systemPromptLogPath,
    });
    await activatePiAgent(app);
    const id = computePiFileHash(normalSessionPath);

    const response = await request(app).get(`/api/sessions/${id}/system-prompt`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/plain/);
    expect(response.text).toBe("You are Pi.");
  });

  it("returns 404 for a pi-agent session with no matching sidecar record", async () => {
    const systemPromptLogPath = writeSidecarLog("/some/other/session.jsonl");
    const app = createApp({
      appSettingsDir,
      piAgentSessionsDirPath: piAgentFixturesDir,
      systemPromptLogPath,
    });
    await activatePiAgent(app);
    const id = computePiFileHash(normalSessionPath);

    const response = await request(app).get(`/api/sessions/${id}/system-prompt`);

    expect(response.status).toBe(404);
  });

  it("returns 404 for an unknown pi-agent session id", async () => {
    const app = createApp({ appSettingsDir, piAgentSessionsDirPath: piAgentFixturesDir });
    await activatePiAgent(app);

    const response = await request(app).get("/api/sessions/does-not-exist/system-prompt");

    expect(response.status).toBe(404);
  });
});

describe("GET /api/config/status", () => {
  let dir: string;
  let settingsPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-test-vscode-settings-"));
    settingsPath = path.join(dir, "settings.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a settings-not-found warning when no settings.json is configured", async () => {
    const app = createApp({ vscodeSettingsPath: null });

    const response = await request(app).get("/api/config/status");

    expect(response.status).toBe(200);
    expect(() => configStatusSchema.parse(response.body)).not.toThrow();
    expect(response.body.warnings).toEqual([
      expect.objectContaining({ code: "settings-not-found" }),
    ]);
  });

  it("returns no warnings once logging is enabled and retention is at least 200", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );
    const app = createApp({ vscodeSettingsPath: settingsPath });

    const response = await request(app).get("/api/config/status");

    expect(response.status).toBe(200);
    expect(() => configStatusSchema.parse(response.body)).not.toThrow();
    expect(response.body.warnings).toEqual([]);
  });
});

describe("PUT /api/config/retention-threshold", () => {
  let dir: string;
  let appSettingsDir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-test-retention-threshold-"));
    appSettingsDir = path.join(dir, "app-settings");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function buildApp(overrides: Parameters<typeof createApp>[0] = {}) {
    return createApp({ vscodeSettingsPath: null, appSettingsDir, ...overrides });
  }

  it("GET /api/config/status defaults to 200 on a fresh settings dir", async () => {
    const app = buildApp();

    const response = await request(app).get("/api/config/status");

    expect(response.status).toBe(200);
    expect(() => configStatusSchema.parse(response.body)).not.toThrow();
    expect(response.body.minRetainedSessionLogsThreshold).toBe(200);
  });

  it("PUT with a valid value returns the updated ConfigStatus", async () => {
    const app = buildApp();

    const response = await request(app)
      .put("/api/config/retention-threshold")
      .send({ value: 300 });

    expect(response.status).toBe(200);
    expect(() => configStatusSchema.parse(response.body)).not.toThrow();
    expect(response.body.minRetainedSessionLogsThreshold).toBe(300);
  });

  it("persists across a fresh createApp instance with the same appSettingsDir", async () => {
    const app1 = buildApp();
    await request(app1).put("/api/config/retention-threshold").send({ value: 300 });

    const app2 = buildApp();
    const response = await request(app2).get("/api/config/status");

    expect(response.body.minRetainedSessionLogsThreshold).toBe(300);
  });

  it.each([
    ["missing value", {}],
    ["non-number value", { value: "300" }],
    ["zero value", { value: 0 }],
    ["negative value", { value: -5 }],
    ["non-integer value", { value: 1.5 }],
  ])("rejects %s with a 4xx", async (_label, body) => {
    const app = buildApp();

    const response = await request(app).put("/api/config/retention-threshold").send(body);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});

describe("GET /api/log-providers and PUT /api/log-providers/active", () => {
  let dir: string;
  let dbPath: string;
  let appSettingsDir: string;
  let mitmproxyCapturesDirPath: string;
  let piAgentSessionsDirPath: string;
  let claudeCodeProjectsDirPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-test-log-providers-"));
    dbPath = path.join(dir, "session-store.db");
    seedFixtureDb(dbPath);
    appSettingsDir = path.join(dir, "app-settings");
    mitmproxyCapturesDirPath = path.join(dir, "mitmproxy-captures");
    piAgentSessionsDirPath = path.join(dir, "pi-agent-sessions");
    claudeCodeProjectsDirPath = path.join(dir, "claude-code-projects");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function buildApp(overrides: Parameters<typeof createApp>[0] = {}) {
    return createApp({
      sessionStoreDbPath: dbPath,
      debugLogsDirPaths: [path.join(dir, "debug-logs")],
      appSettingsDir,
      mitmproxyCapturesDirPath,
      piAgentSessionsDirPath,
      claudeCodeProjectsDirPath,
      ...overrides,
    });
  }

  it("defaults to vscode active with all providers listed", async () => {
    const app = buildApp();

    const response = await request(app).get("/api/log-providers");

    expect(response.status).toBe(200);
    expect(() => logProviderStatusSchema.parse(response.body)).not.toThrow();
    expect(response.body.activeProviderId).toBe("vscode");
    const ids = response.body.providers.map((p: { id: string }) => p.id);
    expect(ids).toEqual(["vscode", "mitmproxy", "pi-agent", "claude-code"]);
    expect(response.body.providers.find((p: { id: string }) => p.id === "vscode").available).toBe(true);
    expect(response.body.providers.find((p: { id: string }) => p.id === "mitmproxy").available).toBe(false);
    expect(response.body.providers.find((p: { id: string }) => p.id === "pi-agent").available).toBe(false);
    expect(response.body.providers.find((p: { id: string }) => p.id === "claude-code").available).toBe(false);
  });

  it("rejects PUT to an unregistered provider id with a 4xx", async () => {
    const app = buildApp();

    const response = await request(app)
      .put("/api/log-providers/active")
      .send({ id: "does-not-exist" });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("PUT persists the active provider so a later GET reflects it, across a fresh app instance", async () => {
    mkdirSync(mitmproxyCapturesDirPath, { recursive: true });
    const app1 = buildApp();

    const putResponse = await request(app1)
      .put("/api/log-providers/active")
      .send({ id: "mitmproxy" });
    expect(putResponse.status).toBe(200);
    expect(putResponse.body.activeProviderId).toBe("mitmproxy");

    const app2 = buildApp();
    const getResponse = await request(app2).get("/api/log-providers");
    expect(getResponse.body.activeProviderId).toBe("mitmproxy");
  });

  it("GET /api/sessions reads from whichever provider is active, with no endpoint-level branching", async () => {
    const fixturesDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../fixtures/mitmproxy",
    );
    mkdirSync(mitmproxyCapturesDirPath, { recursive: true });
    writeFileSync(
      path.join(mitmproxyCapturesDirPath, "capture.har"),
      readFileSync(path.join(fixturesDir, "anthropic-non-streamed.har")),
    );
    const app = buildApp();
    await request(app).put("/api/log-providers/active").send({ id: "mitmproxy" });

    const response = await request(app).get("/api/sessions");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].providerId).toBe("mitmproxy");
    for (const session of response.body) {
      expect(() => sessionSchema.parse(session)).not.toThrow();
    }
  });
});
