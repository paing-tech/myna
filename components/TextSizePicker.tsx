"use client";

import { useSyncExternalStore } from "react";
import SegmentedControl from "@/components/SegmentedControl";

export type TextSize = "small" | "medium" | "large";

// Both layers of the transcript use this, so they always line up
export const TEXT_SIZE_CLASS: Record<TextSize, string> = {
  small: "text-base leading-loose",
  medium: "text-lg leading-loose",
  large: "text-2xl leading-loose",
};

const listeners = new Set<() => void>();

function readSize(): TextSize {
  try {
    const stored = localStorage.getItem("textSize");
    return stored === "small" || stored === "large" ? stored : "medium";
  } catch {
    return "medium";
  }
}

function setSize(size: TextSize) {
  try {
    localStorage.setItem("textSize", size);
  } catch {} // still changes, just isn't remembered
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function useTextSize(): TextSize {
  return useSyncExternalStore(subscribe, readSize, () => "medium" as TextSize);
}

export default function TextSizePicker() {
  const size = useTextSize();

  return (
    <SegmentedControl
      label="Text size"
      value={size}
      onChange={setSize}
      options={[
        { value: "small", label: "Small", content: <span className="text-sm font-semibold">A</span> },
        { value: "medium", label: "Medium", content: <span className="text-lg font-semibold">A</span> },
        { value: "large", label: "Large", content: <span className="text-2xl font-semibold">A</span> },
      ]}
    />
  );
}
