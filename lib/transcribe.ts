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
          mode: { type: "verbatim", timestamp_granularities: ["word"] },
        },
      },
    });

    const text = interaction.output_text?.trim();
    if (!text) throw new MediaError("No speech was found in that recording.");

    // Timings live in annotations beside the text blocks
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
            startIndex: a.start_index,
            endIndex: a.end_index,
          });
        }
      }
    }

    return { text, words };
  } finally {
    await ai.files.delete({ name: uploaded.name! }).catch(() => {});
  }
}
