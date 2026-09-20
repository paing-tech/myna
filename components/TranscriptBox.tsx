"use client";

import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSelect: () => void;
  onWordClick: (caretIndex: number) => void;
  readOnly: boolean;
  interim?: string;
  highlight?: { start: number; end: number } | null;
  placeholder: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  children?: React.ReactNode; // the player, shown above the text
};

// One box that is both editable and highlightable. A <textarea> can't colour
// part of its text, so the text is drawn twice: a mirror underneath shows the
// words with the highlight, and a see-through textarea on top handles typing,
// selection and the caret. Both use identical type and box size, so they line up.
const TEXT = "text-lg leading-loose whitespace-pre-wrap break-words";

export default function TranscriptBox({
  value,
  onChange,
  onSelect,
  onWordClick,
  readOnly,
  interim,
  highlight,
  placeholder,
  textareaRef,
  children,
}: Props) {
  const mirrorRef = useRef<HTMLDivElement | null>(null);

  // Scroll the mirror in step with the textarea
  function syncScroll() {
    const mirror = mirrorRef.current;
    const textarea = textareaRef.current;
    if (mirror && textarea) mirror.scrollTop = textarea.scrollTop;
  }

  // Keep the highlighted word in view while playing
  useEffect(() => {
    const textarea = textareaRef.current;
    const mark = mirrorRef.current?.querySelector("mark");
    if (!mark || !textarea) return;
    const markTop = (mark as HTMLElement).offsetTop;
    const visible = markTop >= textarea.scrollTop && markTop < textarea.scrollTop + textarea.clientHeight;
    if (!visible) textarea.scrollTop = markTop - textarea.clientHeight / 2;
    syncScroll();
  });

  const before = highlight ? value.slice(0, highlight.start) : value;
  const marked = highlight ? value.slice(highlight.start, highlight.end) : "";
  const after = highlight ? value.slice(highlight.end) : "";

  return (
    <div className="flex min-h-[45vh] flex-1 flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      {children}

      <div className="relative min-h-32 flex-1">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onSelect={onSelect}
          onScroll={syncScroll}
          onDoubleClick={(e) => onWordClick(e.currentTarget.selectionStart)}
          readOnly={readOnly}
          spellCheck={false}
          className={`${TEXT} absolute inset-0 size-full resize-none bg-transparent text-transparent caret-neutral-900 outline-none dark:caret-white`}
        />
        {/* Drawn on top so the words stay readable through a selection */}
        <div
          ref={mirrorRef}
          aria-hidden="true"
          className={`${TEXT} pointer-events-none absolute inset-0 overflow-hidden`}
        >
          {before}
          {marked && (
            <mark className="rounded bg-amber-300 text-neutral-900 dark:bg-amber-400">{marked}</mark>
          )}
          {after}
          {interim && <span className="text-neutral-400">{interim}</span>}
          {!value && !interim && <span className="text-neutral-400">{placeholder}</span>}
        </div>
      </div>
    </div>
  );
}
