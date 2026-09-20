import type { TranscriptResult } from "@/lib/types";

export type Played = TranscriptResult & { offset: number; baseText: string };

// Keep word timings usable after the user edits the text. Find what changed,
// then keep the words before it, shift the words after it, and drop only the
// word that was actually edited.
export function remapWords(played: Played, before: string, after: string): Played {
  // Match the unchanged tail first, then the unchanged head. Doing it the
  // other way round mis-reads an insertion at the very start of the text.
  const max = Math.min(before.length, after.length);
  let suffix = 0;
  while (suffix < max && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) {
    suffix++;
  }
  let prefix = 0;
  while (prefix < max - suffix && before[prefix] === after[prefix]) prefix++;

  const changedEnd = before.length - suffix; // end of the edited stretch, in the old text
  const delta = after.length - before.length;

  const words = played.words.flatMap((word) => {
    const start = played.offset + word.startIndex;
    const end = played.offset + word.endIndex;
    if (end <= prefix) return [{ ...word, startIndex: start, endIndex: end }]; // untouched
    if (start >= changedEnd) {
      return [{ ...word, startIndex: start + delta, endIndex: end + delta }]; // shifted
    }
    return []; // this word was edited; its timing no longer means anything
  });

  // Indices are absolute now, so the offset is spent
  return { ...played, words, offset: 0, baseText: after };
}
