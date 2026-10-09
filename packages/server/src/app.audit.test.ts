import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { auditRollupSchema, sessionAuditSchema } from "@copilot-cost-analyzer/domain";
import { createApp } from "./app.js";
import { computeClaudeCodeFileHash } from "./data-sources/claude-code/session-id.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/claude-code-audit");
const sessionId = computeClaudeCodeFileHash(path.join(fixturesDir, "-home-dev-project", "bash-failures-session.jsonl"));

describe("tool-call audit API (Phase 9.10)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-audit-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function buildApp() {
    return createApp({
      sessionStoreDbPath: path.join(dir, "missing.db"),
      debugLogsDirPaths: [],
      vscodeSettingsPath: null,
      agentTracesDbPath: null,
      appSettingsDir: path.join(dir, "settings"),
      mitmproxyCapturesDirPath: null,
      piAgentSessionsDirPath: null,
      systemPromptLogPath: null,
      claudeCodeProjectsDirPath: fixturesDir,
    });
  }

  describe("GET /api/sessions/:id/audit", () => {
    it("returns the session audit for a named provider", async () => {
      const response = await request(buildApp()).get(`/api/sessions/${sessionId}/audit?provider=claude-code`);

      expect(response.status).toBe(200);
      expect(() => sessionAuditSchema.parse(response.body)).not.toThrow();
      expect(response.body.totals).toEqual({ toolCalls: 13, succeeded: 2, failed: 10, interrupted: 1, denied: 0, unknown: 0 });
    });

    it("reads through the active provider when none is named", async () => {
      const app = buildApp();
      await request(app).put("/api/log-providers/active").send({ id: "claude-code" });

      const response = await request(app).get(`/api/sessions/${sessionId}/audit`);

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBe(sessionId);
    });

    it("404s an unknown session and 400s an unknown provider", async () => {
      const app = buildApp();
      expect((await request(app).get("/api/sessions/nope/audit?provider=claude-code")).status).toBe(404);
      expect((await request(app).get(`/api/sessions/${sessionId}/audit?provider=nope`)).status).toBe(400);
    });
  });

  describe("GET /api/sessions/:id/tool-calls", () => {
    it("filters by status and failure category", async () => {
      const response = await request(buildApp()).get(
        `/api/sessions/${sessionId}/tool-calls?provider=claude-code&status=error&category=command-not-found`,
      );

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(2);
      expect(response.body.calls.map((c: { turnIndex: number }) => c.turnIndex)).toEqual([0, 1]);
    });

    it("accepts comma-separated lists, program, turn and limit", async () => {
      const response = await request(buildApp()).get(
        `/api/sessions/${sessionId}/tool-calls?provider=claude-code&status=error,interrupted&program=sleep&turn=1&limit=5`,
      );

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.calls[0].call.outcome.failureCategory).toBe("timeout");
    });

    it("400s an invalid filter value", async () => {
      const app = buildApp();
      expect((await request(app).get(`/api/sessions/${sessionId}/tool-calls?provider=claude-code&status=bogus`)).status).toBe(400);
      expect((await request(app).get(`/api/sessions/${sessionId}/tool-calls?provider=claude-code&limit=-1`)).status).toBe(400);
    });
  });

  describe("GET /api/audit", () => {
    it("returns a cross-session rollup", async () => {
      const response = await request(buildApp()).get("/api/audit?provider=claude-code&since=2026-09-01&until=2026-09-30");

      expect(response.status).toBe(200);
      expect(() => auditRollupSchema.parse(response.body)).not.toThrow();
      expect(response.body.sessionCount).toBe(1);
      expect(response.body.topFailingCommands[0]).toMatchObject({
        command: "definitely-not-installed-tool --version",
        failures: 2,
        failureCategory: "command-not-found",
      });
    });

    it("excludes sessions outside the date window", async () => {
      const response = await request(buildApp()).get("/api/audit?provider=claude-code&until=2026-01-01");
      expect(response.body.sessionCount).toBe(0);
      expect(response.body.failureRate).toBeNull();
    });

    it("400s a malformed date or limit", async () => {
      const app = buildApp();
      expect((await request(app).get("/api/audit?provider=claude-code&since=yesterday")).status).toBe(400);
      expect((await request(app).get("/api/audit?provider=claude-code&limit=0")).status).toBe(400);
    });
  });
});
