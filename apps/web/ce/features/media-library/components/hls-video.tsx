"use client";

import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import Hls from "hls.js";

import { observeVideoReadiness } from "@/helpers/workflow-diagnostics";
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
    const diagnostic = observeVideoReadiness(video, autoPlay);
    const playbackSrc = resolveHlsPlaybackSource(src, window.location.origin);

    // Prefer MediaSource playback: Chrome can advertise native HLS support
    // but reject the proxied playlist with MEDIA_ERR_SRC_NOT_SUPPORTED.
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          diagnostic.fail();
          onError?.();
        }
      });
      hls.loadSource(playbackSrc);
      hls.attachMedia(video);
      return () => {
        diagnostic.dispose();
        hls.destroy();
      };
    }

    video.src = playbackSrc;
    video.load();
    return () => {
      diagnostic.dispose();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, targetRef, onError, autoPlay]);

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
