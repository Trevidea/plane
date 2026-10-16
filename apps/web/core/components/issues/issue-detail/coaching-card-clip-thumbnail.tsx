import { Loader2, Play } from "lucide-react";
import { API_BASE_URL } from "@plane/constants";
import { ImageWithFallback } from "@plane/ui";
import { cn } from "@plane/utils";
import type { CoachingCardDetailClip } from "./coaching-card-clips-model";
import { clipTypeConfig, parseClipTime, resolveCoachingClipThumbnail } from "./coaching-card-clips-model";
import { formatCardDuration } from "./sg-event-detail-page/create-card-model";
import { buildCustomPlaylistThumbnailUrl, formatLooseLabel } from "./sg-event-detail-page/utils";
import { useCoachingClipMedia } from "./use-coaching-clip-media";

export const CoachingCardClipThumbnail = ({
  clip,
  workspaceSlug,
  projectId,
  selected,
  onSelect,
}: {
  clip: CoachingCardDetailClip;
  workspaceSlug: string;
  projectId: string;
  selected: boolean;
  onSelect: () => void;
}) => {
  const { data: media, isLoading } = useCoachingClipMedia(workspaceSlug, projectId, clip.sourceMedia);
  const processing = media?.isTranscodeActive;
  const checking = Boolean(clip.sourceMedia && isLoading);
  const thumbnail = media?.thumbnail || clip.thumbnail;
  const poster = thumbnail
    ? thumbnail.startsWith("/")
      ? resolveCoachingClipThumbnail(thumbnail, API_BASE_URL)
      : buildCustomPlaylistThumbnailUrl(thumbnail)
    : undefined;
  const duration = clip.durationSeconds ?? (media?.duration ? parseClipTime(media.duration) : null);
  const clock =
    clip.gameClock?.replace(/\s*[-–]\s*/g, " → ") ||
    `${formatCardDuration(clip.startSeconds)} → ${formatCardDuration(clip.endSeconds ?? (duration !== null ? clip.startSeconds + duration : null))}`;
  const period = clip.period?.replace(/^quarter\s*(\d+)$/i, "Q$1");
  const progress = media?.transcodeProgress ?? 0;
  return (
    <li className="w-60 shrink-0">
      <button
        type="button"
        aria-label={`Play clip: ${clip.title}`}
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "group flex w-full flex-col overflow-hidden rounded-lg border border-custom-border-300 bg-custom-background-100 text-left transition-colors hover:bg-custom-background-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100 focus-visible:ring-offset-2 focus-visible:ring-offset-custom-background-100",
          selected && "border-custom-primary-100 bg-custom-primary-100/10"
        )}
      >
        <span className="relative block aspect-video w-full overflow-hidden bg-custom-background-80">
          {!processing && !checking && (
            <ImageWithFallback
              src={poster}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-custom-primary-100 text-white shadow-sm">
              {processing || checking ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
            {processing && (
              <span className="block w-full space-y-2" role="status">
                <span className="flex items-center justify-between gap-2 text-xs font-medium text-custom-text-100">
                  <span>{media.transcodeStatus === "QUEUED" ? "Queued for transcoding" : "Transcoding"}</span>
                  <span className="tabular-nums">{progress}%</span>
                </span>
                <span
                  role="progressbar"
                  aria-label={`${clip.title} processing progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                  className="block h-1.5 overflow-hidden rounded-full bg-custom-background-100"
                >
                  <span
                    className="block h-full rounded-full bg-custom-primary-100 transition-[width]"
                    style={{ width: `${progress}%` }}
                  />
                </span>
              </span>
            )}
          </span>
        </span>
        <span className="block w-full min-w-0 space-y-1 border-t border-custom-border-300 p-3">
          <span className="block truncate text-sm font-medium text-custom-text-100">
            {formatLooseLabel(clip.title)}
          </span>
          <span className="block truncate text-xs text-custom-text-100">{clipTypeConfig(clip.clipType).label}</span>
          {processing ? (
            <span className="block text-xs text-custom-text-300">Ready to play when transcoding finishes.</span>
          ) : media?.isTranscodeFailed ? (
            <span className="block text-xs text-red-500">{media.transcodeError || "Video processing failed."}</span>
          ) : checking ? (
            <span className="block text-xs text-custom-text-300">Checking video…</span>
          ) : (
            <>
              <span className="block truncate text-xs tabular-nums text-custom-text-100">
                {[period, clock].filter(Boolean).join(" · ")}
              </span>
              <span className="block text-xs text-custom-text-100">
                {duration !== null ? `${Math.round(duration * 10) / 10} sec` : "Duration unavailable"}
              </span>
            </>
          )}
        </span>
      </button>
    </li>
  );
};
