import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  STATUS_META,
  STATUS_ORDER,
  failedCountOf,
  formatCompact,
  formatDuration,
  formatFailureRate,
} from "./audit-format.js";

describe("STATUS_META", () => {
  it("gives every status a label, an icon and a color (identity is never color alone)", () => {
    for (const status of STATUS_ORDER) {
      expect(STATUS_META[status].label).toBeTruthy();
      expect(STATUS_META[status].icon).toBeTruthy();
      expect(STATUS_META[status].color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("stacks success first and unknown last", () => {
    expect(STATUS_ORDER[0]).toBe("success");
    expect(STATUS_ORDER.at(-1)).toBe("unknown");
  });
});

describe("CATEGORY_LABELS", () => {
  it("has a human label for the user-facing categories", () => {
    expect(CATEGORY_LABELS["command-not-found"]).toBe("Command not found");
    expect(CATEGORY_LABELS["wrong-directory"]).toBe("Wrong directory");
    expect(CATEGORY_LABELS["invalid-arguments"]).toBe("Invalid arguments");
    expect(CATEGORY_LABELS["blocked-by-policy"]).toBe("Blocked by permissions");
  });
});

describe("formatFailureRate", () => {
  it("formats a rate as a percentage and null as unavailable", () => {
    expect(formatFailureRate(0.0991)).toBe("9.9%");
    expect(formatFailureRate(0)).toBe("0%");
    expect(formatFailureRate(1)).toBe("100%");
    expect(formatFailureRate(null)).toBe("—");
  });
});

describe("formatCompact", () => {
  it("auto-compacts large numbers", () => {
    expect(formatCompact(1284)).toBe("1,284");
    expect(formatCompact(12_900)).toBe("12.9K");
    expect(formatCompact(4_200_000)).toBe("4.2M");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds for humans", () => {
    expect(formatDuration(450)).toBe("450 ms");
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });
});

describe("failedCountOf", () => {
  it("counts every failed status", () => {
    // A full status-counts object (as SessionAuditTotals carries): only
    // failed + interrupted + denied count, succeeded/unknown are ignored.
    const counts = { succeeded: 1, failed: 2, interrupted: 1, denied: 1, unknown: 3 };
    expect(failedCountOf(counts)).toBe(4);
  });
});
