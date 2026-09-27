import { existsSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import express, { type Express } from "express";
import {
  getLearnScenario,
  listLearnScenarios,
} from "./data-sources/learn-scenarios/loader.js";
import { resolveMainJsonlPath } from "./data-sources/jsonl/session-log-path.js";
import {
  classifyEnvelopesAvailability,
  readMainJsonlFile,
} from "./data-sources/jsonl/main-jsonl-reader.js";
import { getSessionRow, openReadOnlyDb } from "./data-sources/sqlite/session-store.js";
import { resolveSystemPromptText } from "./services/session-enricher/analyze-mode-extras.js";
import { checkConfig } from "./services/config-check/config-check.js";
import {
  readMinRetainedSessionLogsThreshold,
  writeMinRetainedSessionLogsThreshold,
} from "./data-sources/log-providers/app-settings.js";
import { UnknownLogProviderIdError } from "./data-sources/log-providers/registry.js";
import { composeLogProviders, type LogProviderCompositionOptions } from "./composition/compose-log-providers.js";
import { AuditQueryService } from "./services/tool-audit/audit-query-service.js";
import { parseSessionRangeQuery, parseToolCallFilterQuery } from "./services/tool-audit/audit-query-params.js";

const APP_VERSION = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
  ) as { version: string }
).version;

