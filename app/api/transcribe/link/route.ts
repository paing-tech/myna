import { toLanguageCodes } from "@/lib/languages";
import {
  MediaError,
  downloadLink,
  errorResponse,
  extractAudio,
  parseLink,
  runJob,
  saveForPlayback,
  youtubeId,
} from "@/lib/media";
import { transcribeAudioFile } from "@/lib/transcribe";

export const maxDuration = 600; // seconds; download + transcription

// Body: { "url": "https://…", "language": "my" }
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const languageCodes = toLanguageCodes(body?.language);
    if (!languageCodes) throw new MediaError("Unsupported language", 400);

    const url = parseLink(body?.url);
    if (!url) {
      throw new MediaError("Paste a link from YouTube, TikTok, Facebook or Instagram.", 400);
    }

    // YouTube plays through its own embed, so its video never has to be stored
    const ytId = youtubeId(url);

    const result = await runJob(async (dir) => {
      const downloaded = await downloadLink(url, dir);
      const audio = await extractAudio(downloaded, dir);
      const { text, words } = await transcribeAudioFile(audio, languageCodes);

      if (ytId) return { text, words, mediaKind: "youtube" as const, youtubeId: ytId };

      // Keep the audio so it can be played back alongside the words
      const id = await saveForPlayback(audio);
      if (!id) return { text, words };
      return { text, words, mediaUrl: `/api/media/${id}`, mediaKind: "audio" as const };
    });

    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
