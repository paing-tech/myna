"use client";

import { useRef, useState } from "react";
import { PlayIcon, UploadIcon } from "@/components/icons";
import type { Language } from "@/lib/languages";
import type { TranscriptResult } from "@/lib/types";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // keep in sync with lib/media.ts

type Props = {
  language: Language;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onResult: (result: TranscriptResult) => void;
  onError: (message: string | null) => void;
};

// XHR instead of fetch: fetch can't report upload progress, and a big
// video on a phone connection needs a progress number.
function uploadFile(
  file: File,
  language: Language,
  onProgress: (percent: number) => void,
): Promise<TranscriptResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/transcribe/upload?language=${language}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
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
    xhr.send(file);
  });
}

export default function MediaImport({ language, disabled, onBusyChange, onResult, onError }: Props) {
  const [phase, setPhase] = useState<string | null>(null); // progress message; null = idle
  const [link, setLink] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const busy = phase !== null;

  async function run(job: () => Promise<TranscriptResult>) {
    onError(null);
    onBusyChange(true);
    try {
      onResult(await job());
      setLink("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPhase(null);
      onBusyChange(false);
    }
  }

  function handleFile(file: File | undefined) {
    if (fileInputRef.current) fileInputRef.current.value = ""; // allow picking the same file again
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      onError("The file is larger than 500 MB.");
      return;
    }

    setPhase("Uploading 0%…");
    run(async () => {
      const result = await uploadFile(file, language, (percent) => {
        setPhase(percent < 100 ? `Uploading ${percent}%…` : "Transcribing… this can take a minute or two");
      });
      // The browser already has this file, so play it straight from memory
      return {
        ...result,
        mediaUrl: URL.createObjectURL(file),
        mediaKind: file.type.startsWith("video") ? ("video" as const) : ("audio" as const),
      };
    });
  }

  function handleLink(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim()) return;

    setPhase("Downloading and transcribing… this can take a minute or two");
    run(async () => {
      const res = await fetch("/api/transcribe/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link, language }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.text) throw new Error(data.error ?? "Couldn't transcribe that link.");
      return data as TranscriptResult;
    });
  }

  const inputDisabled = disabled || busy;
  const iconButton =
    "flex size-9 shrink-0 items-center justify-center rounded-full transition " +
    "hover:bg-neutral-100 active:scale-90 disabled:opacity-40 dark:hover:bg-neutral-800";

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {/* One pill: upload on the left, link box in the middle, play on the right */}
      <form
        onSubmit={handleLink}
        className="flex h-12 w-full items-center gap-1 rounded-full border border-neutral-300 px-1.5 focus-within:border-neutral-500 dark:border-neutral-700"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,audio/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
          disabled={inputDisabled}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={inputDisabled}
          aria-label="Upload video or audio"
          title="Upload video or audio"
          className={iconButton}
        >
          <UploadIcon className="size-5" />
        </button>

        <input
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Paste a YouTube, TikTok, Facebook or Instagram link"
          disabled={inputDisabled}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-400 disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={inputDisabled || !link.trim()}
          aria-label="Transcribe this link"
          title="Transcribe this link"
          className={iconButton}
        >
          <PlayIcon className="size-5" />
        </button>
      </form>

      {phase && (
        <p className="flex items-center gap-2 text-sm text-neutral-500" aria-live="polite">
          <span className="size-3 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
          {phase}
        </p>
      )}
    </div>
  );
}
