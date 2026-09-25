---
category: charts
---

Zoomable icicle diagram of a parsed system prompt's tag structure — click a rect to zoom into it (a breadcrumb trail shows the way back out), and `onSelect` fires when the clicked node is within the shared selection depth cap.

**Not self-contained — build its props from the two helper functions shipped alongside it on the same bundle global, don't hand-construct them:**

```jsx
const { PromptCompositionIcicle, parseSystemPrompt, assignIcicleColors } = window.CopilotCostAnalyzerUI;

function Panel({ promptText }) {
  const { root, malformed } = parseSystemPrompt(promptText);
  const colors = assignIcicleColors(root);
  const [selectedId, setSelectedId] = React.useState(null);
  return (
    <PromptCompositionIcicle
      root={root}
      text={promptText}
      malformed={malformed}
      colors={colors}
      selectedId={selectedId}
      onSelect={(node) => setSelectedId(node.id)}
    />
  );
}
```

- `parseSystemPrompt(text: string)` → `{ root, malformed }`. `malformed: true` means the text had unclosed/crossed tags — the component still renders (a single flat "Full system prompt (unparsed)" block), it just can't show nested structure. This is expected behavior for real-world prompts, not an error state to avoid.
- `assignIcicleColors(root)` → a `Map<string, string>` of per-node fill colors, keyed by node id. Always derive it from the same `root` you pass as the `root` prop — colors are computed per the actual tree, not a fixed palette.
- `onSelect` receives the raw parsed node object (has `.id`, `.tagName`, `.children`, etc.) — typically used to drive a companion detail panel keyed by `node.id`.

## Props

```ts
interface PromptCompositionIcicleProps {
  root: { id: string; tagName: string | null; attrs: Record<string, string>; depth: number; start: number; contentStart: number; contentEnd: number; end: number; children: unknown[] };
  text: string;
  malformed: boolean;
  colors: Map<string, string>;
  selectedId: string | null;
  onSelect: (node: any) => void;
}
```
