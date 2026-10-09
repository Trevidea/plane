"use client";

import { useId } from "react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Button } from "@plane/ui";
import { isCoachingClipHls, resolveCoachingStreamLink } from "./coaching-card-clips-model";

export const CoachingCardStreamLink = ({ source }: { source: string }) => {
  const inputId = useId();
  if (!source) return null;
  const streamLink = resolveCoachingStreamLink(source);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(streamLink, window.location.origin).href);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Stream link copied" });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Unable to copy stream link" });
    }
  };
  return (
    <div className="min-w-0 space-y-2" role="group" aria-label="Stream link">
      <label htmlFor={inputId} className="block text-sm font-semibold text-custom-text-100">
        Stream link · {isCoachingClipHls(streamLink) ? "M3U8" : "Video"}
      </label>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        <input
          id={inputId}
          type="text"
          readOnly
          value={streamLink}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-custom-border-200 bg-custom-background-90 px-3 py-2 font-mono text-sm font-normal text-custom-text-100 focus:outline-none focus:ring-2 focus:ring-custom-primary-100"
        />
        <Button variant="link-primary" size="sm" type="button" onClick={() => void copyLink()}>
          Copy
        </Button>
      </div>
      <p className="text-xs leading-5 text-custom-text-200">
        Playback link for the selected clip. The saved clip times control which part of the video plays.
      </p>
    </div>
  );
};
