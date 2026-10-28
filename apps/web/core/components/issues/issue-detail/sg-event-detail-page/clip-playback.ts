import type { SgTagRow } from "./types";

export type ClipQueueEntry = { row: SgTagRow; startSeconds: number; durationSeconds: number };

const parseClock = (value: string) => {
  const parts = value.trim().split(":").map(Number);
  return !value.trim() || parts.some((part) => !Number.isFinite(part) || part < 0)
    ? NaN
    : parts.reduce((seconds, part) => seconds * 60 + part, 0);
};

const getDuration = (row: SgTagRow) => {
  if (
    typeof row.clipDurationSeconds === "number" &&
    Number.isFinite(row.clipDurationSeconds) &&
    row.clipDurationSeconds > 0
  )
    return row.clipDurationSeconds;
  if (row.clipStartSeconds !== null && row.clipEndSeconds !== null) {
    const duration = row.clipEndSeconds - row.clipStartSeconds;
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  const [start, end] = row.timecode.split(/\s*[-\u2013\u2014]\s*/);
  const duration = end === undefined ? NaN : parseClock(end) - parseClock(start);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
};

export const buildClipQueue = (rows: readonly SgTagRow[]): ClipQueueEntry[] => {
  const seen = new Set<string>();
  let startSeconds = 0;
  return rows.flatMap((row) => {
    if (seen.has(row.id)) return [];
    seen.add(row.id);
    const durationSeconds = getDuration(row);
    const entry = { row, startSeconds, durationSeconds };
    startSeconds += durationSeconds;
    return [entry];
  });
};

export const getAdjacentClipIndex = (index: number, direction: -1 | 1, count: number) =>
  count > 0 ? (index + direction + count) % count : null;

export const getClipQueuePosition = (queue: readonly ClipQueueEntry[], seconds: number) => {
  if (!queue.length) return null;
  const last = queue[queue.length - 1];
  const time = Math.min(last.startSeconds + last.durationSeconds, Math.max(0, Number.isFinite(seconds) ? seconds : 0));
  const index = queue.findIndex((entry) => time < entry.startSeconds + entry.durationSeconds);
  const resolvedIndex = index < 0 ? queue.length - 1 : index;
  return { index: resolvedIndex, offsetSeconds: Math.max(0, time - queue[resolvedIndex].startSeconds) };
};

export type ClipQueuePlayback = {
  requestId: number;
  onReady: () => void;
  mediaStartSeconds?: number;
  clipDurationSeconds: number;
  currentSeconds: number;
  durationSeconds: number;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onEnded: (loop: boolean) => void;
};
