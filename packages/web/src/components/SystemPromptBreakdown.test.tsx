import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SystemPromptComponent } from "@copilot-cost-analyzer/domain";
import { SystemPromptBreakdown } from "./SystemPromptBreakdown.js";

describe("SystemPromptBreakdown", () => {
  it("renders the card kicker and one meter row per component", () => {
    const components: SystemPromptComponent[] = [
      { kind: "built-in", label: "Base system prompt (100 characters)", tokenCount: { known: true, value: 500 } },
      { kind: "tool-definitions", label: "Tool definitions (4 tools)", tokenCount: { known: true, value: 250 } },
    ];

    render(<SystemPromptBreakdown components={components} />);

    expect(screen.getByText("System prompt breakdown")).toBeInTheDocument();
    expect(screen.getByText("Base system prompt (100 characters)")).toBeInTheDocument();
    expect(screen.getByText("Tool definitions (4 tools)")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("250")).toBeInTheDocument();
  });

  it("sizes each bar proportionally to the largest component's known token count", () => {
    const components: SystemPromptComponent[] = [
      { kind: "built-in", label: "Big", tokenCount: { known: true, value: 1000 } },
      { kind: "tool-definitions", label: "Small", tokenCount: { known: true, value: 250 } },
    ];

    render(<SystemPromptBreakdown components={components} />);

    expect(screen.getByTestId("prompt-bar-fill-Big")).toHaveStyle({ width: "100%" });
    expect(screen.getByTestId("prompt-bar-fill-Small")).toHaveStyle({ width: "25%" });
  });

  it("shows an em dash and an empty bar for a component's unknown token count", () => {
    const components: SystemPromptComponent[] = [
      { kind: "skill-manifest", label: "graphify", tokenCount: { known: false, reason: "not broken down" } },
    ];

    render(<SystemPromptBreakdown components={components} />);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByTestId("prompt-bar-fill-graphify")).toHaveStyle({ width: "0%" });
  });

  it("shows the VS Code-specific fallback message for a vscode session with no breakdown", () => {
    render(<SystemPromptBreakdown components={[]} providerId="vscode" />);

    expect(
      screen.getByText(
        "No prompt artifacts captured for this session — enable agentDebugLog.fileLogging.enabled and reload VS Code.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the same VS Code fallback message when providerId is omitted", () => {
    render(<SystemPromptBreakdown components={[]} />);

    expect(
      screen.getByText(
        "No prompt artifacts captured for this session — enable agentDebugLog.fileLogging.enabled and reload VS Code.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a pi-agent-specific not-yet-captured message, and still renders the inspector button, when there is no breakdown", () => {
    render(<SystemPromptBreakdown components={[]} providerId="pi-agent" onOpenInspector={vi.fn()} />);

    expect(
      screen.getByText("No system prompt captured for this session yet — open the system prompt inspector for how to enable it."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/agentDebugLog.fileLogging.enabled/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("This provider does not capture a system-prompt artifact, so no breakdown is available."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open system prompt inspector/i })).toBeInTheDocument();
  });

  it("renders real breakdown rows for a pi-agent session with a captured system prompt", () => {
    const components: SystemPromptComponent[] = [
      { kind: "built-in", label: "Base system prompt (28 characters)", tokenCount: { known: true, value: 12, estimated: true } },
      { kind: "tool-definitions", label: "Tool definitions (4 tools)", tokenCount: { known: false, reason: "no per-item content" } },
    ];

    render(<SystemPromptBreakdown components={components} providerId="pi-agent" onOpenInspector={vi.fn()} />);

    expect(screen.getByText("Base system prompt (28 characters)")).toBeInTheDocument();
    expect(screen.getByText("Tool definitions (4 tools)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open system prompt inspector/i })).toBeInTheDocument();
  });

  it("shows a provider-neutral fallback message for a mitmproxy session with no breakdown", () => {
    render(<SystemPromptBreakdown components={[]} providerId="mitmproxy" />);

    expect(
      screen.getByText("This provider does not capture a system-prompt artifact, so no breakdown is available."),
    ).toBeInTheDocument();
  });

  it("marks an estimated token count with a tilde and an explanatory tooltip", () => {
    const components: SystemPromptComponent[] = [
      { kind: "built-in", label: "Base system prompt (100 characters)", tokenCount: { known: true, value: 25, estimated: true } },
    ];

    render(<SystemPromptBreakdown components={components} />);

    const value = screen.getByText("~25");
    expect(value).toBeInTheDocument();
    expect(value.getAttribute("title")).toMatch(/estimate/i);
  });

  it("does not mark a real, non-estimated token count", () => {
    const components: SystemPromptComponent[] = [
      { kind: "built-in", label: "Base system prompt (100 characters)", tokenCount: { known: true, value: 25 } },
    ];

    render(<SystemPromptBreakdown components={components} />);

    const value = screen.getByText("25");
    expect(value).not.toHaveAttribute("title");
  });

  it("renders a button that opens the system prompt inspector when a built-in component is present", () => {
    const components: SystemPromptComponent[] = [
      { kind: "built-in", label: "Base system prompt (100 characters)", tokenCount: { known: true, value: 25, estimated: true } },
    ];
    const onOpenInspector = vi.fn();

    render(<SystemPromptBreakdown components={components} onOpenInspector={onOpenInspector} />);
    fireEvent.click(screen.getByRole("button", { name: /open system prompt inspector/i }));

    expect(onOpenInspector).toHaveBeenCalled();
  });

  it("omits the open-inspector button when there is no onOpenInspector handler", () => {
    const components: SystemPromptComponent[] = [
      { kind: "built-in", label: "Base system prompt (100 characters)", tokenCount: { known: true, value: 25, estimated: true } },
    ];

    render(<SystemPromptBreakdown components={components} />);

    expect(screen.queryByRole("button", { name: /open system prompt inspector/i })).not.toBeInTheDocument();
  });

  it("omits the open-inspector button when there is no built-in component", () => {
    const components: SystemPromptComponent[] = [
      { kind: "skill-manifest", label: "graphify", tokenCount: { known: false, reason: "not broken down" } },
    ];

    render(<SystemPromptBreakdown components={components} onOpenInspector={() => {}} />);

    expect(screen.queryByRole("button", { name: /open system prompt inspector/i })).not.toBeInTheDocument();
  });
});
