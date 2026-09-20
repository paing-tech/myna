"use client";

type Option<T extends string> = {
  value: T;
  label: string; // what a screen reader reads, and the tooltip
  content: React.ReactNode; // the icon or glyph
};

type Props<T extends string> = {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
};

// The three-way switches in the settings sheet. Sized to match the
// copy/undo/clear buttons above the transcript.
export default function SegmentedControl<T extends string>({ label, value, options, onChange }: Props<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex items-center gap-1 rounded-full bg-neutral-200/70 p-1.5 dark:bg-neutral-800"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={`flex size-12 items-center justify-center rounded-full transition ${
              active
                ? // a light knob in light mode, a dark one in dark mode
                  "bg-white text-neutral-900 shadow-sm dark:bg-neutral-600 dark:text-white"
                : "text-neutral-500 hover:bg-white/60 dark:text-neutral-400 dark:hover:bg-neutral-700/60"
            }`}
          >
            {option.content}
          </button>
        );
      })}
    </div>
  );
}
