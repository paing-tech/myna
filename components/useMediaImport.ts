"use client";

import { useRef, useState } from "react";
import type { Language } from "@/lib/languages";
import type { TranscriptResult } from "@/lib/types";

const MAX_UPLOAD_MB = 100; // keep in sync with lib/media.ts
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

type Options = {
  language: Language;
  onResult: (result: TranscriptResult) => void;
  onError: (message: string | null) => void;
};

// Uploading and link transcription, without any markup: the input row and the
// main button both drive this, so the state has to live above them.
// How long the file's own length suggests transcription will take. Gemini
// reports no progress, so the percentage is an estimate anchored to this.
function expectedSeconds(mediaSeconds: number): number {
  return mediaSeconds > 0 ? Math.max(6, mediaSeconds / 5) : 30;
}

// Read a file's duration without uploading it
function mediaDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const element = document.createElement(file.type.startsWith("video") ? "video" : "audio");
    const url = URL.createObjectURL(file);
    const finish = (seconds: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(seconds) ? seconds : 0);
    };
    element.preload = "metadata";
    element.onloadedmetadata = () => finish(element.duration);
    element.onerror = () => finish(0);
    element.src = url;
  });
}

type Timer = { current: ReturnType<typeof setInterval> | null };

// A percentage that creeps towards 95% over the expected time, then waits
// there for the real answer. Honest about being an estimate, not a fake clock.
function runEstimate(seconds: number, setPhase: (text: string) => void, timer: Timer) {
  clearEstimate(timer);
  const startedAt = Date.now();
  const tick = () => {
    const elapsed = (Date.now() - startedAt) / 1000;
    setPhase(`Transcribing ${Math.min(95, Math.round((elapsed / seconds) * 100))}%`);
  };
  tick();
  timer.current = setInterval(tick, 400);
}

function clearEstimate(timer: Timer) {
  if (timer.current) clearInterval(timer.current);
  timer.current = null;
}

export function useMediaImport({ language, onResult, onError }: Options) {
  const [phase, setPhase] = useState<string | null>(null); // progress message; null = idle
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const estimateRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const busy = phase !== null;

  const startEstimate = (seconds: number) => runEstimate(seconds, setPhase, estimateRef);
  const stopEstimate = () => clearEstimate(estimateRef);

  async function run(job: () => Promise<TranscriptResult>) {
    onError(null);
    setPhase("Transcribing");
    try {
      onResult(await job());
    } catch (err) {
      // A cancel is the user's own doing, not an error to report
      if (err instanceof DOMException && err.name === "AbortError") onError(null);
      else onError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      stopEstimate();
      xhrRef.current = null;
      abortRef.current = null;
      setPhase(null);
    }
  }

  function uploadFile(file: File, expected: number): Promise<TranscriptResult> {
    return new Promise((resolve, reject) => {
      // XHR instead of fetch: fetch can't report upload progress, and a big
      // video on a phone connection needs a progress number.
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", `/api/transcribe/upload?language=${language}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const percent = Math.round((e.loaded / e.total) * 100);
        if (percent < 100) setPhase(`Uploading ${percent}%`);
        else startEstimate(expected); // the server has it now
      };
      xhr.onload = () => {
        let data: Partial<TranscriptResult> & { error?: string } = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status < 300 && data.text) resolve({ text: data.text, words: data.words ?? [] });
        else reject(new Error(data.error ?? "Upload failed. Please try again."));
      };
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"));
      xhr.send(file);
    });
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      onError(`The file is larger than ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    setPhase("Uploading 0%");
    run(async () => {
      const expected = expectedSeconds(await mediaDuration(file));
      const result = await uploadFile(file, expected);
      // The browser already has this file, so play it straight from memory
      return {
        ...result,
        mediaUrl: URL.createObjectURL(file),
        mediaKind: file.type.startsWith("video") ? ("video" as const) : ("audio" as const),
      };
    });
  }

  function transcribeLink(url: string) {
    if (!url.trim() || busy) return;
    startEstimate(45); // download plus transcription, for a typical clip
    run(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      const res = await fetch("/api/transcribe/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, language }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.text) throw new Error(data.error ?? "Couldn't transcribe that link.");
      return data as TranscriptResult;
    });
  }

  // Stops waiting for the result. Work already running on the server finishes
  // on its own; we simply stop listening.
  function cancel() {
    xhrRef.current?.abort();
    abortRef.current?.abort();
  }

  return { phase, busy, pickFile, transcribeLink, cancel };
}
