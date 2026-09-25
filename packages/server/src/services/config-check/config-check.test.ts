import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configStatusSchema } from "@copilot-cost-analyzer/domain";
import { checkConfig } from "./config-check.js";

const NOW = () => "2026-08-08T00:00:00.000Z";

describe("checkConfig", () => {
  let dir: string;
  let settingsPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "config-check-test-"));
    settingsPath = path.join(dir, "settings.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("warns settings-not-found when no settings.json could be located", () => {
    const status = checkConfig({ settingsPath: null, now: NOW });

    expect(() => configStatusSchema.parse(status)).not.toThrow();
    expect(status.vscodeUserSettingsPath).toBeNull();
    expect(status.warnings).toEqual([
      expect.objectContaining({ code: "settings-not-found" }),
    ]);
  });

  it("warns logging-disabled when the setting is off, retention is fine", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": false,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({ settingsPath, now: NOW });

    expect(status.warnings).toEqual([
      expect.objectContaining({
        code: "logging-disabled",
        settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
        currentValue: false,
        recommendedValue: true,
      }),
    ]);
  });

  it("warns retention-too-low using the VS Code default (50) when unset", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({ settingsPath, now: NOW });

    expect(status.warnings).toEqual([
      expect.objectContaining({
        code: "retention-too-low",
        settingId:
          "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
        currentValue: 50,
        recommendedValue: 200,
      }),
    ]);
  });

  it("warns retention-too-low when explicitly set below 200", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 100,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({ settingsPath, now: NOW });

    expect(status.warnings).toEqual([
      expect.objectContaining({ code: "retention-too-low", currentValue: 100 }),
    ]);
  });

  it("has no warnings when logging is enabled, retention is at least 200, and agent-traces is enabled", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({ settingsPath, now: NOW });

    expect(status.warnings).toEqual([]);
    expect(status.loggingEnabled).toBe(true);
    expect(status.maxRetainedSessionLogs).toBe(200);
  });

  it("stamps checkedAt from the injected clock", () => {
    const status = checkConfig({ settingsPath: null, now: NOW });

    expect(status.checkedAt).toBe("2026-08-08T00:00:00.000Z");
  });

  it("every warning declares an explicit severity, valid against the domain schema", () => {
    const status = checkConfig({ settingsPath: null, now: NOW });

    expect(() => configStatusSchema.parse(status)).not.toThrow();
    for (const warning of status.warnings) {
      expect(["required", "optional"]).toContain(warning.severity);
    }
  });

  it("warns agent-traces-unavailable (optional severity) when the otel setting is off", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
      }),
    );

    const status = checkConfig({ settingsPath, now: NOW });

    expect(status.warnings).toEqual([
      expect.objectContaining({
        code: "agent-traces-unavailable",
        severity: "optional",
        settingId: "github.copilot.chat.otel.dbSpanExporter.enabled",
        currentValue: false,
        recommendedValue: true,
      }),
    ]);
  });

  it("does not double-warn agent-traces-unavailable when settings.json itself couldn't be found", () => {
    const status = checkConfig({ settingsPath: null, now: NOW });

    expect(status.warnings).toEqual([
      expect.objectContaining({ code: "settings-not-found" }),
    ]);
  });

  it("falls back to 200 when no threshold is injected", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({ settingsPath, now: NOW });

    expect(status.minRetainedSessionLogsThreshold).toBe(200);
  });

  it("warns retention-too-low against a custom threshold above the current value", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({
      settingsPath,
      now: NOW,
      minRetainedSessionLogsThreshold: 300,
    });

    expect(status.minRetainedSessionLogsThreshold).toBe(300);
    expect(status.warnings).toEqual([
      expect.objectContaining({
        code: "retention-too-low",
        currentValue: 200,
        recommendedValue: 300,
      }),
    ]);
  });

  it("does not warn retention-too-low when the current value meets a custom threshold", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({
      settingsPath,
      now: NOW,
      minRetainedSessionLogsThreshold: 100,
    });

    expect(status.minRetainedSessionLogsThreshold).toBe(100);
    expect(status.warnings).toEqual([]);
  });

  it("includes minRetainedSessionLogsThreshold in the zero-warnings case", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
        "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs": 200,
        "github.copilot.chat.otel.dbSpanExporter.enabled": true,
      }),
    );

    const status = checkConfig({
      settingsPath,
      now: NOW,
      minRetainedSessionLogsThreshold: 200,
    });

    expect(() => configStatusSchema.parse(status)).not.toThrow();
    expect(status.minRetainedSessionLogsThreshold).toBe(200);
  });

  it("includes minRetainedSessionLogsThreshold in the settings-not-found branch", () => {
    const status = checkConfig({
      settingsPath: null,
      now: NOW,
      minRetainedSessionLogsThreshold: 300,
    });

    expect(() => configStatusSchema.parse(status)).not.toThrow();
    expect(status.minRetainedSessionLogsThreshold).toBe(300);
  });
});
