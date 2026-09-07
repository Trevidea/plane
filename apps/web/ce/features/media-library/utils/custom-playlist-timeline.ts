export type TCustomPlaylistClockState = {
  initialized: boolean;
  mediaSeconds: number;
  timelineSeconds: number;
  wallTimeMs: number;
};

type TUpdateCustomPlaylistClockOptions = {
  durationSeconds?: number | null;
  isPlaying: boolean;
  isSeeking: boolean;
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

export const updateCustomPlaylistClock = ({
  durationSeconds,
  isPlaying,
  isSeeking,
  mediaSeconds,
  playbackRate,
  state,
  wallTimeMs,
}: TUpdateCustomPlaylistClockOptions) => {
  const normalizedMediaSeconds = Number.isFinite(mediaSeconds) ? Math.max(0, mediaSeconds) : 0;
  const safePlaybackRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  let timelineSeconds = normalizedMediaSeconds;

  if (!state.initialized) {
    // Generated tag playlists occasionally retain the source clip's media timestamp.
    // Treat a non-zero source timestamp as the beginning of the custom video.
    timelineSeconds = normalizedMediaSeconds <= 1 ? normalizedMediaSeconds : 0;
  } else {
    const wallDeltaSeconds = Math.max(0, (wallTimeMs - state.wallTimeMs) / 1000);
    const mediaDeltaSeconds = normalizedMediaSeconds - state.mediaSeconds;
    const maximumContinuousDelta = Math.max(1.5, wallDeltaSeconds * safePlaybackRate + 1);

    if (isSeeking) {
      timelineSeconds = normalizedMediaSeconds;
    } else if (mediaDeltaSeconds >= -0.25 && mediaDeltaSeconds <= maximumContinuousDelta) {
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
