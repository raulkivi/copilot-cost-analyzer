import { describe, expect, it, vi } from "vitest";
import { migrateLegacyAppSettingsDir } from "./migrate-legacy-app-settings-dir.js";

function fakeFs(existingPaths: Set<string>) {
  const existsSync = vi.fn((p: import("node:fs").PathLike) => existingPaths.has(String(p)));
  const renameSync = vi.fn(
    (from: import("node:fs").PathLike, to: import("node:fs").PathLike) => {
      existingPaths.delete(String(from));
      existingPaths.add(String(to));
    },
  );
  return { existsSync, renameSync };
}

describe("migrateLegacyAppSettingsDir", () => {
  const options = { platform: "linux" as const, homeDir: "/home/dev", env: {} };
  const currentDir = "/home/dev/.config/copilot-cost-analyzer";
  const legacyDir = "/home/dev/.config/gh-cp-chat-analyser";

  it("renames the legacy directory to the current one when only the legacy dir exists", () => {
    const { existsSync, renameSync } = fakeFs(new Set([legacyDir]));

    migrateLegacyAppSettingsDir({ ...options, existsSync, renameSync });

    expect(renameSync).toHaveBeenCalledWith(legacyDir, currentDir);
  });

  it("does nothing when the current directory already exists", () => {
    const { existsSync, renameSync } = fakeFs(new Set([currentDir, legacyDir]));

    migrateLegacyAppSettingsDir({ ...options, existsSync, renameSync });

    expect(renameSync).not.toHaveBeenCalled();
  });

  it("does nothing when neither directory exists", () => {
    const { existsSync, renameSync } = fakeFs(new Set());

    migrateLegacyAppSettingsDir({ ...options, existsSync, renameSync });

    expect(renameSync).not.toHaveBeenCalled();
  });
});
