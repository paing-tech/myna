"use client";

import { useEffect, useSyncExternalStore } from "react";
import SegmentedControl from "@/components/SegmentedControl";
import { MoonIcon, SmartphoneIcon, SunIcon } from "@/components/icons";

type Theme = "light" | "dark" | "system";

// The choice lives in localStorage; what's on screen is the "dark" class on
// <html>, which the script in layout.tsx sets before the first paint.
const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system"; // private mode, blocked storage…
  }
}

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && prefersDark()));
}

function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", theme);
  } catch {} // still switches, just isn't remembered
  applyTheme(theme);
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export default function AppearancePicker() {
  // "system" on the server and on the first client render, so the two agree
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);

  // While following the system, react to the phone switching at sunset
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readTheme() === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <SegmentedControl
      label="Appearance"
      value={theme}
      onChange={setTheme}
      options={[
        { value: "light", label: "Light", content: <SunIcon className="size-6" /> },
        { value: "system", label: "Follow system", content: <SmartphoneIcon className="size-6" /> },
        { value: "dark", label: "Dark", content: <MoonIcon className="size-6" /> },
      ]}
    />
  );
}
