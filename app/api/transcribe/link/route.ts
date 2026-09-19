import { toLanguageCode } from "@/lib/languages";
import { MediaError, downloadLink, errorResponse, extractAudio, parseLink, runJob } from "@/lib/media";
import { transcribeAudioFile } from "@/lib/transcribe";

export const maxDuration = 600; // seconds; download + transcription

// Body: { "url": "https://…", "language": "my" }
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const languageCode = toLanguageCode(body?.language);
    if (!languageCode) throw new MediaError("Unsupported language", 400);

    const url = parseLink(body?.url);
    if (!url) {
      throw new MediaError("Paste a link from YouTube, TikTok, Facebook or Instagram.", 400);
    }

    const text = await runJob(async (dir) => {
      const downloaded = await downloadLink(url, dir);
      const audio = await extractAudio(downloaded, dir);
      return transcribeAudioFile(audio, languageCode);
    });

    return Response.json({ text });
  } catch (err) {
    return errorResponse(err);
  }
}
