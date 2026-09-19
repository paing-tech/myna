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
        model: process.env.GEMINI_LIVE_MODEL,  // TODO 2: the live model from env
        config: {
          responseModalities: ["TEXT"],
          inputAudioTranscription: { languageCodes: [] },  // [] = auto-detect
        },
      },
    },
  });

  // TODO 3: return JSON with the token's name to the browser
  //   hint: Response.json({ ... })
}
