"use client";

import { useSyncExternalStore } from "react";

// The <html> element's "dark" class is the single source of truth.
// Watching it means the toggle stays right however the class changes.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const isDarkNow = () => document.documentElement.classList.contains("dark");

export default function ThemeToggle() {
  // Server can't know the theme; false there, real value after hydration
  const isDark = useSyncExternalStore(subscribe, isDarkNow, () => false);

  function toggle() {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {} // private mode etc.: still switches, just isn't remembered
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Dark mode"
      onClick={toggle}
      className="relative flex h-9 w-[4.5rem] items-center justify-between rounded-full bg-neutral-200 p-1 shadow-inner transition-colors dark:bg-neutral-800"
    >
      {/* Sliding knob sits under whichever icon is active */}
      <span
        className={`absolute left-1 top-1 size-7 rounded-full bg-white shadow transition-transform duration-300 dark:bg-neutral-950 ${
          isDark ? "translate-x-9" : ""
        }`}
      />
      <span className="relative flex size-7 items-center justify-center text-neutral-900 dark:text-neutral-500">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      </span>
      <span className="relative flex size-7 items-center justify-center text-neutral-500 dark:text-white">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
        </svg>
      </span>
    </button>
  );
}
