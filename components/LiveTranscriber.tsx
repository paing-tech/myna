"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  GoogleGenAI,
  type LiveConnectConfig,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import LanguagePicker from "@/components/LanguagePicker";
import AppearancePicker from "@/components/AppearancePicker";
import TextSizePicker, { TEXT_SIZE_CLASS, useTextSize } from "@/components/TextSizePicker";
import MediaPlayer from "@/components/MediaPlayer";
import TranscriptBox from "@/components/TranscriptBox";
import {
  CheckIcon,
  CloseIcon,
  EjectIcon,
  CopyIcon,
  EraserIcon,
  ForwardIcon,
  MicIcon,
  PlayIcon,
  UndoIcon,
  UploadIcon,
} from "@/components/icons";
import { useMediaImport } from "@/components/useMediaImport";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/languages";
import { findLink } from "@/lib/links";
import { remapWords, type Played } from "@/lib/remap";
import type { TranscriptResult } from "@/lib/types";

type Status = "idle" | "connecting" | "recording" | "finishing";

// Gemini Live sessions are capped at 10 minutes. Stop 15 s early so the
// last sentence still has time to come back before Gemini cuts us off.
const MAX_SECONDS = 10 * 60 - 15;

// Circumference of the progress ring drawn around the record button
const RING = 2 * Math.PI * 46;

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

// Whether this browser can share never changes while the page is open
const subscribeNothing = () => () => {};
const hasShareSheet = () => typeof navigator.share === "function";

