"use client";

import { useEffect, useRef, useState } from "react";
import { LANGUAGES, type Language } from "@/lib/languages";

type Props = {
  value: Language;
  onChange: (language: Language) => void;
  disabled: boolean;
};

// A native <select> renders its text with the system font on macOS, which
// mangles Burmese. This is plain DOM, so it uses the app's Burmese font.
export default function LanguagePicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close when clicking elsewhere or pressing Escape
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const codes = Object.keys(LANGUAGES) as Language[];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language"
        className="flex min-h-11 items-center gap-2 rounded-full border border-neutral-300 px-4 py-2 text-base leading-loose transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        {LANGUAGES[value].label}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 overflow-hidden rounded-2xl border border-neutral-200 bg-background py-1 shadow-xl dark:border-neutral-800"
        >
          {codes.map((code) => (
            <li key={code}>
              <button
                type="button"
                role="option"
                aria-selected={code === value}
                onClick={() => {
                  onChange(code);
                  setOpen(false);
                }}
                className={`block w-full px-5 py-2 text-left text-base leading-loose transition hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  code === value ? "font-semibold" : ""
                }`}
              >
                {LANGUAGES[code].label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
