"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HlsVideo } from "ce/features/media-library/components/hls-video";
import dynamic from "next/dynamic";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
  RotateCcw,
  RotateCw,
  PictureInPicture2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button, CustomSelect, Spinner, Tooltip } from "@plane/ui";
import type { TCustomPlaylistAnnotation } from "@/components/annotation/types/annotation.types";
import type { CoachingCardDetailClip } from "./coaching-card-clips-model";
import { getClipPlaybackRange, isCoachingClipHls } from "./coaching-card-clips-model";
import { formatCardDuration } from "./sg-event-detail-page/create-card-model";

const VideoAnnotationEditor = dynamic(
  () =>
    import("@/components/annotation/components/video-annotation-editor").then((module) => module.VideoAnnotationEditor),
  { ssr: false }
);
const keepAnnotations = async (annotations: TCustomPlaylistAnnotation[]) => annotations;

type Props = {
  clip: CoachingCardDetailClip;
  src: string;
  poster?: string;
  autoPlay?: boolean;
  onComplete?: () => void;
  annotations?: TCustomPlaylistAnnotation[];
  annotationTimeline?: "source" | "playlist";
  onPosition?: (seconds: number) => void;
  paused?: boolean;
  playRequest?: number;
  onSetStart?: () => void;
  onSetEnd?: () => void;
  showPrecisionControls?: boolean;
  markers?: Array<{ id: string; seconds: number; label: string }>;
};
const CONTROL_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded p-0 text-custom-text-100 hover:bg-custom-background-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100 disabled:opacity-40";

