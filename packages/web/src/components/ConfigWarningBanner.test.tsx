import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConfigWarning } from "@copilot-cost-analyzer/domain";
import { ConfigWarningBanner } from "./ConfigWarningBanner.js";

const warning: ConfigWarning = {
  code: "retention-too-low",
  severity: "required",
  settingId: "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
  currentValue: 50,
  recommendedValue: 200,
  message: "Only the last 50 sessions' logs are retained on disk.",
  helpSteps: ["Set maxRetainedSessionLogs to 200 in settings.json", "Reload VS Code"],
};

const otherWarning: ConfigWarning = {
  code: "logging-disabled",
  severity: "required",
  settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
  currentValue: false,
  recommendedValue: true,
  message: "Debug logging is off.",
  helpSteps: ["Set fileLogging.enabled to true", "Reload VS Code"],
};

const optionalWarning: ConfigWarning = {
  code: "agent-traces-unavailable",
  severity: "optional",
  settingId: "github.copilot.chat.otel.dbSpanExporter.enabled",
  currentValue: false,
  recommendedValue: true,
  message: "Cache-write and reasoning-token counts aren't available yet.",
  helpSteps: ["Set dbSpanExporter.enabled to true", "Reload VS Code"],
};

describe("ConfigWarningBanner", () => {
  it("renders nothing when there are no warnings", () => {
    render(<ConfigWarningBanner warnings={[]} onDismiss={vi.fn()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the setting, current vs. recommended value, and fix steps for each warning", () => {
    render(<ConfigWarningBanner warnings={[warning]} onDismiss={vi.fn()} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(warning.message)).toBeInTheDocument();
    expect(
      screen.getByText(`${warning.settingId}: current 50, recommended 200`),
    ).toBeInTheDocument();
    for (const step of warning.helpSteps) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it("renders one section per warning when there are multiple", () => {
    render(<ConfigWarningBanner warnings={[warning, otherWarning]} onDismiss={vi.fn()} />);

    expect(screen.getByText(warning.message)).toBeInTheDocument();
    expect(screen.getByText(otherWarning.message)).toBeInTheDocument();
  });

  it("calls onDismiss when the Dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(<ConfigWarningBanner warnings={[warning]} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // Phase 8.5: agent-traces-unavailable is optional-severity — the app works
  // fully without it, unlike the other (required-severity) warning codes —
  // so it must render visually distinct, not as urgent as a blocking one.
  it("renders a required-severity warning with the required-tone marker", () => {
    const { container } = render(
      <ConfigWarningBanner warnings={[warning]} onDismiss={vi.fn()} />,
    );

    const marker = container.querySelector('[data-severity="required"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("style")).toContain("var(--color-accent-800)");
  });

  it("renders an optional-severity warning with a distinct, muted tone marker", () => {
    const { container } = render(
      <ConfigWarningBanner warnings={[optionalWarning]} onDismiss={vi.fn()} />,
    );

    const marker = container.querySelector('[data-severity="optional"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("style")).toContain("var(--color-accent-2-800)");
    expect(marker?.getAttribute("style")).not.toContain("var(--color-accent-800)");
  });
});
