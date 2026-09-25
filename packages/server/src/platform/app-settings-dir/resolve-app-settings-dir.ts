import { homedir } from "node:os";
import path from "node:path";

interface ResolveAppSettingsDirOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: Record<string, string | undefined>;
}

const APP_DIR_NAME = "copilot-cost-analyzer";

// Pre-2026-09-25 directory name (the app was called gh-cp-chat-analyser).
// Exposed so migrate-legacy-app-settings-dir.ts can find and move any
// existing local data without duplicating the per-platform logic below.
export const LEGACY_APP_DIR_NAME = "gh-cp-chat-analyser";

// Uses path.posix/path.win32 explicitly rather than the bare path module
// (which follows the actual runtime OS, not the `platform` option) so
// this function's behavior is deterministic and testable for every
// platform from any single CI machine.
function resolveDirForAppName(
  appDirName: string,
  options: ResolveAppSettingsDirOptions,
): string {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;

  if (platform === "darwin") {
    return path.posix.join(homeDir, "Library", "Application Support", appDirName);
  }
  if (platform === "win32") {
    const appData = env.APPDATA ?? path.win32.join(homeDir, "AppData", "Roaming");
    return path.win32.join(appData, appDirName);
  }
  const xdgConfigHome = env.XDG_CONFIG_HOME ?? path.posix.join(homeDir, ".config");
  return path.posix.join(xdgConfigHome, appDirName);
}

// This app's own per-user config directory (phase-9-log-providers-
// implementation.md §6) — the only local path this app ever writes to
// (architecture.md §11.2). OS-conventional per platform, mirroring
// platform/vscode-paths' options-injection pattern for testability.
export function resolveAppSettingsDir(options: ResolveAppSettingsDirOptions = {}): string {
  return resolveDirForAppName(APP_DIR_NAME, options);
}

// Pre-rename equivalent of resolveAppSettingsDir, for migration only.
export function resolveLegacyAppSettingsDir(
  options: ResolveAppSettingsDirOptions = {},
): string {
  return resolveDirForAppName(LEGACY_APP_DIR_NAME, options);
}
