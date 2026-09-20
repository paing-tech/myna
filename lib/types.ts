// Shared between the API routes and the browser

// One word, timed. The index pair points into the transcript text, so the
// player can highlight the exact characters — Burmese has no spaces, so
// splitting the text on spaces would not work.
export type Word = {
  start: number; // seconds
  end: number;
  startIndex: number; // character offset in `text`
  endIndex: number;
};

export type TranscriptResult = {
  text: string;
  words: Word[];
  mediaUrl?: string; // set when the server holds the media (non-YouTube links)
  mediaKind?: "audio" | "video" | "youtube";
  youtubeId?: string; // set when playback uses YouTube's own embed
};
