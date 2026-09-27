import { resolveSessionStoreDbPath } from "../data-sources/sqlite/session-store-path.js";
import { listWorkspaceDebugLogsDirPaths } from "../data-sources/jsonl/session-log-path.js";
import { resolveAgentTracesDbPath } from "../data-sources/agent-traces/agent-traces-db-path.js";
import { resolveVscodeSettingsPath } from "../data-sources/vscode-settings/vscode-settings-path.js";
import { VscodeLogProvider } from "../data-sources/log-providers/vscode/vscode-log-provider.js";
import { MitmproxyLogProvider } from "../data-sources/log-providers/mitmproxy/mitmproxy-log-provider.js";
import { defaultMitmExchangeDecoders } from "../data-sources/log-providers/mitmproxy/decoders/default-decoders.js";
import { resolveMitmproxyCapturesDir } from "../data-sources/log-providers/mitmproxy/resolve-mitmproxy-captures-dir.js";
import { PiAgentLogProvider } from "../data-sources/pi-agent/pi-agent-log-provider.js";
import { ClaudeCodeLogProvider } from "../data-sources/claude-code/claude-code-log-provider.js";
import { resolveAppSettingsDir } from "../platform/app-settings-dir/resolve-app-settings-dir.js";
import { migrateLegacyAppSettingsDir } from "../platform/app-settings-dir/migrate-legacy-app-settings-dir.js";
import { resolvePiAgentSessionsDir } from "../platform/pi-agent-paths/resolve-pi-agent-sessions-dir.js";
import { resolvePiSystemPromptLogPath } from "../platform/pi-agent-paths/resolve-pi-system-prompt-log-path.js";
import { resolveClaudeCodeProjectsDir } from "../platform/claude-code-paths/resolve-claude-code-projects-dir.js";
import { LogProviderRegistry } from "../data-sources/log-providers/registry.js";
import type { LogProvider } from "../data-sources/log-providers/log-provider.js";

export interface LogProviderCompositionOptions {
  sessionStoreDbPath?: string;
  debugLogsDirPaths?: string[];
  vscodeSettingsPath?: string | null;
  agentTracesDbPath?: string | null;
  appSettingsDir?: string;
  mitmproxyCapturesDirPath?: string | null;
  piAgentSessionsDirPath?: string | null;
  systemPromptLogPath?: string | null;
  claudeCodeProjectsDirPath?: string | null;
  // Additional providers registered alongside vscode/mitmproxy/pi-agent/claude-code — exists so
  // tests can prove the registry is open/closed (phase-9-log-providers-
  // implementation.md §8 step 9) without any other file needing to change.
  additionalLogProviders?: LogProvider[];
}

// Shared wiring for every entry point that reads sessions (the HTTP app in
// app.ts and the stdio MCP server in mcp/stdio.ts): resolves each local
// source path (overridable for tests) and builds the provider registry.
export function composeLogProviders(options: LogProviderCompositionOptions = {}) {
  const resolvedDbPath =
    options.sessionStoreDbPath ?? resolveSessionStoreDbPath();
  const resolvedDebugLogsDirPaths =
    options.debugLogsDirPaths ?? listWorkspaceDebugLogsDirPaths();
  const resolvedVscodeSettingsPath =
    options.vscodeSettingsPath !== undefined
      ? options.vscodeSettingsPath
      : resolveVscodeSettingsPath();
  const resolvedAgentTracesDbPath =
    options.agentTracesDbPath !== undefined
      ? options.agentTracesDbPath
      : resolveAgentTracesDbPath();
  if (!options.appSettingsDir) {
    migrateLegacyAppSettingsDir();
  }
  const resolvedAppSettingsDir = options.appSettingsDir ?? resolveAppSettingsDir();
  const resolvedMitmproxyCapturesDirPath =
    options.mitmproxyCapturesDirPath !== undefined
      ? options.mitmproxyCapturesDirPath
      : resolveMitmproxyCapturesDir(resolvedAppSettingsDir);
  const resolvedPiAgentSessionsDirPath =
    options.piAgentSessionsDirPath !== undefined
      ? options.piAgentSessionsDirPath
      : resolvePiAgentSessionsDir();
  const resolvedSystemPromptLogPath =
    options.systemPromptLogPath !== undefined
      ? options.systemPromptLogPath
      : resolvePiSystemPromptLogPath();
  const resolvedClaudeCodeProjectsDirPath =
    options.claudeCodeProjectsDirPath !== undefined
      ? options.claudeCodeProjectsDirPath
      : resolveClaudeCodeProjectsDir();

  const vscodeProvider = new VscodeLogProvider({
    sessionStoreDbPath: resolvedDbPath,
    debugLogsDirPaths: resolvedDebugLogsDirPaths,
    agentTracesDbPath: resolvedAgentTracesDbPath,
  });
  const mitmproxyProvider = new MitmproxyLogProvider({
    capturesDirPath: resolvedMitmproxyCapturesDirPath,
    decoders: defaultMitmExchangeDecoders,
  });
  const piAgentProvider = new PiAgentLogProvider({
    sessionsDirPath: resolvedPiAgentSessionsDirPath,
    systemPromptLogPath: resolvedSystemPromptLogPath,
  });
  const claudeCodeProvider = new ClaudeCodeLogProvider({
    projectsDirPath: resolvedClaudeCodeProjectsDirPath,
  });
  const registry = new LogProviderRegistry(
    [vscodeProvider, mitmproxyProvider, piAgentProvider, claudeCodeProvider, ...(options.additionalLogProviders ?? [])],
    resolvedAppSettingsDir,
  );

  return {
    registry,
    piAgentProvider,
    resolvedDbPath,
    resolvedDebugLogsDirPaths,
    resolvedVscodeSettingsPath,
    resolvedAppSettingsDir,
  };
}
