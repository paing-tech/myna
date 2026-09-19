import "server-only";
import { FileState } from "@google/genai";
import { ai } from "@/lib/gemini";
import { MediaError } from "@/lib/media";

const MODEL = process.env.GEMINI_FILE_MODEL ?? "gemini-3.5-transcribe";

// Upload an audio file to Gemini, transcribe it, then delete it from Gemini
export async function transcribeAudioFile(file: string, languageCode: string): Promise<string> {
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
        transcription_config: { language_codes: [languageCode] },
      },
    });

    const text = interaction.output_text?.trim();
    if (!text) throw new MediaError("No speech was found in that recording.");
    return text;
  } finally {
    await ai.files.delete({ name: uploaded.name! }).catch(() => {});
  }
}
