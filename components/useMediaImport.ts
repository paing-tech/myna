"use client";

import { useRef, useState } from "react";
import type { Language } from "@/lib/languages";
import type { TranscriptResult } from "@/lib/types";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // keep in sync with lib/media.ts

type Options = {
  language: Language;
  smart: boolean;
  onResult: (result: TranscriptResult) => void;
  onError: (message: string | null) => void;
};

// Uploading and link transcription, without any markup: the input row and the
// main button both drive this, so the state has to live above them.
export function useMediaImport({ language, smart, onResult, onError }: Options) {
  const [phase, setPhase] = useState<string | null>(null); // progress message; null = idle
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const busy = phase !== null;

  async function run(job: () => Promise<TranscriptResult>) {
    onError(null);
    setPhase("Starting…");
    try {
      onResult(await job());
    } catch (err) {
      // A cancel is the user's own doing, not an error to report
      if (err instanceof DOMException && err.name === "AbortError") onError(null);
      else onError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      xhrRef.current = null;
      abortRef.current = null;
      setPhase(null);
    }
  }

  function uploadFile(file: File): Promise<TranscriptResult> {
    return new Promise((resolve, reject) => {
      // XHR instead of fetch: fetch can't report upload progress, and a big
      // video on a phone connection needs a progress number.
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", `/api/transcribe/upload?language=${language}&smart=${smart ? "1" : "0"}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const percent = Math.round((e.loaded / e.total) * 100);
        setPhase(percent < 100 ? `Uploading ${percent}%…` : "Transcribing… this can take a minute or two");
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
      onError("The file is larger than 500 MB.");
      return;
    }
    setPhase("Uploading 0%…");
    run(async () => {
      const result = await uploadFile(file);
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
    setPhase("Downloading and transcribing… this can take a minute or two");
    run(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      const res = await fetch("/api/transcribe/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, language, smart }),
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
