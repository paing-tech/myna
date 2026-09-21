"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSelect: () => void;
  onWordClick: (caretIndex: number) => void;
  readOnly: boolean;
  interim?: string;
  highlight?: { start: number; end: number } | null;
  placeholder: React.ReactNode;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  children?: React.ReactNode; // the player, shown above the text
  maxHeight?: string; // the tallest the whole box may get, measured by the parent
  textClass?: string; // font size and line height, shared by both layers
};

// One box that is both editable and highlightable. A <textarea> can't colour
// part of its text, so the text is drawn twice: a mirror underneath shows the
// words with the highlight, and a see-through textarea on top handles typing,
// selection and the caret. Both use identical type and box size, so they line up.
const WRAP = "whitespace-pre-wrap break-words";

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
  maxHeight,
  textClass = "text-lg leading-loose",
}: Props) {
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const sizerRef = useRef<HTMLDivElement | null>(null);
  // A single line reads better centred; once it wraps, centring is hard to read
  const [oneLine, setOneLine] = useState(true);

  useEffect(() => {
    const sizer = sizerRef.current;
    if (!sizer) return;
    const observer = new ResizeObserver(([entry]) => {
      const lineHeight = parseFloat(getComputedStyle(sizer).lineHeight) || 1;
      // the sizer carries a trailing newline, so one content line measures two
      const lines = Math.round(entry.contentRect.height / lineHeight) - 1;
      setOneLine(lines <= 1);
    });
    observer.observe(sizer);
    return () => observer.disconnect();
  }, []);

  // Scroll the mirror in step with the textarea
  function syncScroll() {
    const mirror = mirrorRef.current;
    const textarea = textareaRef.current;
    if (mirror && textarea) mirror.scrollTop = textarea.scrollTop;
  }

  // While recording, follow the words as they arrive
  useEffect(() => {
    if (!readOnly) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.scrollTop = textarea.scrollHeight;
    syncScroll();
  });

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

  const TEXT_STYLE = `${textClass} ${WRAP} ${oneLine ? "text-center" : "text-left"}`;

  const before = highlight ? value.slice(0, highlight.start) : value;
  const marked = highlight ? value.slice(highlight.start, highlight.end) : "";
  const after = highlight ? value.slice(highlight.end) : "";

  return (
    <div
      style={{ maxHeight }}
      className={`flex min-h-0 flex-col gap-2 bg-background px-2 pt-2 ${oneLine ? "pb-2" : ""}`}
    >
      {children}

      {/* Height comes from the invisible sizer below: the box hugs short text
          and grows with long text, up to max-h, after which the text scrolls. */}
      <div className="relative min-h-9 flex-1 overflow-hidden">
        <div ref={sizerRef} aria-hidden="true" className={`${TEXT_STYLE} invisible`}>
          {value || placeholder}
          {interim}
          {"\n"}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onSelect={onSelect}
          onScroll={syncScroll}
          onDoubleClick={(e) => onWordClick(e.currentTarget.selectionStart)}
          readOnly={readOnly}
          spellCheck={false}
          className={`${TEXT_STYLE} absolute inset-0 size-full resize-none bg-transparent text-transparent caret-neutral-900 outline-none dark:caret-white`}
        />
        {/* Drawn on top so the words stay readable through a selection */}
        <div
          ref={mirrorRef}
          aria-hidden="true"
          className={`${TEXT_STYLE} pointer-events-none absolute inset-0 overflow-hidden`}
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
