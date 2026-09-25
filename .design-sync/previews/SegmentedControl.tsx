import { useState } from "react";
import { SegmentedControl } from "@copilot-cost-analyzer/web";

// A radio-group rendered as a pill-shaped tab strip — used for the
// Learn/Analyze mode switch (AppHeader.tsx) and the Pretty/Raw/Icicle
// format toggle (SystemPromptInspector.tsx).

const MODE_OPTIONS = [
  { value: "learn", label: "Learn" },
  { value: "analyze", label: "Analyze" },
] as const;

export function ModeSwitch() {
  const [mode, setMode] = useState<"learn" | "analyze">("analyze");
  return <SegmentedControl name="mode" options={MODE_OPTIONS} value={mode} onChange={setMode} />;
}

const FORMAT_OPTIONS = [
  { value: "pretty", label: "Pretty" },
  { value: "raw", label: "Raw" },
  { value: "icicle", label: "Icicle" },
] as const;

export function ThreeOption() {
  const [format, setFormat] = useState<"pretty" | "raw" | "icicle">("pretty");
  return <SegmentedControl name="promptFormat" options={FORMAT_OPTIONS} value={format} onChange={setFormat} />;
}
