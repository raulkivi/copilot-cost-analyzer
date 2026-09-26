import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { assignIcicleColors } from "../lib/system-prompt-menu.js";
import { parseSystemPrompt } from "../lib/system-prompt-parser.js";
import { PromptCompositionIcicle } from "./PromptCompositionIcicle.js";

const SAMPLE_TEXT =
  "Intro text.\n<securityRequirements>Follow OWASP.</securityRequirements>\n" +
  "<skills><skill><name>graphify</name><description>Graph things.</description></skill></skills>";

function renderIcicle(text: string, overrides: Partial<Parameters<typeof PromptCompositionIcicle>[0]> = {}) {
  const { root, malformed } = parseSystemPrompt(text);
  const colors = assignIcicleColors(root);
  const onSelect = vi.fn();
  render(
    <PromptCompositionIcicle
      root={root}
      text={text}
      malformed={malformed}
      colors={colors}
      selectedId={null}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { root, onSelect };
}

describe("PromptCompositionIcicle", () => {
  it("renders one rect per top-level section plus the root row", () => {
    renderIcicle(SAMPLE_TEXT);

    expect(screen.getByTestId(/^icicle-node-root\.0$/)).toBeInTheDocument();
    expect(screen.getByTestId(/^icicle-node-root\.1$/)).toBeInTheDocument();
    expect(screen.getByTestId(/^icicle-node-root\.2$/)).toBeInTheDocument();
  });

  it("labels each section with the same label the nav menu would use", () => {
    renderIcicle(SAMPLE_TEXT);

    expect(screen.getByText("Security Requirements")).toBeInTheDocument();
  });

  it("shows a single-entry breadcrumb for the full prompt before any zoom", () => {
    renderIcicle(SAMPLE_TEXT);

    const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(breadcrumb).getByText("Full prompt")).toBeInTheDocument();
  });

  it("zooms in on click, revealing descendants beyond the menu's depth-3 cap", () => {
    const text = "<skills><skill><details><nested>deep content here</nested></details></skill></skills>";
    const { root } = renderIcicle(text);
    const skill = root.children[0].children[0];

    fireEvent.click(screen.getByTestId(`icicle-node-${skill.id}`));

    const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(breadcrumb).getByText("Skill")).toBeInTheDocument();
    const details = skill.children[0];
    expect(screen.getByTestId(`icicle-node-${details.id}`)).toBeInTheDocument();
  });

  it("zooms back out when the focused (top) row is clicked again", () => {
    const { root } = renderIcicle(SAMPLE_TEXT);
    const skills = root.children[2];

    fireEvent.click(screen.getByTestId(`icicle-node-${skills.id}`));
    const breadcrumbAfterZoomIn = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(breadcrumbAfterZoomIn).getByText("Skills")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`icicle-node-${skills.id}`));
    const breadcrumbAfterZoomOut = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(breadcrumbAfterZoomOut).queryByText("Skills")).not.toBeInTheDocument();
    expect(within(breadcrumbAfterZoomOut).getByText("Full prompt")).toBeInTheDocument();
  });

  it("calls onSelect with the clicked node when within the shared selection depth cap", () => {
    const { root, onSelect } = renderIcicle(SAMPLE_TEXT);
    const securityRequirements = root.children[1];

    fireEvent.click(screen.getByTestId(`icicle-node-${securityRequirements.id}`));

    expect(onSelect).toHaveBeenCalledWith(securityRequirements);
  });

  it("shows each rect's size in characters and share of the current view", () => {
    const { root } = renderIcicle(SAMPLE_TEXT);
    const securityRequirements = root.children[1];

    const group = screen.getByTestId(`icicle-node-${securityRequirements.id}`);

    expect(within(group).getByText(/^\d+ chars · \d+%$/)).toBeInTheDocument();
  });

  it("fills its row with flex-grow proportional to size, instead of a JS-measured pixel width", () => {
    const text = "<a>short</a><b>a much much longer piece of content here than the other one</b>";
    const { root } = renderIcicle(text);
    const [a, b] = root.children;

    const aItem = screen.getByTestId(`icicle-node-${a.id}`);
    const bItem = screen.getByTestId(`icicle-node-${b.id}`);

    const aGrow = Number(aItem.style.flexGrow);
    const bGrow = Number(bItem.style.flexGrow);

    expect(aGrow).toBeGreaterThan(0);
    expect(bGrow).toBeGreaterThan(aGrow);
  });

  it("makes each row a flex container filling 100% of the diagram's width", () => {
    renderIcicle(SAMPLE_TEXT);

    const diagram = screen.getByRole("img", { name: /prompt composition icicle diagram/i });
    const row = diagram.firstElementChild;

    expect(row).toHaveStyle({ display: "flex", width: "100%" });
  });

  it("keeps duplicate-name counters stable across re-renders with the same focus", () => {
    const text = "<foo>a</foo><foo>b</foo><foo>c</foo>";
    const { root, malformed } = parseSystemPrompt(text);
    const colors = assignIcicleColors(root);
    const props = { root, text, malformed, colors, selectedId: null, onSelect: () => {} };

    const { rerender } = render(<PromptCompositionIcicle {...props} />);
    rerender(<PromptCompositionIcicle {...props} />);
    rerender(<PromptCompositionIcicle {...props} />);

    expect(screen.getByText("Foo")).toBeInTheDocument();
    expect(screen.getByText("Foo (2)")).toBeInTheDocument();
    expect(screen.getByText("Foo (3)")).toBeInTheDocument();
  });

  it("relies on the shared .truncate CSS class instead of hard-cutting label text in JS", () => {
    const { root } = renderIcicle(SAMPLE_TEXT);
    const securityRequirements = root.children[1];
    const group = screen.getByTestId(`icicle-node-${securityRequirements.id}`);

    const label = within(group).getByText("Security Requirements");

    expect(label.className).toContain("truncate");
  });

  it("gives the main label bold weight and the stats line normal weight", () => {
    const { root } = renderIcicle(SAMPLE_TEXT);
    const securityRequirements = root.children[1];
    const group = screen.getByTestId(`icicle-node-${securityRequirements.id}`);

    const mainLabel = within(group).getByText("Security Requirements");
    const stats = within(group).getByText(/^\d+ chars · \d+%$/);

    expect(mainLabel).toHaveStyle({ fontWeight: "600" });
    expect(stats).toHaveStyle({ fontWeight: "400" });
  });

  it("highlights the currently selected node with a distinct border", () => {
    const { root } = parseSystemPrompt(SAMPLE_TEXT);
    const colors = assignIcicleColors(root);
    const securityRequirements = root.children[1];

    render(
      <PromptCompositionIcicle
        root={root}
        text={SAMPLE_TEXT}
        malformed={false}
        colors={colors}
        selectedId={securityRequirements.id}
        onSelect={() => {}}
      />,
    );

    const item = screen.getByTestId(`icicle-node-${securityRequirements.id}`);
    // Inline style, not toHaveStyle: jsdom 30 resolves var() in computed
    // styles, and the test environment defines no theme variables.
    expect(item.style.borderWidth).toBe("2px");
    expect(item.style.borderColor).toBe("var(--color-text)");
  });
});
