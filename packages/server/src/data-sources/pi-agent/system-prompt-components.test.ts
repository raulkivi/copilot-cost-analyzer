import { describe, expect, it } from "vitest";
import { buildPiSystemPromptComponents, buildPiSystemPromptComponentsFromState } from "./system-prompt-components.js";
import type { PiSystemPromptState } from "./system-message-replay.js";
import type { PiSystemPromptSidecarRecord } from "./system-prompt-sidecar-reader.js";

function baseRecord(
  overrides: Partial<PiSystemPromptSidecarRecord> = {},
): PiSystemPromptSidecarRecord {
  return {
    sessionId: "session-1",
    sessionFile: "/home/dev/.pi/agent/sessions/session-1.jsonl",
    capturedAt: "2026-09-03T10:00:00.000Z",
    cwd: "/home/dev/project",
    systemPromptChars: 28,
    systemPrompt: "You are Pi, a coding agent.",
    ...overrides,
  };
}

describe("buildPiSystemPromptComponents", () => {
  it("builds one built-in component with a real estimated token count from the captured systemPrompt text", () => {
    const components = buildPiSystemPromptComponents(baseRecord());

    const builtIn = components.find((c) => c.kind === "built-in");
    expect(builtIn).toBeDefined();
    expect(builtIn?.label).toBe("Base system prompt (28 characters)");
    expect(builtIn?.tokenCount.known).toBe(true);
    if (builtIn?.tokenCount.known) {
      expect(builtIn.tokenCount.estimated).toBe(true);
      expect(builtIn.tokenCount.value).toBeGreaterThan(0);
    }
  });

  it("adds one repo-instructions component per contextFilePaths entry, each unavailable", () => {
    const components = buildPiSystemPromptComponents(
      baseRecord({ contextFilePaths: ["/repo/AGENTS.md", "/repo/CLAUDE.md"] }),
    );

    const repoInstructions = components.filter(
      (c) => c.kind === "repo-instructions",
    );
    expect(repoInstructions.map((c) => c.label)).toEqual([
      "/repo/AGENTS.md",
      "/repo/CLAUDE.md",
    ]);
    expect(repoInstructions.every((c) => c.tokenCount.known === false)).toBe(
      true,
    );
  });

  it("adds one skill-manifest component per skillNames entry", () => {
    const components = buildPiSystemPromptComponents(
      baseRecord({ skillNames: ["docx", "pdf"] }),
    );

    const skillManifests = components.filter(
      (c) => c.kind === "skill-manifest",
    );
    expect(skillManifests.map((c) => c.label)).toEqual(["docx", "pdf"]);
    expect(skillManifests.every((c) => c.tokenCount.known === false)).toBe(
      true,
    );
  });

  it("adds a tool-definitions component sized by selectedTools.length when selectedTools is present", () => {
    const components = buildPiSystemPromptComponents(
      baseRecord({ selectedTools: ["read", "bash", "edit", "write"] }),
    );

    const toolDefinitions = components.find(
      (c) => c.kind === "tool-definitions",
    );
    expect(toolDefinitions?.label).toBe("Tool definitions (4 tools)");
    expect(toolDefinitions?.tokenCount.known).toBe(false);
  });

  it("omits the tool-definitions component when selectedTools is undefined", () => {
    const components = buildPiSystemPromptComponents(baseRecord());

    expect(components.some((c) => c.kind === "tool-definitions")).toBe(false);
  });

  it("returns only the built-in component when no tools/skills/context files were captured", () => {
    const components = buildPiSystemPromptComponents(baseRecord());

    expect(components).toHaveLength(1);
    expect(components[0].kind).toBe("built-in");
  });
});

describe("buildPiSystemPromptComponentsFromState (in-file system messages)", () => {
  const state: PiSystemPromptState = {
    baseContent: "You are Pi.",
    sections: [
      { name: "tools", text: "<tools>read, bash</tools>" },
      { name: "cwd", text: "Current working directory: /p" },
    ],
    text: "You are Pi.\n\n<tools>read, bash</tools>\n\nCurrent working directory: /p",
    tools: [
      { name: "read", description: "Read a file", parameters: { type: "object" } },
      { name: "bash", description: "Run a command", parameters: { type: "object" } },
    ],
    declaredToolNames: ["read", "bash"],
  };

  it("builds a built-in component for the base content and one per named section, each with a real estimated count", () => {
    const components = buildPiSystemPromptComponentsFromState(state);

    expect(components.slice(0, 3)).toEqual([
      { kind: "built-in", label: "Base system prompt (11 characters)", tokenCount: expect.objectContaining({ known: true, estimated: true }) },
      { kind: "built-in", label: 'Prompt section "tools" (25 characters)', tokenCount: expect.objectContaining({ known: true, estimated: true }) },
      { kind: "built-in", label: 'Prompt section "cwd" (29 characters)', tokenCount: expect.objectContaining({ known: true, estimated: true }) },
    ]);
  });

  it("sizes tool definitions from the captured declarations with a real estimated count", () => {
    const components = buildPiSystemPromptComponentsFromState(state);

    expect(components.at(-1)).toEqual({
      kind: "tool-definitions",
      label: "Tool definitions (2 tools)",
      tokenCount: expect.objectContaining({ known: true, estimated: true }),
    });
  });

  it("omits an empty base content and a tool component when no tools are declared", () => {
    const components = buildPiSystemPromptComponentsFromState({
      ...state,
      baseContent: "",
      sections: [{ name: "preamble", text: "You are Pi." }],
      tools: [],
    });

    expect(components.map((c) => c.label)).toEqual(['Prompt section "preamble" (11 characters)']);
  });
});
