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
  const language = body?.language;

  // Object.hasOwn, not LANGUAGES[language]: "toString" or "__proto__" would
  // otherwise find built-in properties every object inherits.
  if (typeof language !== "string" || !Object.hasOwn(LANGUAGES, language)) {
    return Response.json({ error: "Unsupported language" }, { status: 400 });
  }

  const config = {
    responseModalities: [Modality.TEXT],
    inputAudioTranscription: { languageCodes: [LANGUAGES[language]] },
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
