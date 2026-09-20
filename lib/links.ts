// The sites the server will download from. Used to spot a link the user has
// pasted into the transcript.
const LINK_PATTERN =
  /https?:\/\/[^\s]*?(?:youtube\.com|youtu\.be|tiktok\.com|facebook\.com|fb\.watch|instagram\.com)\/[^\s]*/gi;

// The last link in the text: if several were pasted, the newest one wins
export function findLink(text: string): { url: string; start: number; end: number } | null {
  let found: { url: string; start: number; end: number } | null = null;
  for (const match of text.matchAll(LINK_PATTERN)) {
    // Trailing punctuation is almost never part of the link
    const url = match[0].replace(/[.,;:!?)\]]+$/, "");
    found = { url, start: match.index, end: match.index + url.length };
  }
  return found;
}

// The text with that link taken out, and the gap it left tidied up
export function removeLink(text: string, start: number, end: number): string {
  return `${text.slice(0, start)}${text.slice(end)}`.replace(/[ \t]{2,}/g, " ").trim();
}
