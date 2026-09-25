import { existsSync, renameSync } from "node:fs";
import {
  resolveAppSettingsDir,
  resolveLegacyAppSettingsDir,
} from "./resolve-app-settings-dir.js";

interface MigrateLegacyAppSettingsDirOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  existsSync?: typeof existsSync;
  renameSync?: typeof renameSync;
}

// One-time migration for the 2026-09-25 gh-cp-chat-analyser -> copilot-
// cost-analyzer rename: moves an existing settings directory from the old
// name to the new one, so renaming the app doesn't orphan local sessions/
// config. No-op once the new directory exists or no legacy directory is
// there to migrate. Options-injectable for testability, mirroring
// resolveAppSettingsDir.
export function migrateLegacyAppSettingsDir(
  options: MigrateLegacyAppSettingsDirOptions = {},
): void {
  const exists = options.existsSync ?? existsSync;
  const rename = options.renameSync ?? renameSync;

  const currentDir = resolveAppSettingsDir(options);
  const legacyDir = resolveLegacyAppSettingsDir(options);

  if (currentDir === legacyDir) return;
  if (exists(currentDir)) return;
  if (!exists(legacyDir)) return;

  rename(legacyDir, currentDir);
}
