import { describe, expect, it } from "vitest";
import { parseSystemPrompt } from "./system-prompt-parser.js";
import { assignTextColors } from "./system-prompt-menu.js";
import { buildPrettyTextSegments } from "./system-prompt-pretty.js";
import { flattenText } from "./system-prompt-text.js";

function build(text: string) {
  const { root } = parseSystemPrompt(text);
  const colors = assignTextColors(root);
  return buildPrettyTextSegments(root, text, colors);
}

describe("buildPrettyTextSegments", () => {
  it("renders a leaf tag with short single-line content inline", () => {
    const text = "<name>chronicle</name>";

    const segments = build(text);

    expect(flattenText(segments)).toBe("<name>chronicle</name>");
  });

  it("expands a tag with child elements onto its own indented lines", () => {
    const text = "<skill><name>chronicle</name><file>skills/chronicle/SKILL.md</file></skill>";

    const segments = build(text);

    expect(flattenText(segments)).toBe(
      "<skill>\n  <name>chronicle</name>\n  <file>skills/chronicle/SKILL.md</file>\n</skill>",
    );
  });

  it("indents 2 spaces per nesting depth for deeply nested tags", () => {
    const text = "<instructions><skills><skill><name>chronicle</name></skill></skills></instructions>";

    const segments = build(text);

    expect(flattenText(segments)).toBe(
      "<instructions>\n  <skills>\n    <skill>\n      <name>chronicle</name>\n    </skill>\n  </skills>\n</instructions>",
    );
  });

  it("expands a leaf tag whose content is long, even without child tags", () => {
    const longContent = "Project: copilot-cost-analyzer — a local-first analytics dashboard for GitHub Copilot Chat.";
    const text = `<attachment filePath="CLAUDE.md">${longContent}</attachment>`;

    const segments = build(text);

    expect(flattenText(segments)).toBe(`<attachment filePath="CLAUDE.md">\n  ${longContent}\n</attachment>`);
  });

  it("preserves attribute markup on the opening tag", () => {
    const text = '<attachment filePath="CLAUDE.md">short</attachment>';

    const segments = build(text);

    expect(flattenText(segments)).toBe('<attachment filePath="CLAUDE.md">short</attachment>');
  });

  it("does not flatten a multi-child block onto one line even when its content would otherwise be short", () => {
    const text = "<a><b>1</b><c>2</c></a>";

    const segments = build(text);

    expect(flattenText(segments)).toContain("\n");
  });

  it("renders untagged preamble/trailing text as its own paragraph, trimmed", () => {
    const text = "  intro text  \n<a>x</a>";

    const segments = build(text);

    expect(flattenText(segments)).toBe("intro text\n\n<a>x</a>");
  });

  it("separates top-level siblings with a blank line", () => {
    const text = "<a>1</a><b>2</b>";

    const segments = build(text);

    expect(flattenText(segments)).toBe("<a>1</a>\n\n<b>2</b>");
  });

  it("keeps each rendered tag node addressable by id for nav scroll/highlight", () => {
    const text = "<outer><inner>x</inner></outer>";

    const segments = build(text);

    const [outer] = segments;
    if (outer.kind !== "node") throw new Error("unreachable");
    const inner = outer.children.find((segment) => segment.kind === "node");
    expect(inner).toBeDefined();
  });

  it("colors a tagged node with its assigned text-background tint", () => {
    const text = "<foo>hello</foo>";
    const { root } = parseSystemPrompt(text);
    const colors = assignTextColors(root);

    const [node] = buildPrettyTextSegments(root, text, colors);

    if (node.kind !== "node") throw new Error("unreachable");
    expect(node.color).toBe(colors.get(root.children[0].id));
  });
});
