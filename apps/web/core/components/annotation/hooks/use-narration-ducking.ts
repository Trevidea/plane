import { useEffect, useRef } from "react";
import type { TCustomPlaylistAnnotation } from "../types/annotation.types";
import { NarrationDucking } from "../utils/narration-ducking";

export const useNarrationDucking = (
  video: HTMLVideoElement | null | undefined,
  clips: TCustomPlaylistAnnotation[],
  getTime: () => number,
  recordingFactor: number | null,
  isClipPlaying: (id: string) => boolean
) => {
  const latest = useRef({ clips, getTime, recordingFactor, isClipPlaying });
  latest.current = { clips, getTime, recordingFactor, isClipPlaying };
  useEffect(() => {
    if (!video) return;
    const ducking = new NarrationDucking(video);
    let raf = 0,
      previous = performance.now();
    const tick = (now: number) => {
      const { clips, getTime, recordingFactor, isClipPlaying } = latest.current;
      const time = getTime();
      const factors = !video.paused
        ? clips
            .filter(
              (clip) =>
                clip.startTime <= time &&
                time < clip.endTime &&
                clip.audio?.ducking != null &&
                clip.audio.volume > 0 &&
                isClipPlaying(clip.id)
            )
            .map((clip) => clip.audio?.ducking ?? 1)
        : [];
      const factor = recordingFactor ?? Math.min(1, ...factors);
      ducking.tick(factor, (now - previous) / 1000);
      previous = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ducking.restore();
    };
  }, [video]);
};
