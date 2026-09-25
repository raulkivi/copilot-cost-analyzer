import { describe, expect, it } from "vitest";
import { resolveAppSettingsDir } from "./resolve-app-settings-dir.js";

describe("resolveAppSettingsDir", () => {
  it("uses XDG_CONFIG_HOME on Linux when set", () => {
    const dir = resolveAppSettingsDir({
      platform: "linux",
      homeDir: "/home/dev",
      env: { XDG_CONFIG_HOME: "/home/dev/.custom-config" },
    });

    expect(dir).toBe("/home/dev/.custom-config/copilot-cost-analyzer");
  });

  it("falls back to ~/.config on Linux when XDG_CONFIG_HOME is unset", () => {
    const dir = resolveAppSettingsDir({ platform: "linux", homeDir: "/home/dev", env: {} });

    expect(dir).toBe("/home/dev/.config/copilot-cost-analyzer");
  });

  it("uses Library/Application Support on macOS", () => {
    const dir = resolveAppSettingsDir({ platform: "darwin", homeDir: "/Users/dev", env: {} });

    expect(dir).toBe("/Users/dev/Library/Application Support/copilot-cost-analyzer");
  });

  it("uses APPDATA on Windows when set", () => {
    const dir = resolveAppSettingsDir({
      platform: "win32",
      homeDir: "C:\\Users\\dev",
      env: { APPDATA: "C:\\Users\\dev\\AppData\\Roaming" },
    });

    expect(dir).toBe(
      "C:\\Users\\dev\\AppData\\Roaming\\copilot-cost-analyzer",
    );
  });
});
