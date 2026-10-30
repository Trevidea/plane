"use client";

import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import Hls from "hls.js";

import { resolveHlsPlaybackSource } from "../utils/hls-playback";

type THlsVideoProps = {
  src: string;
  poster?: string;
  className?: string;
  autoPlay?: boolean;
  controls?: boolean;
  videoRef?: RefObject<HTMLVideoElement>;
  onError?: () => void;
};

export const HlsVideo = ({
  src,
  poster,
  className,
  autoPlay = false,
  controls = true,
  videoRef,
  onError,
}: THlsVideoProps) => {
  const fallbackRef = useRef<HTMLVideoElement | null>(null);
  const targetRef = videoRef ?? fallbackRef;

  useEffect(() => {
    const video = targetRef.current;
    if (!video || !src) return;
    const playbackSrc = resolveHlsPlaybackSource(src, window.location.origin);

    // Prefer MediaSource playback: Chrome can advertise native HLS support
    // but reject the proxied playlist with MEDIA_ERR_SRC_NOT_SUPPORTED.
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) onError?.();
      });
      hls.loadSource(playbackSrc);
      hls.attachMedia(video);
      return () => {
        hls.destroy();
      };
    }

    video.src = playbackSrc;
    video.load();
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, targetRef, onError]);

  return (
    <video
      ref={targetRef}
      poster={poster}
      autoPlay={autoPlay}
      controls={controls}
      playsInline
      preload="metadata"
      className={className}
      onError={onError}
    />
  );
};
