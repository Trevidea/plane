"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { ChevronRight, Play, Video } from "lucide-react";
import { API_BASE_URL } from "@plane/constants";
import type { TIssue } from "@plane/types";
import { ImageWithFallback, Loader, ScrollArea } from "@plane/ui";
import { cn } from "@plane/utils";
import { getSgEventMediaReferenceAnnotations, normalizePlaylistAnnotations } from "@/components/annotation";
import { MediaLibraryService } from "@/services/media-library.service";
import { useResolvedMediaSources } from "ce/features/media-library/hooks/media-detail-hooks";
import { useMediaLibraryItem } from "ce/features/media-library/hooks/use-media-library-item";
import type { CoachingCardDetailClip, CoachingCardDetailPlaylist } from "./coaching-card-clips-model";
import {
  buildCoachingCardClips,
  clipTypeConfig,
  resolveCoachingClipSource,
  resolveCoachingClipThumbnail,
  groupCoachingCardPlaylists,
} from "./coaching-card-clips-model";
import { CoachingCardStreamLink } from "./coaching-card-stream-link";
import { formatCardDuration } from "./sg-event-detail-page/create-card-model";
import { loadSgMediaPayload } from "./sg-event-detail-page/data";
import {
  asRecord,
  buildCustomPlaylistThumbnailUrl,
  formatLooseLabel,
  getArchivedHlsBaseUrl,
} from "./sg-event-detail-page/utils";

const CoachingCardClipPlayer = dynamic(
  () => import("./coaching-card-clip-player").then((module) => module.CoachingCardClipPlayer),
  { ssr: false }
);

const mediaLibraryService = new MediaLibraryService();

const thumbnailUrl = (thumbnail?: string | null) =>
  thumbnail
    ? thumbnail.startsWith("/")
      ? resolveCoachingClipThumbnail(thumbnail, API_BASE_URL)
      : buildCustomPlaylistThumbnailUrl(thumbnail)
    : undefined;

