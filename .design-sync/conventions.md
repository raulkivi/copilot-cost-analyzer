## Setup

No provider or wrapper is required — none of the components read from React context. Just import from the bundle global and render.

```jsx
const { Blueprint, SegmentedControl, Tag } = window.CopilotCostAnalyzerUI;
```

One component, `PromptCompositionIcicle` (in the `charts` group), is **not** a drop-in-and-render primitive like the three above — it needs its `root`/`malformed`/`colors` props *built* first from two helper functions shipped alongside it on the same bundle global (`parseSystemPrompt`, `assignIcicleColors`). Read `components/charts/PromptCompositionIcicle/PromptCompositionIcicle.prompt.md` before using it — the pattern doesn't generalize from the other three.

## Styling idiom: global CSS classes + CSS custom-property tokens

This is a **global-class** design system, not CSS-in-JS or CSS Modules — every visual is a plain class name defined once in the root stylesheet, plus a token layer of CSS custom properties. `Blueprint` and `Tag` accept a `className` prop for composing extra classes; `SegmentedControl` renders its own fixed markup.

**Tokens** (`:root` custom properties — always reference these, never hard-code a hex/px value):

| Group | Names |
|---|---|
| Color | `--color-bg`, `--color-surface`, `--color-text`, `--color-accent`, `--color-accent-2`, `--color-divider` |
| Tonal ramps | `--color-neutral-{100..900}`, `--color-accent-{100..900}`, `--color-accent-2-{100..900}` (step 100 lightest → 900 darkest) |
| Type | `--font-heading` ("Barlow Condensed"), `--font-heading-weight` (600), `--font-body` ("Barlow") |
| Space | `--space-{1,2,3,4,6,8}` (3.4px base scale) |
| Radius | `--radius-sm`, `--radius-md`, `--radius-lg` — **note:** the DS's own component classes (`.card`, `.btn`, `.input`, `.tag`, `.seg`, `.dialog`) override these back to `border-radius: 0` — the brand look is square/hairline, not rounded. Don't fight this by hand-setting radius on these classes. |
| Shadow | `--shadow-sm`, `--shadow-md`, `--shadow-lg` — defined for parity but unused by the shipped classes (the aesthetic stays flat/hairline-bordered, not elevated) |

**Component classes actually backing the 3 UI primitives** (`PromptCompositionIcicle` doesn't use these — it fills its rects from the `colors` map its own helper computes, not from tag-family CSS classes):
- `Blueprint` → `.blueprint` (hairline-bordered frame with 4 corner "+" registration marks via nested `<i class="corner tl|tr|bl|br">`, rendered automatically — don't pass your own corner markup)
- `SegmentedControl` → `.seg` (pill-shaped radio group container) / `.seg-opt` (each option label; the checked one gets the accent fill automatically via `:has(input:checked)`)
- `Tag` → `.tag` + one of `.tag-accent` / `.tag-accent-2` / `.tag-neutral` / `.tag-outline` (from the required `variant` prop)

**Other classes defined in the same stylesheet, usable as plain markup even though they have no exported React component** (the DS's own app uses them as raw HTML + classes, not components — do the same): `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-ghost`, `.card`/`.card-kicker`/`.card-title`/`.card-meta`, `.input`, `.field`, `.table`, `.dialog`/`.dialog-backdrop`/`.dialog-title`/`.dialog-body`/`.dialog-actions`, `.nav`/`.nav-brand`, `.text-muted`, `.truncate`. Read `styles.css` (below) for their exact structure before using them — several (`.dialog`, `.seg-opt`) depend on specific nested markup, not just the class alone.

## Where the truth lives

- `styles.css` (root) — `@import`s `_ds_bundle.css`, the full compiled stylesheet (tokens + every class above). Read this before styling anything; it's the only source of truth for the class vocabulary and token values.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component API + usage note (`<group>` is `general` for the 3 UI primitives, `charts` for `PromptCompositionIcicle`).
- `components/<group>/<Name>/<Name>.d.ts` — prop contracts. Note: `SegmentedControl` is generic (`<T extends string>`) in its real source; the synced contract is simplified to `string` for `value`/`onChange` — still correct for any string-valued option set, just not compile-time-narrowed to a literal union.

## Example composition

```jsx
const { Blueprint, SegmentedControl, Tag } = window.CopilotCostAnalyzerUI;

function Panel() {
  const [format, setFormat] = React.useState("pretty");
  return (
    <Blueprint style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div className="card-kicker">Panel</div>
      <div className="card-title">Session detail</div>
      <SegmentedControl
        name="format"
        options={[{ value: "pretty", label: "Pretty" }, { value: "raw", label: "Raw" }]}
        value={format}
        onChange={setFormat}
      />
      <Tag variant="accent">gpt-4.1</Tag>
    </Blueprint>
  );
}
```
