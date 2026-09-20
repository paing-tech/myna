"use client";

import { useCallback, useRef } from "react";
import YouTubeEmbed from "@/components/YouTubeEmbed";
import type { TranscriptResult } from "@/lib/types";

type Props = {
  result: TranscriptResult;
  onTime: (seconds: number) => void;
  onReady: (seek: (seconds: number) => void) => void;
  onClose: () => void;
};

// Just the player. The transcript and its highlight live in TranscriptBox.
export default function MediaPlayer({ result, onTime, onReady, onClose }: Props) {
  const { mediaUrl, mediaKind, youtubeId } = result;
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const isYouTube = mediaKind === "youtube" && youtubeId;

  // A <video>/<audio> element seeks itself; the YouTube embed gives us a seek function
  const registerLocal = useCallback(
    (element: HTMLVideoElement | HTMLAudioElement | null) => {
      mediaRef.current = element;
      if (!element) return;
      onReady((seconds) => {
        element.currentTime = seconds;
        element.play().catch(() => {}); // a blocked autoplay isn't worth an error
      });
    },
    [onReady],
  );

  return (
    <div className="flex flex-col gap-2">
      {isYouTube ? (
        <YouTubeEmbed videoId={youtubeId} onTime={onTime} onReady={onReady} />
      ) : mediaKind === "video" ? (
        <video
          ref={registerLocal}
          src={mediaUrl}
          controls
          playsInline
          onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
          className="max-h-64 w-full rounded-xl bg-black"
        />
      ) : (
        <audio
          ref={registerLocal}
          src={mediaUrl}
          controls
          onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
          className="w-full"
        />
      )}

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>Double-click a word to jump there</span>
        <button
          onClick={onClose}
          className="rounded-full px-2 py-1 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Close player
        </button>
      </div>
    </div>
  );
}
