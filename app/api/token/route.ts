import { Modality } from "@google/genai";
import { ai } from "@/lib/gemini";

const MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-3.5-transcribe-live";

// Only these can be requested. Key = what the browser sends, value = BCP-47 code.
const LANGUAGES: Record<string, string> = {
  my: "my-MM", // Burmese
  en: "en-US", // English
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const languageCode = LANGUAGES[body.language];
  if (!languageCode) {
    return Response.json({ error: "Unsupported language" }, { status: 400 });
  }

  const config = {
    responseModalities: [Modality.TEXT],
    inputAudioTranscription: { languageCodes: [languageCode] },
  };

  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 1 * 60 * 1000).toISOString();

  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: { model: MODEL, config },
    },
  });

  // Send back exactly what the token allows, so the browser can't mismatch it
  return Response.json({ token: token.name, model: MODEL, config });
}
