import { describe, expect, it } from "vitest";
import { parseSessionRangeQuery, parseToolCallFilterQuery } from "./audit-query-params.js";

describe("parseToolCallFilterQuery", () => {
  it("parses comma-separated enums and numbers", () => {
    expect(
      parseToolCallFilterQuery({ status: "error,interrupted", category: "timeout", tool: "Bash", program: "npm", turn: "2", limit: "10" }),
    ).toEqual({
      ok: true,
      value: { status: ["error", "interrupted"], failureCategory: ["timeout"], tool: "Bash", program: "npm", turnIndex: 2, limit: 10 },
    });
  });

  it("returns an empty filter for no params", () => {
    expect(parseToolCallFilterQuery({})).toEqual({ ok: true, value: {} });
  });

  it("rejects unknown enum values and bad numbers", () => {
    expect(parseToolCallFilterQuery({ status: "bogus" }).ok).toBe(false);
    expect(parseToolCallFilterQuery({ turn: "-1" }).ok).toBe(false);
    expect(parseToolCallFilterQuery({ limit: "abc" }).ok).toBe(false);
  });
});

describe("parseSessionRangeQuery", () => {
  it("accepts ISO dates and timestamps", () => {
    expect(parseSessionRangeQuery({ since: "2026-09-01", until: "2026-09-27T23:59:59Z", limit: "20", provider: "claude-code" })).toEqual({
      ok: true,
      value: { since: "2026-09-01", until: "2026-09-27T23:59:59Z", limit: 20, providerId: "claude-code" },
    });
  });

  it("rejects a malformed date or a zero limit", () => {
    expect(parseSessionRangeQuery({ since: "yesterday" }).ok).toBe(false);
    expect(parseSessionRangeQuery({ limit: "0" }).ok).toBe(false);
  });
});
