"use client";

import { useRef, useState } from "react";
import {
  GoogleGenAI,
  type LiveConnectConfig,
  type LiveServerMessage,
  type Session,
} from "@google/genai";

type Status = "idle" | "connecting" | "recording" | "finishing";
type Language = "my" | "en"; // NEW

const LANGUAGE_LABELS: Record<Language, string> = { // NEW
  my: "မြန်မာ (Burmese)",
  en: "English",
};

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function LiveTranscriber() {
  const [status, setStatus] = useState<Status>("idle");
  const [language, setLanguage] = useState<Language>("my"); // NEW — Burmese by default
  const [error, setError] = useState<string | null>(null);
  const [finalText, setFinalText] = useState<string[]>([]);
  const [interimText, setInterimText] = useState("");

  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);

  function handleMessage(message: LiveServerMessage) {
    const content = message.serverContent;
    if (!content) return;

    if (content.interimInputTranscription?.text) {
      setInterimText(content.interimInputTranscription.text);
    }
    if (content.inputTranscription?.text) {
      const text = content.inputTranscription.text;
      setFinalText((prev) => [...prev, text]);
      setInterimText("");
    }
  }

  async function start() {
    setError(null);
    setFinalText([]);
    setInterimText("");
    setStatus("connecting");

    try {
      // NEW — tell the server which language; it validates and locks it in
      const res = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
      const { token, model, config } = (await res.json()) as {
        token: string;
        model: string;
        config: LiveConnectConfig;
      };

      const ai = new GoogleGenAI({
        apiKey: token,
        httpOptions: { apiVersion: "v1alpha" },
      });

      sessionRef.current = await ai.live.connect({
        model,
        config, // NEW — exactly what the server locked into the token
        callbacks: {
          onmessage: handleMessage,
          onerror: (e) => {
            console.error("Live error:", e);
            setError("Connection error.");
          },
          onclose: (e) => {
            console.log("Live closed:", e.code, e.reason);
            if (e.code !== 1000) setError(`Connection closed: ${e.reason || e.code}`);
            cleanup();
          },
        },
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      await audioContext.audioWorklet.addModule("/pcm-processor.js");

      const source = audioContext.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioContext, "pcm-processor");
      workletRef.current = worklet;
      source.connect(worklet);
      worklet.connect(audioContext.destination);

      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        sessionRef.current?.sendRealtimeInput({
          audio: {
            data: toBase64(event.data),
            mimeType: "audio/pcm;rate=16000",
          },
        });
      };

      setStatus("recording");
    } catch (err) {
      console.error(err);
      setError("Could not start. Check microphone permission and the console.");
      cleanup();
    }
  }

  function stopAudio() {
    workletRef.current?.disconnect();
    workletRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function cleanup() {
    stopAudio();
    sessionRef.current?.close();
    sessionRef.current = null;
    setStatus("idle");
  }

  function stop() {
    const session = sessionRef.current;
    stopAudio();
    session?.sendRealtimeInput({ audioStreamEnd: true });
    setStatus("finishing");
    setTimeout(() => {
      if (sessionRef.current === session) cleanup();
    }, 5000);
  }

  const busy = status === "connecting" || status === "finishing";

  return (
    <div>
      {/* NEW — language picker, locked while a session is running */}
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value as Language)}
        disabled={status !== "idle"}
      >
        {(Object.keys(LANGUAGE_LABELS) as Language[]).map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_LABELS[code]}
          </option>
        ))}
      </select>

      <button
        onClick={status === "recording" ? stop : start}
        disabled={busy}
      >
        {status === "idle" && "Start"}
        {status === "connecting" && "Connecting…"}
        {status === "recording" && "Stop"}
        {status === "finishing" && "Finishing…"}
      </button>

      {error && <p>{error}</p>}

      <p>
        {finalText.join(" ")}{" "}
        <span className="text-gray-400">{interimText}</span>
      </p>
    </div>
  );
}
