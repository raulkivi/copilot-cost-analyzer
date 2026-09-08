import { describe, expect, it } from "vitest";
import { buildContentPart, PLACEHOLDER_THRESHOLD_CHARS } from "./build-content-parts.js";

describe("buildContentPart", () => {
  it("returns a text part for a string under the placeholder threshold", () => {
    const part = buildContentPart("short user message");

    expect(part).toEqual({ kind: "text", text: "short user message" });
  });

  it("returns a file placeholder with sizeBytes for a string over the placeholder threshold", () => {
    const text = "a".repeat(PLACEHOLDER_THRESHOLD_CHARS + 1);

    const part = buildContentPart(text);

    expect(part).toEqual({
      placeholder: true,
      kind: "file",
      sizeBytes: PLACEHOLDER_THRESHOLD_CHARS + 1,
    });
  });

  it("returns a text part right at the threshold boundary (not over it)", () => {
    const text = "a".repeat(PLACEHOLDER_THRESHOLD_CHARS);

    const part = buildContentPart(text);

    expect(part).toEqual({ kind: "text", text });
  });

  it("populates path for a known file-reading tool's args even under the size threshold", () => {
    const part = buildContentPart({ path: "src/foo.ts" }, { toolName: "read_file" });

    expect(part).toEqual({
      placeholder: true,
      kind: "file",
      path: "src/foo.ts",
      sizeBytes: expect.any(Number),
    });
  });

  it("populates path for Claude Code's Read tool's args even under the size threshold", () => {
    const part = buildContentPart({ file_path: "src/foo.ts" }, { toolName: "Read" });

    expect(part).toEqual({
      placeholder: true,
      kind: "file",
      path: "src/foo.ts",
      sizeBytes: expect.any(Number),
    });
  });

  it("does not populate path for an unrecognized tool name, even with a path-shaped arg", () => {
    const part = buildContentPart({ path: "src/foo.ts" }, { toolName: "some_other_tool" });

    expect(part).toEqual({ kind: "text", text: JSON.stringify({ path: "src/foo.ts" }) });
  });

  it("detects a data-URI image string as an image placeholder", () => {
    const part = buildContentPart("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA");

    expect(part).toEqual({ placeholder: true, kind: "image" });
  });

  it("detects a content-block-shaped image object as an image placeholder", () => {
    const part = buildContentPart({ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } });

    expect(part).toEqual({ placeholder: true, kind: "image" });
  });

  it("falls back to best-effort text for an unrecognized shape, never throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => buildContentPart(circular)).not.toThrow();
    const part = buildContentPart(circular);
    expect(part.kind === "text" || (part as { placeholder?: boolean }).placeholder).toBeTruthy();
  });

  it("never throws for undefined, null, or a non-string/non-object value", () => {
    expect(() => buildContentPart(undefined)).not.toThrow();
    expect(() => buildContentPart(null)).not.toThrow();
    expect(() => buildContentPart(42)).not.toThrow();
    expect(buildContentPart(undefined)).toEqual({ kind: "text", text: "" });
  });
});
