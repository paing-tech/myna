import { Modality } from "@google/genai";
import { ai } from "@/lib/gemini";
import { toLanguageCode } from "@/lib/languages";

const MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-3.5-transcribe-live";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const languageCode = toLanguageCode(body?.language);
  if (!languageCode) {
    return Response.json({ error: "Unsupported language" }, { status: 400 });
  }

  const config = {
    responseModalities: [Modality.TEXT],
    inputAudioTranscription: { languageCodes: [languageCode] },
  };

  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 1 * 60 * 1000).toISOString();

  try {
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
  } catch (err) {
    // Full detail in the server log; nothing internal leaks to the browser
    console.error("Token creation failed:", err);
    return Response.json({ error: "Could not start a session" }, { status: 502 });
  }
}