export const CoachingCardClipBrowser = ({
  issue,
  workspaceSlug,
  projectId,
}: {
  issue: TIssue;
  workspaceSlug: string;
  projectId: string;
}) => {
  const card = issue.coaching_card_data;
  const { item: mediaItem, isLoading } = useMediaLibraryItem(workspaceSlug, projectId, card?.source_media?.artifact_id);
  const { effectiveVideoSrc: uploadedSourceUrl } = useResolvedMediaSources({
    item: mediaItem,
    meta: mediaItem?.meta ?? {},
    documentFormat: mediaItem?.format ?? "",
    normalizedAction: (mediaItem?.action ?? "").toLowerCase(),
  });
  const playlists: CoachingCardDetailPlaylist[] = useMemo(
    () =>
      card
        ? groupCoachingCardPlaylists(
            card,
            buildCoachingCardClips(card, issue.created_at, {
              workspaceSlug,
              projectId,
              apiBaseUrl: API_BASE_URL,
              uploadedSourceUrl,
              uploadedThumbnail: mediaItem?.thumbnail,
            })
          )
        : [],
    [card, issue.created_at, workspaceSlug, projectId, uploadedSourceUrl, mediaItem?.thumbnail]
  );
  const clips: CoachingCardDetailClip[] = useMemo(() => playlists.flatMap((playlist) => playlist.clips), [playlists]);
  const [selection, setSelection] = useState<{ cardId: string; key: string } | null>(null);
  const [expanded, setExpanded] = useState<{ cardId: string; playlistId: string | null } | null>(null);
  const [playRequest, setPlayRequest] = useState(0);
  const activeClip = clips.find((clip) => selection?.cardId === issue.id && clip.key === selection.key) ?? clips[0];
  const activePlaylistIndex = playlists.findIndex((playlist) =>
    playlist.clips.some((clip) => clip.key === activeClip?.key)
  );
  const expandedPlaylistId = expanded?.cardId === issue.id ? expanded.playlistId : playlists[activePlaylistIndex]?.id;
  const playClip = (key: string) => {
    setSelection({ cardId: issue.id, key });
    const playlist = playlists.find((playlist) => playlist.clips.some((clip) => clip.key === key));
    if (playlist) setExpanded({ cardId: issue.id, playlistId: playlist.id });
    setPlayRequest((request) => request + 1);
  };
  const advanceClip = useCallback(() => {
    if (!clips.length) return;
    const currentIndex = clips.findIndex((clip) => clip.key === activeClip?.key);
    const nextClip = clips[(currentIndex + 1) % clips.length];
    setSelection({ cardId: issue.id, key: nextClip.key });
    const playlist = playlists.find((playlist) => playlist.clips.some((clip) => clip.key === nextClip.key));
    if (playlist) setExpanded({ cardId: issue.id, playlistId: playlist.id });
    setPlayRequest((request) => request + 1);
  }, [clips, playlists, activeClip?.key, issue.id]);
  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get("clip");
    if (linked) setSelection({ cardId: issue.id, key: linked });
    setPlayRequest(0);
  }, [issue.id]);
  const { item: selectedMedia } = useMediaLibraryItem(workspaceSlug, projectId, activeClip?.sourceMedia?.artifact_id);
  const { effectiveVideoSrc: selectedMediaSrc } = useResolvedMediaSources({
    item: activeClip?.sourceMedia ? selectedMedia : null,
    meta: selectedMedia?.meta ?? {},
    documentFormat: selectedMedia?.format ?? "",
    normalizedAction: selectedMedia?.action ?? "",
  });
  const source = activeClip
    ? (activeClip.sourceMedia ? selectedMediaSrc : "") ||
      resolveCoachingClipSource(activeClip.sourceUrl, getArchivedHlsBaseUrl())
    : "";
  const sourceIssueId = card?.source_issue?.id;
  const { data: eventMedia } = useSWR(
    sourceIssueId ? `SG_EVENT_MEDIA_${workspaceSlug}_${projectId}_${sourceIssueId}` : null,
    () => loadSgMediaPayload(workspaceSlug, projectId, sourceIssueId!, null, mediaLibraryService),
    { revalidateOnFocus: false }
  );
  const eventMeta = { ...eventMedia?.eventPayload, ...eventMedia?.eventItem?.meta };
  const playlistReferenceAnnotations = getSgEventMediaReferenceAnnotations(eventMeta, {
    viewKey: `custom-playlist:${activeClip?.playlistId}`,
    eventPayload: eventMedia?.eventPayload,
  });
  const savedPlaylist = (Array.isArray(eventMeta.custom_playlists) ? eventMeta.custom_playlists : [])
    .map(asRecord)
    .find((playlist) => playlist.id === activeClip?.playlistId);
  const playlistAnnotations = playlistReferenceAnnotations.length
    ? playlistReferenceAnnotations
    : normalizePlaylistAnnotations(savedPlaylist?.annotations);
  const annotations = normalizePlaylistAnnotations(
    activeClip?.sourceMedia
      ? selectedMedia?.meta?.annotations
      : card?.source_media
        ? (mediaItem?.meta?.annotations ?? card.source_media.annotations)
        : playlistAnnotations.length
          ? playlistAnnotations
          : getSgEventMediaReferenceAnnotations(eventMeta, {
              streamId: activeClip?.streamId,
              videoSrc: source,
              eventPayload: eventMedia?.eventPayload,
            })
  );
  const poster =
    thumbnailUrl(activeClip?.thumbnail) ||
    (activeClip?.sourceMedia ? selectedMedia?.thumbnail : mediaItem?.thumbnail) ||
    undefined;

  if (issue.category !== "Coaching Card") return null;
  return (
    <section aria-label="Clips" className="min-w-0 space-y-5">
      {isLoading ? (
        <Loader>
          <Loader.Item width="100%" height="240px" />
        </Loader>
      ) : activeClip ? (
        source ? (
          <CoachingCardClipPlayer
            clip={activeClip}
            src={source}
            poster={poster}
            autoPlay={playRequest > 0}
            playRequest={playRequest}
            onComplete={advanceClip}
            annotations={annotations}
            annotationTimeline={
              !activeClip.sourceMedia && !card?.source_media && playlistAnnotations.length ? "playlist" : "source"
            }
            showPrecisionControls={false}
          />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-lg border border-custom-border-300 bg-custom-background-90 text-sm text-custom-text-100">
            This clip has no saved video source.
          </div>
        )
      ) : (
        <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-lg border border-custom-border-300 bg-custom-background-90 text-sm text-custom-text-100">
          <Video className="h-6 w-6" aria-hidden="true" />
          No clips added yet.
        </div>
      )}
      {!isLoading && <CoachingCardStreamLink source={source} />}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-custom-text-100">{playlists.length > 1 ? "Playlists" : "Clips"}</h3>
          <span className="text-xs text-custom-text-100">
            {clips.length} {clips.length === 1 ? "clip" : "clips"}
          </span>
        </div>
        {playlists.map((playlist, playlistIndex) => (
          <div key={playlist.id} className="min-w-0 space-y-2">
            <div
              className={cn(
                "flex w-full items-center rounded border border-custom-border-300 text-sm text-custom-text-100",
                activePlaylistIndex === playlistIndex && "border-custom-primary-100 bg-custom-primary-100/10"
              )}
            >
              <button
                type="button"
                aria-label={`Toggle playlist: ${playlist.name}`}
                aria-expanded={expandedPlaylistId === playlist.id}
                aria-controls={`coaching-playlist-${issue.id}-${playlistIndex}`}
                onClick={() =>
                  setExpanded({ cardId: issue.id, playlistId: expandedPlaylistId === playlist.id ? null : playlist.id })
                }
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-3 py-2 text-left hover:bg-custom-background-90 focus-visible:outline-custom-primary-100"
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 shrink-0 transition-transform",
                    expandedPlaylistId === playlist.id && "rotate-90"
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{formatLooseLabel(playlist.name)}</span>
                <span className="shrink-0 text-xs">
                  {playlist.clips.length} {playlist.clips.length === 1 ? "clip" : "clips"}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Play playlist: ${playlist.name}`}
                onClick={() => playClip(playlist.clips[0].key)}
                className="mr-1 rounded p-2 hover:bg-custom-background-90 focus-visible:outline-custom-primary-100"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div id={`coaching-playlist-${issue.id}-${playlistIndex}`} hidden={expandedPlaylistId !== playlist.id}>
              <ScrollArea type="hover" size="sm" className="w-full">
                <ul aria-label={`${playlist.name} clips`} className="flex w-max min-w-full flex-row gap-3 p-1 pb-3">
                  {playlist.clips.map((clip) => {
                    const period = clip.period?.replace(/^quarter\s*(\d+)$/i, "Q$1");
                    const clock =
                      clip.gameClock?.replace(/\s*[-–]\s*/g, " → ") ||
                      `${formatCardDuration(clip.startSeconds)} → ${formatCardDuration(clip.endSeconds)}`;
                    return (
                      <li key={clip.key} className="w-60 shrink-0">
                        <button
                          type="button"
                          aria-label={`Play clip: ${clip.title}`}
                          aria-pressed={activeClip?.key === clip.key}
                          onClick={() => playClip(clip.key)}
                          className={cn(
                            "group flex w-full flex-col overflow-hidden rounded-lg border border-custom-border-300 bg-custom-background-100 text-left transition-colors hover:bg-custom-background-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100 focus-visible:ring-offset-2 focus-visible:ring-offset-custom-background-100",
                            activeClip?.key === clip.key && "border-custom-primary-100 bg-custom-primary-100/10"
                          )}
                        >
                          <span className="relative block aspect-video w-full overflow-hidden bg-custom-background-80">
                            <ImageWithFallback
                              src={thumbnailUrl(clip.thumbnail)}
                              alt=""
                              loading="lazy"
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                            <span className="absolute inset-0 flex items-center justify-center">
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-custom-primary-100 text-white shadow-sm">
                                <Play className="h-4 w-4" aria-hidden="true" />
                              </span>
                            </span>
                          </span>
                          <span className="block w-full min-w-0 space-y-1 border-t border-custom-border-300 p-3">
                            <span className="block truncate text-sm font-medium text-custom-text-100">
                              {formatLooseLabel(clip.title)}
                            </span>
                            <span className="block truncate text-xs text-custom-text-100">
                              {clipTypeConfig(clip.clipType).label}
                            </span>
                            <span className="block truncate text-xs tabular-nums text-custom-text-100">
                              {[period, clock].filter(Boolean).join(" · ")}
                            </span>
                            <span className="block text-xs text-custom-text-100">
                              {clip.durationSeconds !== null
                                ? `${Math.round(clip.durationSeconds * 10) / 10} sec`
                                : "Duration unavailable"}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