export const CoachingCardClipPlayer = ({
  clip,
  src,
  poster,
  autoPlay = false,
  onComplete,
  annotations = [],
  annotationTimeline = "source",
  onPosition,
  paused = false,
  playRequest = 0,
  onSetStart,
  onSetEnd,
  showPrecisionControls = true,
  markers = [],
}: Props) => {
  const positionCallback = useRef(onPosition);
  positionCallback.current = onPosition;
  const [buffering, setBuffering] = useState(true);
  const [canPip, setCanPip] = useState(false);
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
    setBuffering(true);
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
      try {
        rangeRef.current = getClipPlaybackRange(clip, video.duration);
      } catch {
        reportError();
        return;
      }
      setDuration(rangeRef.current.duration);
      video.currentTime = rangeRef.current.start;
      setCurrentTime(0);
      positionCallback.current?.(clip.startSeconds);
      setIsReady(true);
      setBuffering(false);
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
      positionCallback.current?.(
        clip.playbackMode === "clip"
          ? (clip.sourceStartSeconds ?? clip.startSeconds) + video.currentTime
          : rangeRef.current.start !== clip.startSeconds
            ? clip.startSeconds + video.currentTime - rangeRef.current.start
            : video.currentTime
      );
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
    const waiting = () => setBuffering(true);
    const ready = () => setBuffering(false);
    video.addEventListener("waiting", waiting);
    video.addEventListener("canplay", ready);
    video.addEventListener("playing", ready);
    setCanPip(Boolean(document.pictureInPictureEnabled && video.requestPictureInPicture));
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
      video.removeEventListener("waiting", waiting);
      video.removeEventListener("canplay", ready);
      video.removeEventListener("playing", ready);
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
  }, [clip, src, autoPlay, onComplete, retryCount, reportError, playRequest]);

  useEffect(() => {
    if (paused) videoRef.current?.pause();
  }, [paused]);
  const seek = (delta: number) => {
    const video = videoRef.current;
    if (!video || !isReady) return;
    video.currentTime = Math.max(
      rangeRef.current.start,
      Math.min(rangeRef.current.end ?? video.duration, video.currentTime + delta)
    );
  };
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
      void document.exitFullscreen().catch(() => {});
    } else {
      void containerRef.current?.requestFullscreen?.().catch(() => {});
    }
  };

  return (
    <div
      data-coaching-player
      ref={containerRef}
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-custom-border-300 bg-custom-background-90 [&:fullscreen]:h-full [&:fullscreen]:w-full"
      onKeyDown={(event) => {
        if (event.key === "Escape" && document.fullscreenElement === containerRef.current) event.stopPropagation();
      }}
    >
      <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-custom-background-90 [[data-coaching-player]:fullscreen_&]:min-h-0 [[data-coaching-player]:fullscreen_&]:flex-1">
        {isCoachingClipHls(src) ? (
          <HlsVideo
            key={retryCount}
            src={src}
            poster={poster}
            videoRef={videoRef}
            controls={false}
            onError={reportError}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <video
            key={retryCount}
            ref={videoRef}
            src={src}
            poster={poster}
            playsInline
            preload="metadata"
            onError={reportError}
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}
        {isReady && annotations.length > 0 && (
          <VideoAnnotationEditor
            key={clip.key}
            annotationKey={clip.key}
            annotations={annotations}
            canEdit={false}
            currentTime={currentTime + (annotationTimeline === "playlist" ? rangeRef.current.start : clip.startSeconds)}
            getCurrentTime={() =>
              (videoRef.current?.currentTime ?? rangeRef.current.start) -
              rangeRef.current.start +
              (annotationTimeline === "playlist" ? rangeRef.current.start : clip.startSeconds)
            }
            videoElement={videoRef.current}
            isPlaying={isPlaying}
            playbackRate={rate}
            onSave={keepAnnotations}
          />
        )}
        {!isPlaying && isReady && !buffering && !hasError && (
          <Button
            type="button"
            variant="neutral-primary"
            size="sm"
            aria-label="Play selected clip"
            onClick={togglePlay}
            className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-custom-primary-100 bg-custom-primary-100 text-white hover:bg-custom-primary-200"
          >
            <Play className="h-5 w-5" aria-hidden="true" />
          </Button>
        )}
        {buffering && !hasError && (
          <div
            role="status"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-custom-background-100/70 text-sm text-custom-text-100"
          >
            <Spinner width="24px" height="24px" />
            Loading video…
          </div>
        )}
        {hasError && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-custom-background-100/95 px-4 text-center text-sm text-custom-text-100"
          >
            <p>Unable to load this clip.</p>
            <p className="text-xs text-custom-text-200">The video stream may no longer be available.</p>
            <Button
              variant="neutral-primary"
              size="sm"
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
            </Button>
          </div>
        )}
      </div>
      <div className="shrink-0 space-y-1.5 border-t border-custom-border-300 px-3 py-2">
        <div className="relative">
          {markers
            .filter(
              (marker) =>
                marker.seconds >= rangeRef.current.start && marker.seconds <= (rangeRef.current.end ?? Infinity)
            )
            .map((marker) => (
              <Tooltip key={marker.id} tooltipContent={marker.label}>
                <span
                  aria-label={marker.label}
                  className="absolute -top-1 h-2 w-1 bg-custom-primary-100"
                  style={{ left: `${duration ? ((marker.seconds - rangeRef.current.start) / duration) * 100 : 0}%` }}
                />
              </Tooltip>
            ))}
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
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-custom-text-100">
          <Button
            variant="neutral-primary"
            size="sm"
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
          </Button>
          {[
            {
              label: "Replay clip",
              icon: RotateCcw,
              run: () => {
                if (videoRef.current) {
                  videoRef.current.currentTime = rangeRef.current.start;
                  void videoRef.current.play().catch(reportError);
                }
              },
            },
            { label: "Back 5 seconds", icon: RotateCcw, run: () => seek(-5) },
            ...(showPrecisionControls
              ? [
                  {
                    label: "Back 0.1 seconds",
                    icon: ChevronLeft,
                    run: () => {
                      videoRef.current?.pause();
                      seek(-0.1);
                    },
                  },
                  {
                    label: "Forward 0.1 seconds",
                    icon: ChevronRight,
                    run: () => {
                      videoRef.current?.pause();
                      seek(0.1);
                    },
                  },
                ]
              : []),
            { label: "Forward 5 seconds", icon: RotateCw, run: () => seek(5) },
          ].map(({ label, icon: Icon, run }) => (
            <Tooltip key={label} tooltipContent={label}>
              <Button
                variant="neutral-primary"
                size="sm"
                type="button"
                aria-label={label}
                onClick={run}
                disabled={!isReady || hasError}
                className={CONTROL_CLASS}
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
          ))}
          <span aria-label="Clip playback time" className="whitespace-nowrap tabular-nums">
            {formatCardDuration(currentTime)} / {duration > 0 ? formatCardDuration(duration) : "--:--"}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="neutral-primary"
              size="sm"
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
            </Button>
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
          <CustomSelect
            value={rate}
            label={`${rate}x`}
            disabled={!isReady || hasError}
            onChange={(value: number) => {
              if (videoRef.current) videoRef.current.playbackRate = value;
            }}
            buttonClassName="text-xs text-custom-text-100"
            optionsClassName="z-50"
          >
            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
              <CustomSelect.Option key={value} value={value}>
                {value}x
              </CustomSelect.Option>
            ))}
          </CustomSelect>
          {canPip && (
            <Tooltip tooltipContent="Picture in picture">
              <Button
                variant="neutral-primary"
                size="sm"
                type="button"
                aria-label="Picture in picture"
                className={CONTROL_CLASS}
                onClick={() => {
                  if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
                  else void videoRef.current?.requestPictureInPicture().catch(() => {});
                }}
                disabled={!isReady || hasError}
              >
                <PictureInPicture2 className="h-4 w-4" />
              </Button>
            </Tooltip>
          )}
          <Button
            variant="neutral-primary"
            size="sm"
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
          </Button>
        </div>
        {(onSetStart || onSetEnd) && (
          <div className="flex justify-end gap-2 border-t border-custom-border-300 pt-1.5">
            {onSetStart && (
              <Button
                variant="link-primary"
                size="sm"
                type="button"
                disabled={!isReady || hasError}
                onClick={onSetStart}
              >
                Set start
              </Button>
            )}
            {onSetEnd && (
              <Button variant="link-primary" size="sm" type="button" disabled={!isReady || hasError} onClick={onSetEnd}>
                Set end
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
