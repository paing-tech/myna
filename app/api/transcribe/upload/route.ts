import path from "node:path";
import { toLanguageCode } from "@/lib/languages";
import {
  MAX_UPLOAD_BYTES,
  MediaError,
  errorResponse,
  extractAudio,
  runJob,
  saveUpload,
} from "@/lib/media";
import { transcribeAudioFile } from "@/lib/transcribe";

export const maxDuration = 600; // seconds; long videos take a while

// Body = the raw file (not multipart), so it can stream straight to disk.
// Language comes in the query string: POST /api/transcribe/upload?language=my
export async function POST(request: Request) {
  try {
    const languageCode = toLanguageCode(new URL(request.url).searchParams.get("language"));
    if (!languageCode) throw new MediaError("Unsupported language", 400);
    if (!request.body) throw new MediaError("No file was sent.", 400);

    const declaredSize = Number(request.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_UPLOAD_BYTES) {
      throw new MediaError("The file is larger than 500 MB.", 413);
    }

    const text = await runJob(async (dir) => {
      const input = path.join(dir, "upload");
      await saveUpload(request.body!, input);
      const audio = await extractAudio(input, dir);
      return transcribeAudioFile(audio, languageCode);
    });

    return Response.json({ text });
  } catch (err) {
    return errorResponse(err);
  }
}
