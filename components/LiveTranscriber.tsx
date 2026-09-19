"use client";

import { useEffect, useRef, useState } from "react";
import {
  GoogleGenAI,
  type LiveConnectConfig,
  type LiveServerMessage,
  type Session,
} from "@google/genai";

type Status = "idle" | "connecting" | "recording" | "finishing";
type Language = "my" | "en";

const LANGUAGE_LABELS: Record<Language, string> = {
  my: "မြန်မာ (Burmese)",
  en: "English",
};

// Gemini Live sessions are capped at 10 minutes. Stop 15 s early so the
// last sentence still has time to come back before Gemini cuts us off.
const MAX_SECONDS = 10 * 60 - 15;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 125 → "2:05"
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Turn browser errors into something a user can act on
function startErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError")
      return "Microphone access was blocked. Allow it from the address bar and try again.";
    if (err.name === "NotFoundError") return "No microphone was found.";
    if (err.name === "NotReadableError")
      return "The microphone is being used by another app.";
  }
  return "Could not start. Check your connection and try again.";
}

export default function LiveTranscriber() {
  const [status, setStatus] = useState<Status>("idle");
  const [language, setLanguage] = useState<Language>("my");
  const [error, setError] = useState<string | null>(null);
  // One editable string (not an array) so the user can fix it freely
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Leaving the page mid-recording must still release the mic and socket
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioContextRef.current?.close();
      sessionRef.current?.close();
    };
  }, []);

  function handleMessage(message: LiveServerMessage) {
    const content = message.serverContent;
    if (!content) return;

    if (content.interimInputTranscription?.text) {
      setInterimText(content.interimInputTranscription.text);
    }
    if (content.inputTranscription?.text) {
      const text = content.inputTranscription.text;
      setFinalText((prev) => (prev ? `${prev} ${text}` : text));
      setInterimText("");
    }
  }

  async function start() {
    // Keep existing (possibly edited) text; a new recording is appended to it
    setError(null);
    setInterimText("");
    setElapsed(0);
    setStatus("connecting");

    try {
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
        config,
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

      // Fires if the mic is unplugged or the OS revokes it (not on our own stop)
      stream.getAudioTracks()[0].onended = () => {
        setError("The microphone was disconnected.");
        stop();
      };

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

      // Clock: measure from a fixed start time, so it never drifts
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        setElapsed(seconds);
        if (seconds >= MAX_SECONDS) {
          setError("Reached the 10-minute limit. Press Start to continue.");
          stop();
        }
      }, 250);

      setStatus("recording");
    } catch (err) {
      console.error(err);
      setError(startErrorMessage(err));
      cleanup();
    }
  }

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
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
    stopTimer();
    stopAudio();
    if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);
    finishTimeoutRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    setStatus("idle");
  }

  function stop() {
    // Already stopping (e.g. timer and mic-unplug both fired) → do nothing
    if (!streamRef.current) return;

    const session = sessionRef.current;
    stopTimer();
    stopAudio();
    session?.sendRealtimeInput({ audioStreamEnd: true });
    setStatus("finishing");

    finishTimeoutRef.current = setTimeout(() => {
      if (sessionRef.current === session) cleanup();
    }, 5000);
  }

  // Copies the highlighted part if there is one, otherwise everything
  async function copy() {
    const box = textareaRef.current;
    const selected = box ? finalText.slice(box.selectionStart, box.selectionEnd) : "";
    await navigator.clipboard.writeText(selected || finalText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function updateSelection() {
    const box = textareaRef.current;
    setHasSelection(!!box && box.selectionStart !== box.selectionEnd);
  }

  const busy = status === "connecting" || status === "finishing";
  const hasText = finalText.trim().length > 0;

  // Same box size whether editable or live, so nothing jumps on Start/Stop
  const transcriptBox =
    "block w-full flex-1 min-h-[40vh] rounded-xl border border-neutral-200 bg-white p-4 " +
    "text-lg leading-loose whitespace-pre-wrap dark:border-neutral-800 dark:bg-neutral-900";

  const secondaryButton =
    "h-11 rounded-full border border-neutral-300 px-5 text-sm font-medium " +
    "hover:bg-neutral-100 active:scale-95 transition dark:border-neutral-700 dark:hover:bg-neutral-800";

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Top row: language picker + recording clock */}
      <div className="flex items-center justify-between gap-3">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
          disabled={status !== "idle"}
          aria-label="Language"
          className="h-11 rounded-full border border-neutral-300 bg-transparent px-4 text-base disabled:opacity-50 dark:border-neutral-700"
        >
          {(Object.keys(LANGUAGE_LABELS) as Language[]).map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_LABELS[code]}
            </option>
          ))}
        </select>

        {status === "recording" && (
          <span className="flex items-center gap-2 text-sm tabular-nums text-neutral-500">
            <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
            {formatTime(elapsed)} / {formatTime(MAX_SECONDS)}
          </span>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      )}

      {status === "idle" ? (
        // Stopped: a normal text box — select, delete, retype, copy
        <textarea
          ref={textareaRef}
          value={finalText}
          onChange={(e) => setFinalText(e.target.value)}
          onSelect={updateSelection}
          placeholder="Press Start and speak. You can edit the text after stopping."
          className={`${transcriptBox} resize-none outline-none focus:border-neutral-400 dark:focus:border-neutral-600`}
        />
      ) : (
        // Recording: read-only, with the live guess in grey
        <div className={transcriptBox} aria-live="polite">
          {finalText}{" "}
          <span className="text-neutral-400">{interimText}</span>
          {!finalText && !interimText && (
            <span className="text-neutral-400">Listening…</span>
          )}
        </div>
      )}

      {hasText && status === "idle" && (
        <div className="flex gap-2">
          <button onClick={copy} className={secondaryButton}>
            {copied ? "Copied!" : hasSelection ? "Copy selection" : "Copy all"}
          </button>
          <button onClick={() => setFinalText("")} className={secondaryButton}>
            Clear
          </button>
        </div>
      )}

      {/* Record button sticks to the bottom, within thumb reach on phones */}
      <div className="sticky bottom-0 -mx-4 flex justify-center bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          onClick={status === "recording" ? stop : start}
          disabled={busy}
          className={`flex h-14 w-full max-w-xs items-center justify-center gap-3 rounded-full text-base font-semibold shadow-lg transition active:scale-95 disabled:opacity-60 ${
            status === "recording"
              ? "bg-red-600 text-white hover:bg-red-700"
              : "bg-foreground text-background hover:opacity-90"
          }`}
        >
          {status === "recording" ? (
            <span className="size-3.5 rounded-sm bg-white" />
          ) : (
            <span className="size-3.5 rounded-full bg-red-500" />
          )}
          {status === "idle" && "Start"}
          {status === "connecting" && "Connecting…"}
          {status === "recording" && "Stop"}
          {status === "finishing" && "Finishing…"}
        </button>
      </div>
    </div>
  );
}
