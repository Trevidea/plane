export type TCustomPlaylistClockState = {
  initialized: boolean;
  mediaSeconds: number;
  timelineSeconds: number;
  wallTimeMs: number;
};

export type TCustomPlaylistSourceRange = readonly [startSeconds: number, endSeconds: number];

type TUpdateCustomPlaylistClockOptions = {
  durationSeconds?: number | null;
  hasEnded?: boolean;
  isPlaying: boolean;
  mediaStartSeconds?: number | null;
  mediaSeconds: number;
  playbackRate: number;
  state: TCustomPlaylistClockState;
  wallTimeMs: number;
};

export const createCustomPlaylistClockState = (): TCustomPlaylistClockState => ({
  initialized: false,
  mediaSeconds: 0,
  timelineSeconds: 0,
  wallTimeMs: 0,
});

const clampPlaylistTime = (seconds: number, durationSeconds?: number | null) => {
  const normalizedSeconds = Math.max(0, seconds);
  return typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.min(durationSeconds, normalizedSeconds)
    : normalizedSeconds;
};

const getPositiveFiniteSeconds = (seconds?: number | null) =>
  typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds : null;

export const mapCustomPlaylistTimelineTimeToMedia = (
  timelineSeconds: number,
  durationSeconds?: number | null,
  mediaDurationSeconds?: number | null,
  mediaStartSeconds?: number | null,
  sourceRanges?: readonly TCustomPlaylistSourceRange[] | null
) => {
  const normalizedTimelineSeconds = clampPlaylistTime(timelineSeconds, durationSeconds);
  const playlistDurationSeconds = getPositiveFiniteSeconds(durationSeconds);
  const sourceDurationSeconds = getPositiveFiniteSeconds(mediaDurationSeconds);
  const sourceStartSeconds = getPositiveFiniteSeconds(mediaStartSeconds) ?? 0;

  const normalizedSourceRanges = (sourceRanges ?? []).filter(
    ([startSeconds, endSeconds]) =>
      Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && startSeconds >= 0 && endSeconds > startSeconds
  );
  if (normalizedSourceRanges.length > 0) {
    const firstSourceSeconds = normalizedSourceRanges[0][0];
    const lastSourceSeconds = normalizedSourceRanges[normalizedSourceRanges.length - 1][1];
    const sourceSpanSeconds = lastSourceSeconds - firstSourceSeconds;
    const sourceScale = sourceDurationSeconds && sourceSpanSeconds > 0 ? sourceDurationSeconds / sourceSpanSeconds : 1;
    let remainingTimelineSeconds = normalizedTimelineSeconds;

    for (const [rangeIndex, [rangeStartSeconds, rangeEndSeconds]] of normalizedSourceRanges.entries()) {
      const rangeDurationSeconds = rangeEndSeconds - rangeStartSeconds;
      const isLastRange = rangeIndex === normalizedSourceRanges.length - 1;
      if (remainingTimelineSeconds < rangeDurationSeconds || isLastRange) {
        const secondsWithinRange = Math.min(remainingTimelineSeconds, rangeDurationSeconds);
        return sourceStartSeconds + (rangeStartSeconds - firstSourceSeconds + secondsWithinRange) * sourceScale;
      }
      remainingTimelineSeconds -= rangeDurationSeconds;
    }

    return sourceStartSeconds + (lastSourceSeconds - firstSourceSeconds) * sourceScale;
  }

  if (!playlistDurationSeconds || !sourceDurationSeconds) {
    return sourceStartSeconds + normalizedTimelineSeconds;
  }

  return sourceStartSeconds + (normalizedTimelineSeconds / playlistDurationSeconds) * sourceDurationSeconds;
};

export const updateCustomPlaylistClock = ({
  durationSeconds,
  hasEnded = false,
  isPlaying,
  mediaStartSeconds,
  mediaSeconds,
  playbackRate,
  state,
  wallTimeMs,
}: TUpdateCustomPlaylistClockOptions) => {
  const normalizedMediaSeconds = Number.isFinite(mediaSeconds) ? Math.max(0, mediaSeconds) : 0;
  const sourceStartSeconds = getPositiveFiniteSeconds(mediaStartSeconds) ?? 0;
  const mediaOffsetSeconds = Math.max(0, normalizedMediaSeconds - sourceStartSeconds);
  const safePlaybackRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  const playlistDurationSeconds = getPositiveFiniteSeconds(durationSeconds);
  const hasRestarted = Boolean(
    state.initialized &&
      isPlaying &&
      playlistDurationSeconds &&
      state.timelineSeconds >= playlistDurationSeconds - 0.25 &&
      mediaOffsetSeconds <= 1 &&
      normalizedMediaSeconds < state.mediaSeconds - 0.25
  );
  let timelineSeconds = mediaOffsetSeconds;

  if (hasEnded && playlistDurationSeconds) {
    timelineSeconds = playlistDurationSeconds;
  } else if (!state.initialized) {
    // Generated tag playlists occasionally retain the source clip's media timestamp.
    // Treat a non-zero source timestamp as the beginning of the custom video.
    timelineSeconds = mediaOffsetSeconds <= 1 ? mediaOffsetSeconds : 0;
  } else if (hasRestarted) {
    timelineSeconds = mediaOffsetSeconds;
  } else {
    const wallDeltaSeconds = Math.max(0, (wallTimeMs - state.wallTimeMs) / 1000);
    const mediaDeltaSeconds = normalizedMediaSeconds - state.mediaSeconds;
    const maximumContinuousDelta = Math.max(1.5, wallDeltaSeconds * safePlaybackRate + 1);

    if (mediaDeltaSeconds >= -0.25 && mediaDeltaSeconds <= maximumContinuousDelta) {
      timelineSeconds = state.timelineSeconds + Math.max(0, mediaDeltaSeconds);
    } else if (isPlaying) {
      // Ignore source timestamp discontinuities and advance by actual played time.
      timelineSeconds = state.timelineSeconds + wallDeltaSeconds * safePlaybackRate;
    } else {
      timelineSeconds = state.timelineSeconds;
    }
  }

  timelineSeconds = clampPlaylistTime(timelineSeconds, durationSeconds);

  return {
    state: {
      initialized: true,
      mediaSeconds: normalizedMediaSeconds,
      timelineSeconds,
      wallTimeMs,
    } satisfies TCustomPlaylistClockState,
    timelineSeconds,
  };
};
