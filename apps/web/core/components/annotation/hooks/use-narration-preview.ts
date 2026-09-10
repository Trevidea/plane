import { useCallback, useEffect, useRef, useState } from "react";
import type { TCustomPlaylistAnnotation } from "../types/annotation.types";
import { narrationAudio, narrationGain } from "../utils/voice-narration";

export const useNarrationPreview = (onPause?: () => void) => {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef(0);
  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const player = playerRef.current;
    playerRef.current = null;
    if (player) {
      player.pause();
      player.removeAttribute("src");
      player.load();
    }
    setPreviewId(null);
  }, []);
  const play = useCallback(
    (clip: TCustomPlaylistAnnotation) => {
      const previous = playerRef.current?.dataset.clipId;
      stop();
      setError(null);
      if (previous === clip.id) return;
      onPause?.();
      const config = narrationAudio(clip);
      const audio = new Audio(clip.content);
      audio.dataset.clipId = clip.id;
      playerRef.current = audio;
      setPreviewId(clip.id);
      const fail = () => {
        if (playerRef.current !== audio) return;
        stop();
        setError("This narration could not be played. Check the connection or replace the recording.");
      };
      audio.addEventListener("error", fail, { once: true });
      audio.addEventListener(
        "ended",
        () => {
          if (playerRef.current === audio) stop();
        },
        { once: true }
      );
      audio.addEventListener(
        "loadedmetadata",
        () => {
          if (playerRef.current !== audio) return;
          audio.currentTime = config.trimStart;
          const update = () => {
            if (playerRef.current !== audio) return;
            if (audio.currentTime >= config.sourceDuration - config.trimEnd) {
              stop();
              return;
            }
            audio.volume = narrationGain(clip, clip.startTime + audio.currentTime - config.trimStart);
            rafRef.current = requestAnimationFrame(update);
          };
          update();
          void audio.play().catch(fail);
        },
        { once: true }
      );
      audio.load();
    },
    [onPause, stop]
  );
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      playerRef.current?.pause();
      playerRef.current?.removeAttribute("src");
    },
    []
  );
  return { previewId, error, play, stop };
};
