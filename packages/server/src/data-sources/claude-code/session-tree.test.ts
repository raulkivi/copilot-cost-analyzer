import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { findForkPointIds, findLeafUuids, resolveActiveLeafUuid, walkBranch } from "./session-tree.js";

function entry(uuid: string, parentUuid: string | null, type = "assistant"): ClaudeCodeRawEntry {
  return { type, uuid, parentUuid };
}

describe("findLeafUuids", () => {
  it("returns the single tail entry for a linear chain", () => {
    const entries = [entry("e1", null), entry("e2", "e1"), entry("e3", "e2")];

    expect(findLeafUuids(entries)).toEqual(["e3"]);
  });

  it("returns every branch tip when the tree forks", () => {
    const entries = [entry("e1", null), entry("e2", "e1"), entry("e3", "e1"), entry("e4", "e2")];

    expect(findLeafUuids(entries).sort()).toEqual(["e3", "e4"]);
  });

  it("returns an empty array for an empty entry list", () => {
    expect(findLeafUuids([])).toEqual([]);
  });
});

describe("walkBranch", () => {
  it("walks parentUuid back to the root, returning root-to-leaf order", () => {
    const entries = [entry("e1", null), entry("e2", "e1"), entry("e3", "e2")];

    expect(walkBranch(entries, "e3").map((e) => e.uuid)).toEqual(["e1", "e2", "e3"]);
  });

  it("stops at a null parentUuid (the root)", () => {
    const entries = [entry("e1", null), entry("e2", "e1")];

    expect(walkBranch(entries, "e2").map((e) => e.uuid)).toEqual(["e1", "e2"]);
  });

  it("returns only the branch leading to the requested leaf, excluding sibling forks", () => {
    const entries = [entry("e1", null), entry("e2", "e1"), entry("e3", "e1"), entry("e4", "e2")];

    expect(walkBranch(entries, "e3").map((e) => e.uuid)).toEqual(["e1", "e3"]);
    expect(walkBranch(entries, "e4").map((e) => e.uuid)).toEqual(["e1", "e2", "e4"]);
  });

  it("returns an empty array for an unknown leaf uuid", () => {
    expect(walkBranch([entry("e1", null)], "does-not-exist")).toEqual([]);
  });
});

describe("resolveActiveLeafUuid", () => {
  it("uses the last 'last-prompt' entry's leafUuid when present", () => {
    const entries: ClaudeCodeRawEntry[] = [
      entry("e1", null),
      entry("e2", "e1"),
      entry("e3", "e1"),
      { type: "last-prompt", leafUuid: "e2" },
      { type: "last-prompt", leafUuid: "e3" },
    ];

    expect(resolveActiveLeafUuid(entries)).toBe("e3");
  });

  it("falls back to the last-occurring leaf from findLeafUuids when no last-prompt entry exists", () => {
    const entries = [entry("e1", null), entry("e2", "e1"), entry("e3", "e1")];

    expect(resolveActiveLeafUuid(entries)).toBe("e3");
  });

  it("returns null when there are no entries at all", () => {
    expect(resolveActiveLeafUuid([])).toBeNull();
  });
});

describe("findForkPointIds", () => {
  it("returns ids claimed by more than one child", () => {
    const entries = [entry("e1", null), entry("e2", "e1"), entry("e3", "e1"), entry("e4", "e2")];

    expect(findForkPointIds(entries)).toEqual(new Set(["e1"]));
  });

  it("returns an empty set for a linear chain", () => {
    const entries = [entry("e1", null), entry("e2", "e1")];

    expect(findForkPointIds(entries)).toEqual(new Set());
  });
});
