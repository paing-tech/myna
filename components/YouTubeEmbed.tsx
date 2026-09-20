"use client";

import { useEffect, useRef } from "react";

// The slice of YouTube's iframe API we use
type YTPlayer = {
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  destroy: () => void;
};
type YTApi = {
  Player: new (el: HTMLElement, options: Record<string, unknown>) => YTPlayer;
};
declare global {
  interface Window {
    YT?: YTApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Load YouTube's script once per page, however many players ask for it
let apiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  apiPromise ??= new Promise<void>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(script);
  });
  return apiPromise;
}

type Props = {
  videoId: string;
  onTime: (seconds: number) => void;
  onReady: (seek: (seconds: number) => void) => void;
};

export default function YouTubeEmbed({ videoId, onTime, onReady }: Props) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  // Callbacks in refs: the effect must not re-run (and reload the video)
  // every time the parent re-renders
  const onTimeRef = useRef(onTime);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onTimeRef.current = onTime;
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    let player: YTPlayer | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    loadYouTubeApi().then(() => {
      if (cancelled || !holderRef.current || !window.YT) return;
      player = new window.YT.Player(holderRef.current, {
        videoId,
        playerVars: { playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            onReadyRef.current((seconds) => {
              player?.seekTo(seconds, true);
              player?.playVideo();
            });
            // The embed has no timeupdate event, so ask it 5×/second
            timer = setInterval(() => {
              const time = player?.getCurrentTime?.();
              if (typeof time === "number") onTimeRef.current(time);
            }, 200);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      player?.destroy();
    };
  }, [videoId]);

  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
      <div ref={holderRef} className="size-full" />
    </div>
  );
}
