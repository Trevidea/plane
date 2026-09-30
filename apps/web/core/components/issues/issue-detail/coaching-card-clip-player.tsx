"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { HlsVideo } from "ce/features/media-library/components/hls-video";
import type { CoachingCardDetailClip } from "./coaching-card-clips-model";
import { getClipPlaybackRange } from "./coaching-card-clips-model";
import { formatCardDuration } from "./sg-event-detail-page/create-card-model";

type Props = {
  clip: CoachingCardDetailClip;
  src: string;
  poster?: string;
  autoPlay?: boolean;
  onComplete?: () => void;
};
const CONTROL_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded text-custom-text-200 hover:bg-custom-background-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100 disabled:opacity-40";

export const CoachingCardClipPlayer = ({ clip, src, poster, autoPlay = false, onComplete }: Props) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef(getClipPlaybackRange(clip, 0));
  const playbackSettingsRef = useRef({ volume: 1, muted: false, rate: 1 });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(rangeRef.current.duration);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const reportError = useCallback(() => {
    videoRef.current?.pause();
    setIsPlaying(false);
    setHasError(true);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let shouldLoop = !video.paused;
    let completed = false;
    let disposed = false;
    setIsReady(false);
    setIsPlaying(false);
    setHasError(false);
    setCurrentTime(0);
    setDuration(getClipPlaybackRange(clip, 0).duration);
    const resumePlayback = () => {
      void video.play().catch((error) => {
        if (!disposed && error?.name !== "AbortError" && error?.name !== "NotAllowedError") reportError();
      });
    };
    const initialize = () => {
      rangeRef.current = getClipPlaybackRange(clip, video.duration);
      setDuration(rangeRef.current.duration);
      video.currentTime = rangeRef.current.start;
      setCurrentTime(0);
      setIsReady(true);
      const settings = playbackSettingsRef.current;
      video.volume = settings.volume;
      video.muted = settings.muted;
      video.playbackRate = settings.rate;
      if (autoPlay) resumePlayback();
    };
    const completeClip = () => {
      if (completed) return;
      if (onComplete) {
        completed = true;
        video.pause();
        onComplete();
      } else {
        video.currentTime = rangeRef.current.start;
        setCurrentTime(0);
        if (video.paused) resumePlayback();
      }
    };
    const updateTime = () => {
      const { start, end } = rangeRef.current;
      if (video.currentTime < start) video.currentTime = start;
      if (end !== null && video.currentTime >= end) {
        if (!video.paused) completeClip();
        else if (!video.ended && video.currentTime > end) video.currentTime = end;
      }
      setCurrentTime(Math.max(0, video.currentTime - start));
    };
    const updatePlaying = () => {
      // Reaching the media end pauses the video before the ended event fires.
      if (!video.ended) shouldLoop = !video.paused;
      setIsPlaying(!video.paused && !video.ended);
    };
    const loopAtMediaEnd = () => {
      if (!shouldLoop) return;
      completeClip();
    };
    const updateVolume = () => {
      playbackSettingsRef.current.volume = video.volume;
      playbackSettingsRef.current.muted = video.muted;
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const updateRate = () => {
      playbackSettingsRef.current.rate = video.playbackRate;
      setRate(video.playbackRate);
    };
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    video.addEventListener("loadedmetadata", initialize);
    video.addEventListener("timeupdate", updateTime);
    video.addEventListener("seeking", updateTime);
    video.addEventListener("play", updatePlaying);
    video.addEventListener("pause", updatePlaying);
    video.addEventListener("ended", loopAtMediaEnd);
    video.addEventListener("volumechange", updateVolume);
    video.addEventListener("ratechange", updateRate);
    document.addEventListener("fullscreenchange", updateFullscreen);
    setCanFullscreen(Boolean(containerRef.current?.requestFullscreen));
    if (video.readyState >= 1) initialize();
    return () => {
      disposed = true;
      shouldLoop = false;
      video.pause();
      video.removeEventListener("loadedmetadata", initialize);
      video.removeEventListener("timeupdate", updateTime);
      video.removeEventListener("seeking", updateTime);
      video.removeEventListener("play", updatePlaying);
      video.removeEventListener("pause", updatePlaying);
      video.removeEventListener("ended", loopAtMediaEnd);
      video.removeEventListener("volumechange", updateVolume);
      video.removeEventListener("ratechange", updateRate);
      document.removeEventListener("fullscreenchange", updateFullscreen);
    };
  }, [clip, src, autoPlay, onComplete, retryCount, reportError]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    const { start, end } = rangeRef.current;
    if (video.currentTime < start || (end !== null && video.currentTime >= end)) video.currentTime = start;
    void video.play().catch(reportError);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement === containerRef.current) {
      void document.exitFullscreen().catch(() => { });
    } else {
      void containerRef.current?.requestFullscreen?.().catch(() => { });
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-custom-border-200 bg-custom-background-90 [&:fullscreen]:h-full [&:fullscreen]:w-full"
      onKeyDown={(event) => {
        if (event.key === "Escape" && document.fullscreenElement === containerRef.current) event.stopPropagation();
      }}
    >
      <div className="relative aspect-video min-h-0 flex-1 bg-black">
        {/\.m3u8(?:[?#]|$)/i.test(src) ? (
          <HlsVideo
            key={`${clip.key}:${src}:${retryCount}`}
            src={src}
            poster={poster}
            videoRef={videoRef}
            controls={false}
            onError={reportError}
            className="h-full w-full object-contain"
          />
        ) : (
          <video
            key={`${clip.key}:${src}:${retryCount}`}
            ref={videoRef}
            src={src}
            poster={poster}
            playsInline
            preload="metadata"
            onError={reportError}
            className="h-full w-full object-contain"
          />
        )}
        {hasError && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-custom-background-100/95 px-4 text-center text-sm text-custom-text-200"
          >
            <p>Unable to load this clip.</p>
            <button
              type="button"
              onClick={() => {
                setHasError(false);
                setIsReady(false);
                setCurrentTime(0);
                setIsPlaying(false);
                setVolume(1);
                setMuted(false);
                setRate(1);
                playbackSettingsRef.current = { volume: 1, muted: false, rate: 1 };
                setRetryCount((current) => current + 1);
              }}
              className="rounded border border-custom-border-300 px-3 py-1.5 text-xs text-custom-primary-100 hover:bg-custom-background-80"
            >
              Try again
            </button>
          </div>
        )}
      </div>
      <div className="shrink-0 space-y-1.5 border-t border-custom-border-200 px-3 py-2">
        <input
          type="range"
          aria-label="Seek clip"
          min={0}
          max={duration || 0}
          step={0.05}
          value={Math.min(currentTime, duration)}
          disabled={!isReady || hasError || duration <= 0}
          onChange={(event) => {
            const time = Number(event.target.value);
            setCurrentTime(time);
            if (videoRef.current) videoRef.current.currentTime = rangeRef.current.start + time;
          }}
          className="block h-1.5 w-full cursor-pointer accent-custom-primary-100 disabled:cursor-default"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-custom-text-200">
          <button
            type="button"
            aria-label={isPlaying ? "Pause clip" : "Play clip"}
            onClick={togglePlay}
            disabled={!isReady || hasError}
            className={CONTROL_CLASS}
          >
            {isPlaying ? (
              <Pause aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Play aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
          <span aria-label="Clip playback time" className="whitespace-nowrap tabular-nums">
            {formatCardDuration(currentTime)} / {duration > 0 ? formatCardDuration(duration) : "--:--"}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-label={muted || volume === 0 ? "Unmute clip" : "Mute clip"}
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                if (video.muted || video.volume === 0) {
                  video.muted = false;
                  if (video.volume === 0) video.volume = 1;
                } else {
                  video.muted = true;
                }
              }}
              className={CONTROL_CLASS}
            >
              {muted || volume === 0 ? (
                <VolumeX aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Volume2 aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
            <input
              type="range"
              aria-label="Clip volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(event) => {
                const video = videoRef.current;
                if (video) {
                  const nextVolume = Number(event.target.value);
                  setVolume(nextVolume);
                  setMuted(false);
                  video.volume = nextVolume;
                  video.muted = false;
                }
              }}
              className="h-1.5 w-12 accent-custom-primary-100 sm:w-16"
            />
          </div>
          <select
            aria-label="Playback speed"
            value={rate}
            onChange={(event) => {
              const nextRate = Number(event.target.value);
              setRate(nextRate);
              if (videoRef.current) videoRef.current.playbackRate = nextRate;
            }}
            className="rounded border border-custom-border-300 bg-custom-background-100 px-1 py-1 text-xs text-custom-text-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={isFullscreen ? "Exit clip fullscreen" : "Enter clip fullscreen"}
            onClick={toggleFullscreen}
            disabled={!canFullscreen}
            className={CONTROL_CLASS}
          >
            {isFullscreen ? (
              <Minimize aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Maximize aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
