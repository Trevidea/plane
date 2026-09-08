"use client";

import { useEffect, useRef } from "react";
import type { TCustomPlaylistAnnotation } from "../types/annotation.types";

type VideoAnnotationAudioPlaybackProps = {
  annotation: TCustomPlaylistAnnotation;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
};

export const VideoAnnotationAudioPlayback = ({
  annotation,
  currentTime,
  isPlaying,
  playbackRate,
}: VideoAnnotationAudioPlaybackProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isActive = currentTime >= annotation.startTime && currentTime < annotation.endTime;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const targetTime = Math.max(0, currentTime - annotation.startTime);
    const safePlaybackRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    audio.playbackRate = safePlaybackRate;

    if (!isActive || !isPlaying) {
      audio.pause();
      if (!isActive && currentTime < annotation.startTime) audio.currentTime = 0;
      return;
    }

    if (Math.abs(audio.currentTime - targetTime) > 0.35) audio.currentTime = targetTime;
    void audio.play().catch(() => undefined);
  }, [annotation.startTime, currentTime, isActive, isPlaying, playbackRate]);

  return <audio ref={audioRef} src={annotation.content} preload="metadata" className="hidden" />;
};
