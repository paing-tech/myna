"use client";

import { useRef, useState } from "react";
import type { Language } from "@/lib/languages";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // keep in sync with lib/media.ts

type Props = {
  language: Language;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onText: (text: string) => void;
  onError: (message: string | null) => void;
};

// XHR instead of fetch: fetch can't report upload progress, and a big
// video on a phone connection needs a progress number.
function uploadFile(
  file: File,
  language: Language,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/transcribe/upload?language=${language}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: { text?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status < 300 && data.text) resolve(data.text);
      else reject(new Error(data.error ?? "Upload failed. Please try again."));
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(file);
  });
}

export default function MediaImport({ language, disabled, onBusyChange, onText, onError }: Props) {
  const [phase, setPhase] = useState<string | null>(null); // progress message; null = idle
  const [link, setLink] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const busy = phase !== null;

  async function run(job: () => Promise<string>) {
    onError(null);
    onBusyChange(true);
    try {
      onText(await job());
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
    run(() =>
      uploadFile(file, language, (percent) => {
        setPhase(percent < 100 ? `Uploading ${percent}%…` : "Transcribing… this can take a minute or two");
      }),
    );
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
      return data.text as string;
    });
  }

  const inputDisabled = disabled || busy;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Hidden real file input; the styled label opens it */}
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
          className="h-11 shrink-0 rounded-full border border-neutral-300 px-5 text-sm font-medium transition hover:bg-neutral-100 active:scale-95 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Upload video or audio
        </button>

        <form onSubmit={handleLink} className="flex flex-1 gap-2">
          <input
            type="url"
            inputMode="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a YouTube, TikTok, Facebook or Instagram link"
            disabled={inputDisabled}
            className="h-11 min-w-0 flex-1 rounded-full border border-neutral-300 bg-transparent px-4 text-base outline-none focus:border-neutral-500 disabled:opacity-50 dark:border-neutral-700"
          />
          <button
            type="submit"
            disabled={inputDisabled || !link.trim()}
            className="h-11 shrink-0 rounded-full bg-foreground px-5 text-sm font-medium text-background transition active:scale-95 disabled:opacity-50"
          >
            Go
          </button>
        </form>
      </div>

      {phase && (
        <p className="flex items-center gap-2 text-sm text-neutral-500" aria-live="polite">
          <span className="size-3 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
          {phase}
        </p>
      )}
    </div>
  );
}
