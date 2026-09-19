// Shared by the browser (labels) and the server (allowlist → BCP-47 codes).
// Order here is the order in the dropdown.
export const LANGUAGES = {
  // Two hints: Gemini chooses between only these, and handles mixed speech
  mix: { codes: ["my-MM", "en-US"], label: "မြန်မာ + English" },
  my: { codes: ["my-MM"], label: "မြန်မာ" },
  en: { codes: ["en-US"], label: "English" },
  zh: { codes: ["cmn-Hans-CN"], label: "中文" },
} as const;

export type Language = keyof typeof LANGUAGES;

export const DEFAULT_LANGUAGE: Language = "mix";

// Object.hasOwn, not LANGUAGES[value]: "toString" or "__proto__" would
// otherwise find built-in properties every object inherits.
export function toLanguageCodes(value: unknown): string[] | null {
  if (typeof value !== "string" || !Object.hasOwn(LANGUAGES, value)) return null;
  return [...LANGUAGES[value as Language].codes];
}
