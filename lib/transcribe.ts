import "server-only";
import { FileState } from "@google/genai";
import { ai } from "@/lib/gemini";
import { MediaError } from "@/lib/media";
import type { Word } from "@/lib/types";

const MODEL = process.env.GEMINI_FILE_MODEL ?? "gemini-3.5-transcribe";

// Gemini returns offsets as strings like "1.400s"
function toSeconds(offset: unknown): number {
  const n = Number(String(offset ?? "").replace(/s$/, ""));
  return Number.isFinite(n) ? n : 0;
}

// Gemini reports positions as UTF-8 BYTE offsets. For English they match
// character positions, but a Burmese or Chinese character is 3 bytes, so the
// highlight would land ~3× too far along. This maps bytes → string positions.
function byteToCharIndex(text: string): number[] {
  const map = new Array<number>(Buffer.byteLength(text, "utf8") + 1);
  let byte = 0;
  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i)!;
    const chars = codePoint > 0xffff ? 2 : 1; // surrogate pair?
    const bytes = Buffer.byteLength(String.fromCodePoint(codePoint), "utf8");
    for (let b = 0; b < bytes; b++) map[byte + b] = i;
    byte += bytes;
    i += chars;
  }
  map[byte] = text.length;
  return map;
}

type WordInfo = {
  type?: string;
  text?: string;
  start_offset?: string;
  end_offset?: string;
  start_index?: number;
  end_index?: number;
};

// Upload an audio file to Gemini, transcribe it with word timings,
// then delete it from Gemini
export async function transcribeAudioFile(
  file: string,
  languageCodes: string[],
): Promise<{ text: string; words: Word[] }> {
  const uploaded = await ai.files.upload({ file, config: { mimeType: "audio/ogg" } });

  try {
    // Large files may need a moment before they can be used
    let info = uploaded;
    while (info.state === FileState.PROCESSING) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      info = await ai.files.get({ name: uploaded.name! });
    }
    if (info.state === FileState.FAILED || !info.uri) {
      throw new MediaError("Gemini couldn't process that audio.");
    }

    const interaction = await ai.interactions.create({
      model: MODEL,
      input: [{ type: "audio", uri: info.uri, mime_type: "audio/ogg" }],
      generation_config: {
        transcription_config: {
          language_codes: languageCodes,
          // "word" timings drive the highlight-as-it-plays view
          mode: { type: "verbatim" as const, timestamp_granularities: ["word"] },
        },
      },
    });

    // Offsets refer to the raw text, so trim only after mapping them
    const raw = interaction.output_text ?? "";
    const text = raw.trim();
    if (!text) throw new MediaError("No speech was found in that recording.");
    const leading = raw.length - raw.trimStart().length;

    // Timings live in annotations beside the text blocks
    const byteToChar = byteToCharIndex(raw);
    const clamp = (byteIndex: number) =>
      Math.min(Math.max((byteToChar[byteIndex] ?? raw.length) - leading, 0), text.length);
    const words: Word[] = [];
    for (const step of interaction.steps ?? []) {
      // Steps are a union; only message steps carry content blocks
      const blocks = (step as { content?: unknown[] }).content ?? [];
      for (const content of blocks) {
        const annotations = (content as { annotations?: WordInfo[] }).annotations ?? [];
        for (const a of annotations) {
          if (a.type !== "word_info" || a.start_index == null || a.end_index == null) continue;
          words.push({
            start: toSeconds(a.start_offset),
            end: toSeconds(a.end_offset),
            startIndex: clamp(a.start_index),
            endIndex: clamp(a.end_index),
          });
        }
      }
    }

    return { text, words };
  } finally {
    await ai.files.delete({ name: uploaded.name! }).catch(() => {});
  }
}
