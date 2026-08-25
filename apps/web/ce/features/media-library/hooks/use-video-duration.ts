"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { TMediaItem } from "../types/media-library.types";
import { formatMediaDurationLabel } from "../utils/media-duration";

export const useVideoDuration = (item: TMediaItem) => {
  const storedDuration = useMemo(() => formatMediaDurationLabel(item.duration), [item.duration]);
  const [measuredDuration, setMeasuredDuration] = useState("");

  useEffect(() => {
    setMeasuredDuration("");
  }, [item.id, item.videoSrc, storedDuration]);

  const setVideoDuration = useCallback(
    (duration: number) => {
      if (storedDuration) return;
      const nextDuration = formatMediaDurationLabel(duration);
      if (nextDuration) setMeasuredDuration(nextDuration);
    },
    [storedDuration]
  );

  return {
    durationLabel: storedDuration || measuredDuration,
    setVideoDuration,
  };
};
