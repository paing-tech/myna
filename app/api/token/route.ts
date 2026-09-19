import { Modality } from "@google/genai";
import { ai } from "@/lib/gemini";

export async function POST() {
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 1 * 60 * 1000).toISOString();

  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model: process.env.GEMINI_LIVE_MODEL,
        config: {
          responseModalities: [Modality.TEXT],
          inputAudioTranscription: { languageCodes: [] },  // [] = auto-detect
        },
      },
    },
  });

    return Response.json({ token: token.name });
}
