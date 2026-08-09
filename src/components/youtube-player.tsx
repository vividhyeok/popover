"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setPlaybackRate: (rate: number) => void;
  loadVideoById: (videoId: string) => void;
  destroy: () => void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: (event: { target: YTPlayer }) => void;
        onStateChange: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
  }
}

export type YouTubePlayerHandle = {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (seconds: number) => void;
  setRate: (rate: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
};

type Props = {
  videoId: string;
  initialTime?: number;
  onTime: (current: number, duration: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onReadyChange: (ready: boolean) => void;
};

let loader: Promise<YTNamespace> | null = null;

function loadYouTubeApi() {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loader) return loader;

  loader = new Promise<YTNamespace>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("YouTube API failed to load"));
      document.head.appendChild(script);
    }

    const started = Date.now();
    const timer = window.setInterval(() => {
      if (window.YT?.Player) {
        window.clearInterval(timer);
        resolve(window.YT);
      } else if (Date.now() - started > 15000) {
        window.clearInterval(timer);
        reject(new Error("YouTube API timed out"));
      }
    }, 80);
  });

  return loader;
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayer(
  { videoId, initialTime = 0, onTime, onPlayingChange, onReadyChange },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const initialTimeRef = useRef(initialTime);
  const [error, setError] = useState("");

  useImperativeHandle(ref, () => ({
    play: () => playerRef.current?.playVideo(),
    pause: () => playerRef.current?.pauseVideo(),
    toggle: () => {
      const player = playerRef.current;
      if (!player) return;
      if (player.getPlayerState() === 1) player.pauseVideo();
      else player.playVideo();
    },
    seekTo: (seconds) => playerRef.current?.seekTo(Math.max(0, seconds), true),
    setRate: (rate) => playerRef.current?.setPlaybackRate(rate),
    getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
    getDuration: () => playerRef.current?.getDuration() ?? 0,
  }));

  useEffect(() => {
    let cancelled = false;
    onReadyChange(false);
    setError("");

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !mountRef.current) return;
        playerRef.current = new YT.Player(mountRef.current, {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 1,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (initialTimeRef.current > 0.5) event.target.seekTo(initialTimeRef.current, true);
              onReadyChange(true);
            },
            onStateChange: (event) => onPlayingChange(event.data === 1),
          },
        });
      })
      .catch(() => setError("YouTube 플레이어를 불러오지 못했습니다."));

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId, onPlayingChange, onReadyChange]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      onTime(player.getCurrentTime() || 0, player.getDuration() || 0);
    }, 60);
    return () => window.clearInterval(timer);
  }, [onTime]);

  return (
    <div className="youtube-frame-wrap">
      <div ref={mountRef} className="youtube-frame" />
      {error ? <div className="player-error">{error}</div> : null}
    </div>
  );
});