export type CreateAppOptions = LogProviderCompositionOptions;

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const {
    registry,
    piAgentProvider,
    resolvedDbPath,
    resolvedDebugLogsDirPaths,
    resolvedVscodeSettingsPath,
    resolvedAppSettingsDir,
  } = composeLogProviders(options);
  const auditQueries = new AuditQueryService(registry);

  // Used only by GET /api/sessions/:id/system-prompt below, which stays
  // wired directly to the VS Code session store/main.jsonl path rather than
  // the generic LogProvider contract (see that route's own comment).
  function openSessionStoreDb(): DatabaseSync | null {
    if (!resolvedDbPath || !existsSync(resolvedDbPath)) {
      return null;
    }
    return openReadOnlyDb(resolvedDbPath);
  }

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: APP_VERSION });
  });

  app.get("/api/config/status", (_req, res) => {
    res.json(
      checkConfig({
        settingsPath: resolvedVscodeSettingsPath,
        minRetainedSessionLogsThreshold: readMinRetainedSessionLogsThreshold(resolvedAppSettingsDir),
      }),
    );
  });

  app.put("/api/config/retention-threshold", (req, res) => {
    const { value } = (req.body ?? {}) as { value?: unknown };
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      res.status(400).json({ error: "Request body must include a positive integer \"value\"." });
      return;
    }
    writeMinRetainedSessionLogsThreshold(resolvedAppSettingsDir, value);
    res.json(
      checkConfig({
        settingsPath: resolvedVscodeSettingsPath,
        minRetainedSessionLogsThreshold: readMinRetainedSessionLogsThreshold(resolvedAppSettingsDir),
      }),
    );
  });

  app.get("/api/learn/scenarios", (_req, res) => {
    res.json(listLearnScenarios());
  });

  app.get("/api/learn/scenarios/:id", (req, res) => {
    const scenario = getLearnScenario(req.params.id);
    if (!scenario) {
      res
        .status(404)
        .json({ error: `Unknown learn scenario id "${req.params.id}"` });
      return;
    }
    res.json(scenario);
  });

  app.get("/api/log-providers", async (_req, res) => {
    res.json(await registry.getStatus());
  });

  app.put("/api/log-providers/active", async (req, res) => {
    const { id } = (req.body ?? {}) as { id?: unknown };
    if (typeof id !== "string" || id.length === 0) {
      res.status(400).json({ error: "Request body must include a string \"id\"." });
      return;
    }
    try {
      registry.setActive(id);
    } catch (error) {
      if (error instanceof UnknownLogProviderIdError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
    res.json(await registry.getStatus());
  });

  // Selects the active log provider (architecture.md §6.2.1) — every
  // session endpoint below reads through this and never branches on which
  // provider is active, per the Phase 9 exit criterion.
  app.get("/api/sessions", async (_req, res) => {
    res.json(await registry.getActiveProvider().listSessions());
  });

  app.get("/api/sessions/:id", async (req, res) => {
    try {
      const session = await registry.getActiveProvider().readSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: `Unknown session id "${req.params.id}"` });
        return;
      }
      res.json(session);
    } catch (error) {
      res.status(500).json({
        error: `Failed to load session "${req.params.id}": ${(error as Error).message}`,
      });
    }
  });

  // Tool-call audit (Phase 9.10, docs/plans/tool-call-audit.md). All three
  // read through AuditQueryService — the same service the MCP server uses —
  // and accept an optional ?provider= to audit a provider other than the
  // UI's active one.
  function sendAuditError(res: express.Response, error: unknown, what: string): void {
    if (error instanceof UnknownLogProviderIdError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: `Failed to load ${what}: ${(error as Error).message}` });
  }

  function providerParam(query: Record<string, unknown>): string | undefined {
    return typeof query.provider === "string" && query.provider.length > 0 ? query.provider : undefined;
  }

  app.get("/api/sessions/:id/audit", async (req, res) => {
    try {
      const audit = await auditQueries.getSessionAudit(req.params.id, providerParam(req.query));
      if (!audit) {
        res.status(404).json({ error: `Unknown session id "${req.params.id}"` });
        return;
      }
      res.json(audit);
    } catch (error) {
      sendAuditError(res, error, `audit for session "${req.params.id}"`);
    }
  });

  app.get("/api/sessions/:id/tool-calls", async (req, res) => {
    const filter = parseToolCallFilterQuery(req.query);
    if (!filter.ok) {
      res.status(400).json({ error: filter.error });
      return;
    }
    try {
      const result = await auditQueries.listToolCalls(req.params.id, filter.value, providerParam(req.query));
      if (!result) {
        res.status(404).json({ error: `Unknown session id "${req.params.id}"` });
        return;
      }
      res.json(result);
    } catch (error) {
      sendAuditError(res, error, `tool calls for session "${req.params.id}"`);
    }
  });

  app.get("/api/audit", async (req, res) => {
    const range = parseSessionRangeQuery(req.query);
    if (!range.ok) {
      res.status(400).json({ error: range.error });
      return;
    }
    try {
      res.json(await auditQueries.getRollup(range.value));
    } catch (error) {
      sendAuditError(res, error, "audit rollup");
    }
  });

  // One turn's actual LLM request/response round-trip(s) (turn-inspector-
  // plan.md §5.6) — fetched on demand rather than sent with every turn up
  // front, since this content can be arbitrarily large. Goes through the
  // generic LogProvider contract (both vscode and mitmproxy implement
  // readTurnDetail), unlike the VS Code-only system-prompt route below.
  app.get("/api/sessions/:id/turns/:turnIndex", async (req, res) => {
    const turnIndex = Number(req.params.turnIndex);
    if (!Number.isInteger(turnIndex) || turnIndex < 0) {
      res.status(400).json({
        error: `"${req.params.turnIndex}" is not a valid turn index.`,
      });
      return;
    }

    try {
      const detail = await registry.getActiveProvider().readTurnDetail(req.params.id, turnIndex);
      if (!detail) {
        res.status(404).json({
          error: `Unknown session id "${req.params.id}" or turn index ${turnIndex}`,
        });
        return;
      }
      res.json(detail);
    } catch (error) {
      res.status(500).json({
        error: `Failed to load turn ${turnIndex} for session "${req.params.id}": ${(error as Error).message}`,
      });
    }
  });

  // Raw, uninterpreted text of the base system prompt captured for this
  // session — the "inspect as text file" counterpart to the estimated
  // token count shown in SystemPromptBreakdown. VS Code sessions (below)
  // stay wired directly to the main.jsonl artifact path rather than going
  // through the generic LogProvider contract, since that's a VS
  // Code/main.jsonl-specific concept. pi-agent sessions (branch below) read
  // through PiAgentLogProvider's own optional sidecar-log reader
  // (architecture.md §6.2.5) instead — populated only when the optional
  // pi-system-prompt-logger extension captured this session. mitmproxy and
  // claude-code sessions have no artifact of this shape at all — Claude
  // Code never writes its base system prompt to disk at all (architecture.md
  // §6.2.6) — and always 404 through the VS Code path below (the
  // session-store lookup simply never matches).
  app.get("/api/sessions/:id/system-prompt", async (req, res) => {
    if (registry.getActiveProviderId() === "pi-agent") {
      try {
        const text = await piAgentProvider.readSystemPromptText(req.params.id);
        if (text === null) {
          res.status(404).json({ error: `No system-prompt artifact captured for session "${req.params.id}"` });
          return;
        }
        res.type("text/plain").send(text);
      } catch (error) {
        res.status(500).json({
          error: `Failed to load system prompt for session "${req.params.id}": ${(error as Error).message}`,
        });
      }
      return;
    }

    const db = openSessionStoreDb();
    if (!db) {
      res.status(404).json({ error: `Unknown session id "${req.params.id}"` });
      return;
    }

    try {
      const sessionRow = getSessionRow(db, req.params.id);
      if (!sessionRow) {
        res
          .status(404)
          .json({ error: `Unknown session id "${req.params.id}"` });
        return;
      }

      const mainJsonlPath = resolveMainJsonlPath(resolvedDebugLogsDirPaths, sessionRow.id);

      const systemPromptText = mainJsonlPath
        ? await (async () => {
            const { envelopes, rawLineCount } = await readMainJsonlFile(mainJsonlPath);
            if (classifyEnvelopesAvailability(envelopes, rawLineCount) !== "events-present") {
              return null;
            }
            return resolveSystemPromptText(envelopes, mainJsonlPath);
          })()
        : null;

      if (systemPromptText === null) {
        res.status(404).json({
          error: `No system-prompt artifact captured for session "${req.params.id}"`,
        });
        return;
      }

      res.type("text/plain").send(systemPromptText);
    } catch (error) {
      res.status(500).json({
        error: `Failed to load system prompt for session "${req.params.id}": ${(error as Error).message}`,
      });
    } finally {
      db.close();
    }
  });

  return app;
}
