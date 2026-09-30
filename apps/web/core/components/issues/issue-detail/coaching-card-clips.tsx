"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus, Video } from "lucide-react";
import type { TIssue } from "@plane/types";
import { cn, renderFormattedDate } from "@plane/utils";
import { CoachingCardClipPlayer } from "./coaching-card-clip-player";
import { buildCoachingCardClips, resolveCoachingClipSource } from "./coaching-card-clips-model";
import { formatCardDuration } from "./sg-event-detail-page/create-card-model";
import { buildCustomPlaylistThumbnailUrl, formatLooseLabel, getArchivedHlsBaseUrl } from "./sg-event-detail-page/utils";

export const CoachingCardClips = ({ issue }: { issue: TIssue }) => {
  const clips = useMemo(
    () => (issue.coaching_card_data ? buildCoachingCardClips(issue.coaching_card_data, issue.created_at) : []),
    [issue.coaching_card_data, issue.created_at]
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const activeClip = clips.find((clip) => clip.key === selectedKey) ?? clips[0];
  const playableClips = useMemo(() => clips.filter((clip) => clip.sourceUrl), [clips]);
  const playNextClip = useCallback(() => {
    const currentIndex = playableClips.findIndex((clip) => clip.key === activeClip?.key);
    const nextClip = playableClips[(currentIndex + 1) % playableClips.length];
    if (!nextClip) return;
    setAutoPlay(true);
    setSelectedKey(nextClip.key);
  }, [activeClip?.key, playableClips]);
  if (issue.category !== "Coaching Card") return null;
  const source = activeClip ? resolveCoachingClipSource(activeClip.sourceUrl, getArchivedHlsBaseUrl()) : "";
  const poster = activeClip?.thumbnail?.startsWith("/")
    ? activeClip.thumbnail
    : buildCustomPlaylistThumbnailUrl(activeClip?.thumbnail);
  const sourceType = /\.m3u8(?:[?#]|$)/i.test(source) ? "m3u8 / Live Stream Archive" : "Video";

  return (
    <section aria-label="Clips" className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h6 className="text-sm font-medium text-custom-text-100">Clips</h6>
        <button
          type="button"
          disabled
          title="Adding clips will be available in a future update."
          className="inline-flex items-center gap-1.5 rounded border border-custom-border-300 px-2 py-1 text-xs text-custom-text-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          Add Clip
        </button>
      </div>
      {activeClip && source ? (
        <CoachingCardClipPlayer
          clip={activeClip}
          src={source}
          poster={poster || undefined}
          autoPlay={autoPlay}
          onComplete={playableClips.length > 1 ? playNextClip : undefined}
        />
      ) : (
        <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-custom-border-200 bg-custom-background-90 px-4 text-center text-sm text-custom-text-300">
          <Video aria-hidden="true" className="h-6 w-6" />
          {activeClip ? "This clip has no saved video source." : "No clips are attached to this coaching card."}
        </div>
      )}
      {activeClip && (
        <div className="space-y-1 text-xs text-custom-text-200">
          <p className="text-[11px] text-custom-text-300">Slot {activeClip.slot}</p>
          <p className="break-words font-medium text-custom-text-100">
            {activeClip.playlistName ? `${activeClip.playlistName} — ` : ""}
            {formatLooseLabel(activeClip.title)}
          </p>
          <p>{source ? sourceType : "Source unavailable"}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-custom-text-300">
            <span>Duration: {formatCardDuration(activeClip.durationSeconds)}</span>
            <span>Date added: {activeClip.addedAt ? renderFormattedDate(activeClip.addedAt) : "—"}</span>
          </div>
        </div>
      )}
      {clips.length > 1 && (
        <div
          aria-label="Clip list"
          className="vertical-scrollbar scrollbar-sm max-h-48 space-y-1.5 overflow-y-auto overscroll-contain"
        >
          {clips.map((clip) => (
            <button
              key={clip.key}
              type="button"
              aria-label={`Play slot ${clip.slot}: ${clip.title}`}
              aria-pressed={activeClip?.key === clip.key}
              disabled={!clip.sourceUrl}
              onClick={() => {
                setAutoPlay(true);
                setSelectedKey(clip.key);
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border border-custom-border-200 bg-custom-background-90 px-3 py-2 text-left text-xs text-custom-text-200 hover:bg-custom-background-80 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100",
                activeClip?.key === clip.key && "border-custom-primary-100/40 bg-custom-primary-100/10"
              )}
            >
              <Video aria-hidden="true" className="h-4 w-4 shrink-0 text-custom-text-300" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-custom-text-100">{formatLooseLabel(clip.title)}</span>
                <span className="text-[10px] text-custom-text-300">
                  Slot {clip.slot}
                  {clip.playlistName ? ` · ${clip.playlistName}` : ""}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-custom-text-300">
                {formatCardDuration(clip.durationSeconds)}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
