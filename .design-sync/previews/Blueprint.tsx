import { Blueprint } from "@copilot-cost-analyzer/web";

// The DS's card container: a hairline-bordered frame with four "+"
// registration marks at its corners — used throughout the app to wrap
// panels, badges, and callouts. Ported from its own usage in
// SystemPromptBreakdown.tsx and AppHeader.tsx's small brand-mark swatch.

export function Default() {
  return (
    <Blueprint style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div className="card-kicker">System prompt</div>
      <div className="card-title" style={{ fontSize: 15 }}>
        Sections
      </div>
      <p style={{ fontSize: 13, margin: 0 }}>
        A blueprint frame groups related content behind a hairline border with corner registration
        marks, echoing the app's technical-drawing aesthetic.
      </p>
    </Blueprint>
  );
}

export function BrandMark() {
  return (
    <Blueprint
      style={{ width: 96, height: 96, flex: "none", background: "var(--color-accent-900)" }}
    />
  );
}

export function Nested() {
  return (
    <Blueprint style={{ padding: "var(--space-3)", maxWidth: 320 }}>
      <div className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>
        Structure
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {["Instructions", "Security requirements", "Skills"].map((label) => (
          <button
            key={label}
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              font: "inherit",
              fontSize: 12,
              textAlign: "left",
              color: "var(--color-text)",
              padding: "4px var(--space-2)",
            }}
          >
            <span aria-hidden="true" style={{ width: 8, height: 8, flexShrink: 0, background: "var(--color-accent)" }} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </Blueprint>
  );
}
