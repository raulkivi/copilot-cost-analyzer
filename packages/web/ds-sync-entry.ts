// Entry point for the design-sync tool (see /.design-sync/config.json's
// `entry` field) — NOT part of the app itself. Deliberately outside src/
// (excluded from this package's tsconfig `include`) so it never reaches the
// app's own build/typecheck; it exists only to give the converter a stable,
// explicit list of which components to bundle for Claude Design, instead of
// scanning all of src/ (which would sweep up main.tsx's app-mounting side
// effect and break every preview).
export { Blueprint } from "./src/components/ui/Blueprint.js";
export { SegmentedControl } from "./src/components/ui/SegmentedControl.js";
export { Tag } from "./src/components/ui/Tag.js";
export { PromptCompositionIcicle } from "./src/charts/PromptCompositionIcicle.js";

// Not components — helper functions PromptCompositionIcicle needs its
// `root`/`malformed`/`colors` props built from. Exported here too so
// they're callable from the bundle global (window.CopilotCostAnalyzerUI.*),
// not just importable inside this repo.
export { parseSystemPrompt } from "./src/lib/system-prompt-parser.js";
export { assignIcicleColors } from "./src/lib/system-prompt-menu.js";
