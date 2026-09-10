"use client";
import { useEffect, useRef } from "react";
import type { TCustomPlaylistAnnotation } from "../types/annotation.types";
import { narrationAudio, narrationGain } from "../utils/voice-narration";

type VideoAnnotationAudioPlaybackProps = {
  annotation: TCustomPlaylistAnnotation;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  videoElement?: HTMLVideoElement | null;
  getCurrentTime?: () => number;
  onError?: (message: string) => void;
  onPlaybackChange?: (id: string, playing: boolean) => void;
};
export const VideoAnnotationAudioPlayback = ({
  annotation,
  currentTime,
  isPlaying,
  playbackRate,
  videoElement,
  getCurrentTime,
  onError,
  onPlaybackChange,
}: VideoAnnotationAudioPlaybackProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const latest = useRef({ currentTime, isPlaying, playbackRate, getCurrentTime, onError });
  latest.current = { currentTime, isPlaying, playbackRate, getCurrentTime, onError };
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const config = narrationAudio(annotation);
    let raf = 0,
      failed = false,
      playPending = false;
    const playing = () => onPlaybackChange?.(annotation.id, true);
    const stopped = () => onPlaybackChange?.(annotation.id, false);
    const fail = () => {
      if (failed) return;
      failed = true;
      audio.pause();
      stopped();
      latest.current.onError?.(
        `Unable to play ${annotation.title || "narration"}. Check the connection or replace its audio.`
      );
    };
    const sync = () => {
      raf = requestAnimationFrame(sync);
      const p = latest.current;
      const time = p.getCurrentTime?.() ?? p.currentTime;
      const active = time >= annotation.startTime && time < annotation.endTime;
      if (!active || !p.isPlaying || videoElement?.paused || failed) {
        audio.pause();
        return;
      }
      const target = config.trimStart + time - annotation.startTime;
      if (target >= config.sourceDuration - config.trimEnd) {
        audio.pause();
        return;
      }
      if (audio.readyState > 0 && Math.abs(audio.currentTime - target) > 0.08) audio.currentTime = target;
      const rate = videoElement?.playbackRate ?? p.playbackRate;
      audio.playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
      audio.volume = narrationGain(annotation, time);
      if (audio.paused && !playPending) {
        playPending = true;
        void audio
          .play()
          .catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") return;
            fail();
          })
          .finally(() => {
            playPending = false;
          });
      }
    };
    audio.addEventListener("error", fail);
    audio.addEventListener("playing", playing);
    audio.addEventListener("pause", stopped);
    audio.addEventListener("waiting", stopped);
    audio.addEventListener("ended", stopped);
    raf = requestAnimationFrame(sync);
    return () => {
      cancelAnimationFrame(raf);
      failed = true;
      audio.pause();
      audio.removeEventListener("error", fail);
      audio.removeEventListener("playing", playing);
      audio.removeEventListener("pause", stopped);
      audio.removeEventListener("waiting", stopped);
      audio.removeEventListener("ended", stopped);
      stopped();
    };
  }, [annotation, videoElement, onPlaybackChange]);
  return <audio ref={audioRef} src={annotation.content} preload="metadata" className="hidden" />;
};
