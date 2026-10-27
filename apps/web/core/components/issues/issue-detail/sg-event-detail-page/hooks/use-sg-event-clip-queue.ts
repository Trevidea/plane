import { useCallback, useRef, useState } from "react";
import { buildClipQueue, getAdjacentClipIndex, getClipQueuePosition } from "../clip-playback";
import type { ClipQueueEntry, ClipQueuePlayback } from "../clip-playback";
import type { SgTagRow } from "../types";

type QueueState = { requestId: number; clips: ClipQueueEntry[]; index: number; seconds: number };

export const useSgEventClipQueue = (
  loadRow: (row: SgTagRow, offsetSeconds: number) => Promise<void>,
  seek: (seconds: number) => void
) => {
  const [state, setState] = useState<QueueState | null>(null);
  const stateRef = useRef<QueueState | null>(null);
  const loadingRef = useRef(false);
  const requestRef = useRef(0);
  const loadedRequestRef = useRef<number | null>(null);
  const update = useCallback((next: QueueState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const clear = useCallback(() => {
    requestRef.current += 1;
    loadingRef.current = false;
    update(null);
  }, [update]);
  const playAt = useCallback(
    async (clips: ClipQueueEntry[], index: number, seconds = 0) => {
      const request = ++requestRef.current;
      loadingRef.current = true;
      update({ requestId: request, clips, index, seconds });
      try {
        await loadRow(clips[index].row, seconds);
        if (request === requestRef.current) loadedRequestRef.current = request;
      } catch (error) {
        if (request === requestRef.current) loadingRef.current = false;
        throw error;
      }
    },
    [loadRow, update]
  );
  const playRows = useCallback(
    async (rows: SgTagRow[]) => {
      const clips = buildClipQueue(rows);
      if (clips.length) await playAt(clips, 0);
      else clear();
    },
    [clear, playAt]
  );
  const move = useCallback(
    (direction: -1 | 1) => {
      const current = stateRef.current;
      if (!current) return;
      const index = getAdjacentClipIndex(current.index, direction, current.clips.length);
      if (index !== null) void playAt(current.clips, index);
    },
    [playAt]
  );
  const seekQueue = useCallback(
    (seconds: number) => {
      const current = stateRef.current;
      if (!current) return;
      const position = getClipQueuePosition(current.clips, seconds);
      if (!position) return;
      if (position.index !== current.index || loadingRef.current) {
        void playAt(current.clips, position.index, position.offsetSeconds);
      } else {
        update({ ...current, seconds: position.offsetSeconds });
        seek(position.offsetSeconds);
      }
    },
    [playAt, seek, update]
  );
  const updateTime = useCallback(
    (seconds: number, mediaDuration: number | null) => {
      const current = stateRef.current;
      if (!current || loadingRef.current) return;
      let clips = current.clips;
      const clip = clips[current.index];
      if (!clip.durationSeconds && mediaDuration && Number.isFinite(mediaDuration)) {
        clips = buildClipQueue(
          clips.map((entry, index) =>
            index === current.index ? { ...entry.row, clipDurationSeconds: mediaDuration } : entry.row
          )
        );
      }
      const duration = clips[current.index].durationSeconds;
      update({
        ...current,
        clips,
        seconds: Math.max(0, Math.min(duration || Infinity, Number.isFinite(seconds) ? seconds : 0)),
      });
    },
    [update]
  );
  const onEnded = useCallback(
    (loop: boolean) => {
      const current = stateRef.current;
      if (!current || loadingRef.current) return;
      if (current.index < current.clips.length - 1 || loop) move(1);
    },
    [move]
  );
  const last = state?.clips[state.clips.length - 1];
  const playback: ClipQueuePlayback | null =
    state && last
      ? {
          requestId: state.requestId,
          onReady: () => {
            if (loadedRequestRef.current === state.requestId && stateRef.current?.requestId === state.requestId)
              loadingRef.current = false;
          },
          clipDurationSeconds: state.clips[state.index].durationSeconds,
          currentSeconds: state.clips[state.index].startSeconds + state.seconds,
          durationSeconds: last.startSeconds + last.durationSeconds,
          onPrevious: () => move(-1),
          onNext: () => move(1),
          onSeek: seekQueue,
          onEnded,
        }
      : null;
  return { clear, playRows, playback, updateTime };
};