export default function LiveTranscriber() {
  const [status, setStatus] = useState<Status>("idle");
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);
  const [error, setError] = useState<string | null>(null);
  // One editable string (not an array) so the user can fix it freely
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  // Media to play back. `offset` is where its words start inside finalText,
  // and `baseText` is what the text looked like then: once the user edits,
  // the timings no longer line up, so highlighting stops.
  const [played, setPlayed] = useState<Played | null>(null);
  const [playTime, setPlayTime] = useState(0);
  const seekRef = useRef<(seconds: number) => void>(() => {});

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textRef = useRef(""); // latest text, readable from callbacks
  // collapsed → just the bar · default → the controls · expanded → plus settings
  const [sheet, setSheet] = useState<"collapsed" | "default" | "expanded">("default");
  const dragStartRef = useRef<number | null>(null);
  const textSize = useTextSize();
  const columnRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // Measured, so the transcript can stop exactly on the sheet's top edge
  const [sheetHeight, setSheetHeight] = useState(0);
  const [columnHeight, setColumnHeight] = useState(0);
  const historyRef = useRef<string[]>([]); // previous versions, for undo
  const lastPushRef = useRef(0);
  const [canUndo, setCanUndo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The sheet changes height with its three states, and the column changes
  // with rotation and the on-screen keyboard
  useEffect(() => {
    const column = columnRef.current;
    const sheetEl = sheetRef.current;
    if (!column || !sheetEl) return;
    const observer = new ResizeObserver(() => {
      setColumnHeight(column.clientHeight);
      setSheetHeight(sheetEl.offsetHeight);
    });
    observer.observe(column);
    observer.observe(sheetEl);
    return () => observer.disconnect();
  }, []);

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

  // Every change to the transcript goes through here, so the word timings
  // can follow it. "append" adds at the end (live speech), "edit" is the user.
  // A burst of typing becomes one undo step, rather than one per keystroke
  function pushHistory(previous: string, force: boolean) {
    const now = Date.now();
    if (!force && now - lastPushRef.current < 800) return;
    lastPushRef.current = now;
    historyRef.current.push(previous);
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(true);
  }

  function undo() {
    const previous = historyRef.current.pop();
    if (previous === undefined) return;
    setCanUndo(historyRef.current.length > 0);
    updateText(previous, "edit", "none");
  }

  function updateText(next: string, mode: "append" | "edit", history: "auto" | "force" | "none" = "auto") {
    const previous = textRef.current;
    if (history !== "none" && previous !== next) pushHistory(previous, history === "force");
    textRef.current = next;
    setFinalText(next);
    setPlayed((current) => {
      if (!current || current.baseText !== previous) return current;
      return mode === "append"
        ? { ...current, baseText: next } // words are all before the new text
        : remapWords(current, previous, next);
    });
  }

  function handleMessage(message: LiveServerMessage) {
    const content = message.serverContent;
    if (!content) return;

    if (content.interimInputTranscription?.text) {
      setInterimText(content.interimInputTranscription.text);
    }
    if (content.inputTranscription?.text) {
      const text = content.inputTranscription.text;
      const previous = textRef.current;
      updateText(previous ? `${previous} ${text}` : text, "append", "none");
      setInterimText("");
    }
  }

  async function start() {
    // Keep existing (possibly edited) text; a new recording is appended to it
    setError(null);
    setInterimText("");
    setElapsed(0);
    setStatus("connecting");
    setSheet((current) => (current === "collapsed" ? "default" : current)); // keep Stop reachable

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
  // The highlighted part if there is one, otherwise everything
  function chosenText(): string {
    const box = textareaRef.current;
    const selected = box ? finalText.slice(box.selectionStart, box.selectionEnd) : "";
    return selected || finalText;
  }

  async function copy() {
    await navigator.clipboard.writeText(chosenText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Opens the phone's / computer's own share sheet (Messenger, Telegram, Viber…)
  async function share() {
    try {
      await navigator.share({ text: chosenText() });
    } catch (err) {
      // Closing the share sheet without picking an app isn't an error
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error(err);
      setError("Couldn't open sharing. Use Copy instead.");
    }
  }

  // Not every browser has a share sheet (e.g. Firefox on desktop); hide the button there.
  // Read through useSyncExternalStore so the server and the first client render
  // agree (false), then it settles to the real answer — otherwise React reports
  // a hydration mismatch, because Node has a navigator without `share`.
  const canShare = useSyncExternalStore(subscribeNothing, hasShareSheet, () => false);

  function updateSelection() {
    const box = textareaRef.current;
    setHasSelection(!!box && box.selectionStart !== box.selectionEnd);
  }

  // Imported transcripts go after existing text, separated by a blank line,
  // and the media becomes playable with its words highlighted
  function handleImported(result: TranscriptResult) {
    if (played?.mediaUrl?.startsWith("blob:")) URL.revokeObjectURL(played.mediaUrl);
    // Media replaces the transcript rather than joining it, so the two never
    // mix. Undo brings the previous text back.
    pushHistory(finalText, true);
    textRef.current = result.text;
    setFinalText(result.text);
    setPlayTime(0);
    setPlayed(
      result.mediaUrl || result.youtubeId ? { ...result, offset: 0, baseText: result.text } : null,
    );
  }

  // Eject closes the player and keeps the words. The button goes back to the
  // microphone, and a new recording or import replaces the text.
  function ejectMedia() {
    if (played?.mediaUrl?.startsWith("blob:")) URL.revokeObjectURL(played.mediaUrl);
    setPlayed(null);
  }

  // Uploading and link transcription. The main button drives the link, so
  // this state has to live here rather than inside the input row.
  const media = useMediaImport({
    language,
    onResult: handleImported,
    onError: setError,
  });
  const importing = media.busy;

  // Which characters to highlight right now. Edits switch this off, because
  // the word positions would no longer match the text.
  const highlight = useMemo(() => {
    if (!played || finalText !== played.baseText) return null;
    let current = null as { start: number; end: number } | null;
    for (const word of played.words) {
      if (word.start > playTime) break;
      current = { start: played.offset + word.startIndex, end: played.offset + word.endIndex };
    }
    return current;
  }, [played, playTime, finalText]);

  // Double-clicking a word jumps playback to it
  function seekToCaret(caretIndex: number) {
    if (!played || finalText !== played.baseText) return;
    const index = caretIndex - played.offset;
    const word =
      played.words.find((w) => index >= w.startIndex && index <= w.endIndex) ??
      [...played.words].reverse().find((w) => w.startIndex <= index);
    if (word) seekRef.current(word.start);
  }

  // The handle: drag up to open, drag down to collapse, tap to toggle.
  // Collapsing is refused while recording, or Stop would be out of reach.
  function handlePointerDown(e: React.PointerEvent) {
    dragStartRef.current = e.clientY;
    // Without capture, a drag that leaves the handle delivers pointerup
    // somewhere else and the gesture is lost
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerUp(e: React.PointerEvent) {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (start === null) return;
    const dy = e.clientY - start;
    setSheet((current) => {
      // A short movement is a tap: hide the controls, or bring them back
      if (Math.abs(dy) < 24) {
        if (current === "collapsed") return "default";
        return status === "recording" ? current : "collapsed";
      }
      if (dy < 0) return current === "collapsed" ? "default" : "expanded"; // dragged up
      if (current === "expanded") return "default"; // dragged down
      return status === "recording" ? current : "collapsed";
    });
  }

  const busy = status === "connecting" || status === "finishing";

  // A link pasted into the transcript is an instruction, not text to keep:
  // the button runs it, and it leaves the transcript when it does.
  const pastedLink = useMemo(() => findLink(finalText), [finalText]);

  function runPastedLink() {
    if (!pastedLink) return;
    // Clear the box while it works; the transcript replaces it when it lands
    updateText("", "edit", "force");
    media.transcribeLink(pastedLink.url);
  }
  const hasText = finalText.trim().length > 0;

  const pillButton =
    "flex size-12 items-center justify-center rounded-full text-neutral-600 transition " +
    "hover:bg-neutral-200/70 active:scale-90 disabled:opacity-30 " +
    "dark:text-neutral-300 dark:hover:bg-neutral-800";

  // The round button is the microphone, unless there's a link to run or a
  // transcription in flight — then it runs or cancels that instead of sitting
  // there greyed out.
  const mainButton = importing
    ? { label: "Cancel", icon: <CloseIcon className="size-10" />, onClick: media.cancel, tone: "busy" as const }
    : played && status === "idle"
      ? { label: "Close this media", icon: <EjectIcon className="size-10" />, onClick: ejectMedia, tone: "idle" as const }
    : pastedLink && status === "idle"
      ? { label: "Transcribe this link", icon: <PlayIcon className="size-10" />, onClick: runPastedLink, tone: "idle" as const }
      : {
          label:
            status === "recording" ? "Stop recording" :
            status === "connecting" ? "Connecting" :
            status === "finishing" ? "Finishing" : "Start recording",
          icon: <MicIcon className="size-10" />,
          onClick: status === "recording" ? stop : start,
          tone: status === "recording" ? ("recording" as const) : ("idle" as const),
        };

  return (
    <div ref={columnRef} className="relative flex min-h-0 flex-1 flex-col">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      )}

      {/* Centred in the space between the title and the buttons; as it fills
          it grows out from there, until it meets the buttons and scrolls. */}
      {/* Centred, so a short transcript sits in view above the sheet while a
          long one grows down behind it */}
      {/* Bottom margin follows the sheet, so the box always stops on its edge */}
      <div className="mt-auto flex min-h-0 flex-col gap-1" style={{ marginBottom: sheetHeight }}>
        <TranscriptBox
          value={finalText}
          onChange={(next) => updateText(next, "edit")}
          onSelect={updateSelection}
          onWordClick={seekToCaret}
          readOnly={status !== "idle"}
          interim={interimText}
          highlight={highlight}
          placeholder={
            importing ? (
              media.phase ?? "Transcribing"
            ) : (
              "Tap to speak, upload media, or paste a link here"
            )
          }
          textareaRef={textareaRef}
          maxHeight={`${Math.max(columnHeight - sheetHeight, 80)}px`}
          textClass={TEXT_SIZE_CLASS[textSize]}
        >
          {played && (
            <MediaPlayer
              result={played}
              onTime={setPlayTime}
              onReady={(seek) => {
                seekRef.current = seek;
              }}
            />
          )}
        </TranscriptBox>

      </div>

      {/* Controls sit in a sheet anchored to the bottom of the screen */}
      <div
        ref={sheetRef}
        {...(sheet === "collapsed"
          ? { onPointerDown: handlePointerDown, onPointerUp: handlePointerUp }
          : {})}
        className={`absolute inset-x-0 bottom-0 -mx-4 flex flex-col items-center gap-0 rounded-t-[60px] transition-[padding] duration-300 ${
          sheet === "collapsed"
            ? "pb-[max(0.5rem,env(safe-area-inset-bottom))]"
            : "pb-[max(4rem,env(safe-area-inset-bottom))]"
        }  border-t border-neutral-200 bg-neutral-50/90 px-4 pt-2 shadow-[0_-10px_30px_rgba(0,0,0,0.07)] backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-900/80 dark:shadow-[0_-10px_30px_rgba(0,0,0,0.6)]`}
      >
        {/* Floats above the sheet, over the text, with a frosted background.
            Hidden entirely when none of its three buttons can do anything. */}
        <div
          className={`absolute -top-28 right-6 z-10 transition-opacity ${
            hasText || canUndo ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div className="flex items-center gap-1 rounded-full border border-neutral-200/60 bg-white/40 p-1.5 shadow-sm backdrop-blur-md dark:border-neutral-700/50 dark:bg-neutral-900/40">
            <button
              onClick={() => updateText("", "edit", "force")}
              disabled={!hasText || status !== "idle"}
              aria-label="Clear the transcript"
              title="Clear the transcript"
              className={pillButton}
            >
              <EraserIcon className="size-6" />
            </button>
            <button
              onClick={undo}
              disabled={!canUndo || status !== "idle"}
              aria-label="Undo"
              title="Undo"
              className={pillButton}
            >
              <UndoIcon className="size-6" />
            </button>
            <button
              onClick={copy}
              disabled={!hasText}
              aria-label={hasSelection ? "Copy selection" : "Copy all"}
              title={copied ? "Copied" : hasSelection ? "Copy selection" : "Copy all"}
              className={pillButton}
            >
              {copied ? <CheckIcon className="size-6" /> : <CopyIcon className="size-6" />}
            </button>
          </div>
        </div>

        {/* Grab handle: drag or tap to show and hide the controls */}
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          aria-expanded={sheet !== "collapsed"}
          aria-label={
            sheet === "collapsed"
              ? "Show controls"
              : sheet === "default"
                ? "Drag up for settings, down to hide"
                : "Hide settings"
          }
          className="-mt-2 flex w-full touch-none cursor-grab justify-center py-3 active:cursor-grabbing"
        >
          <span className="h-1.5 w-12 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        </button>

        {/* Settings grow upward, so the buttons below stay exactly where they are */}
        <div
          className={`grid w-full transition-all duration-300 ease-out ${
            sheet === "expanded" ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="mx-auto mb-10 flex w-full max-w-lg flex-col gap-4 pl-5">
              <div className="flex items-center justify-between gap-4 px-2.5 py-1">
                <span className="text-lg font-medium">Appearance</span>
                <AppearancePicker />
              </div>

              <div className="flex items-center justify-between gap-4 px-2.5 py-1">
                <span className="text-lg font-medium">Text size</span>
                <TextSizePicker />
              </div>

              {/* Faded divider between the settings and the controls below */}
              <div
                aria-hidden="true"
                className="mt-2 h-px w-full bg-gradient-to-r from-transparent via-neutral-300 to-transparent dark:via-neutral-700"
              />
            </div>
          </div>
        </div>

        {/* Collapsing animates the controls' height down to nothing */}
        <div
          className={`grid w-full transition-all duration-300 ease-out ${
            sheet === "collapsed" ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
          }`}
        >
          {/* Clipping is only needed while collapsing; otherwise it would cut
              off the language menu, which opens above the sheet */}
          <div
            className={`flex flex-col items-center gap-10 ${
              sheet === "collapsed" ? "overflow-hidden" : "overflow-visible"
            }`}
          >
        <LanguagePicker
          value={language}
          onChange={setLanguage}
          disabled={status !== "idle" || importing}
        />

        <div className="grid w-full grid-cols-3 items-center justify-items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(e) => {
              media.pickFile(e.target.files?.[0]);
              e.target.value = ""; // allow picking the same file again
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={status !== "idle" || importing || played !== null}
            aria-label="Upload video or audio"
            title="Upload video or audio"
            className="flex size-18 items-center justify-center rounded-full border border-neutral-300 transition hover:bg-neutral-100 active:scale-90 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <UploadIcon className="size-6" />
          </button>

          <div className="relative flex size-32 items-center justify-center">
            {/* Breathing glow behind the button; the button itself stays still */}
            {mainButton.tone === "recording" && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-1 animate-pulse rounded-full bg-red-500/90 blur-xl"
              />
            )}

            {/* Ring hugging the outside of the button, filling as the
                10-minute limit runs down */}
            {mainButton.tone === "recording" && (
              <svg
                aria-hidden="true"
                viewBox="0 0 100 100"
                className="pointer-events-none absolute inset-0 -rotate-90"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="46"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  className="text-red-500/25"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="46"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={RING}
                  strokeDashoffset={RING * (1 - Math.min(elapsed / MAX_SECONDS, 1))}
                  className="text-red-500 transition-[stroke-dashoffset] duration-500 ease-linear"
                />
              </svg>
            )}

            {status === "recording" && (
              <span className="absolute -bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-2 text-sm tabular-nums whitespace-nowrap text-neutral-500">
                <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
                {formatTime(elapsed)}
              </span>
            )}

            <button
              onClick={mainButton.onClick}
              disabled={busy}
              aria-label={mainButton.label}
              title={mainButton.label}
              className={`relative flex size-28 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-60 ${
                mainButton.tone === "recording"
                  ? "bg-red-600 text-white"
                  : mainButton.tone === "busy"
                    ? "border border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
                    : "bg-foreground text-background shadow-lg hover:opacity-90"
              }`}
            >
              {mainButton.icon}
            </button>
          </div>

          {canShare ? (
            <button
              type="button"
              onClick={share}
              disabled={!hasText || status !== "idle"}
              aria-label={hasSelection ? "Share selection" : "Share transcript"}
              title={hasSelection ? "Share selection" : "Share transcript"}
              className="flex size-18 items-center justify-center rounded-full border border-neutral-300 transition hover:bg-neutral-100 active:scale-90 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              <ForwardIcon className="size-6" />
            </button>
          ) : (
            // No share sheet in this browser: keep the mic centred anyway
            <span aria-hidden="true" className="size-18" />
          )}
        </div>

          </div>
        </div>
      </div>
    </div>
  );
}
