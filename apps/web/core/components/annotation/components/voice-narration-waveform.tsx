"use client";
import { memo, useEffect, useRef, useState } from "react";
import type { TCustomPlaylistAnnotation } from "../types/annotation.types";
import { narrationAudio, sampleNarrationPeaks } from "../utils/voice-narration";

const peakCache = new Map<string, Promise<number[]>>();
const loadPeaks = (url: string) => {
  let result = peakCache.get(url);
  if (!result) {
    result = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Audio unavailable");
      const context = new AudioContext();
      try {
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        return sampleNarrationPeaks(
          Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
        );
      } finally {
        await context.close();
      }
    })();
    peakCache.set(url, result);
    const oldest = peakCache.keys().next().value;
    if (peakCache.size > 24 && oldest) peakCache.delete(oldest);
  }
  return result;
};
export const VoiceNarrationWaveform = memo(function VoiceNarrationWaveform({
  clip,
}: {
  clip: TCustomPlaylistAnnotation;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audio = narrationAudio(clip);
  const [loaded, setLoaded] = useState<{ url: string; peaks: number[] } | null>(null);
  const peaks = clip.audio?.peaks ?? (loaded && loaded.url === clip.content ? loaded.peaks : undefined);
  useEffect(() => {
    if (clip.audio?.peaks || !clip.content) return;
    let active = true;
    const url = clip.content;
    void loadPeaks(url)
      .then((value) => {
        if (active) setLoaded({ url, peaks: value });
      })
      .catch(() => {
        if (active) setLoaded({ url, peaks: [] });
      });
    return () => {
      active = false;
    };
  }, [clip.audio?.peaks, clip.content]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !peaks) return;
    const draw = () => {
      const width = canvas.clientWidth;
      canvas.width = Math.round(width * devicePixelRatio);
      canvas.height = 24 * devicePixelRatio;
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      context.clearRect(0, 0, width, 24);
      context.fillStyle = getComputedStyle(canvas).color;
      const count = Math.max(1, Math.floor(width / 4));
      for (let i = 0; i < count; i++) {
        const from = Math.floor(
          ((audio.trimStart + (i / count) * (audio.sourceDuration - audio.trimStart - audio.trimEnd)) /
            audio.sourceDuration) *
            peaks.length
        );
        const to = Math.max(
          from + 1,
          Math.ceil(
            ((audio.trimStart + ((i + 1) / count) * (audio.sourceDuration - audio.trimStart - audio.trimEnd)) /
              audio.sourceDuration) *
              peaks.length
          )
        );
        let peak = 0;
        for (let j = from; j < to && j < peaks.length; j++) peak = Math.max(peak, peaks[j]);
        const height = Math.max(1, peak * 24);
        context.fillRect(i * 4, (24 - height) / 2, 2, height);
      }
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [audio.sourceDuration, audio.trimStart, audio.trimEnd, peaks]);
  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none h-6 w-full text-custom-primary-100 ${!peaks ? "animate-pulse bg-custom-primary-100/10 motion-reduce:animate-none" : ""}`}
      aria-label={peaks?.length ? "Narration waveform" : peaks ? "Waveform unavailable" : "Preparing waveform"}
      role="img"
    />
  );
});
