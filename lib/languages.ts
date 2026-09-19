// Shared by the browser (labels) and the server (allowlist → BCP-47 code)
export const LANGUAGES = {
  my: { code: "my-MM", label: "မြန်မာ (Burmese)" },
  en: { code: "en-US", label: "English" },
} as const;

export type Language = keyof typeof LANGUAGES;

// Object.hasOwn, not LANGUAGES[value]: "toString" or "__proto__" would
// otherwise find built-in properties every object inherits.
export function toLanguageCode(value: unknown): string | null {
  if (typeof value !== "string" || !Object.hasOwn(LANGUAGES, value)) return null;
  return LANGUAGES[value as Language].code;
}
