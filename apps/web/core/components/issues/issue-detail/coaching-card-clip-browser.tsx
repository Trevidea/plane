"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useResolvedMediaSources } from "ce/features/media-library/hooks/media-detail-hooks";
import { useMediaLibraryItem } from "ce/features/media-library/hooks/use-media-library-item";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { ChevronRight, Loader2, Play, Plus, Video } from "lucide-react";
import { API_BASE_URL } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCoachingCardData, TIssue } from "@plane/types";
import { Button, Loader, ScrollArea } from "@plane/ui";
import { cn } from "@plane/utils";
import { getSgEventMediaReferenceAnnotations, normalizePlaylistAnnotations } from "@/components/annotation";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { IssueService } from "@/services/issue/issue.service";
import { MediaLibraryService } from "@/services/media-library.service";
import { CoachingCardAddClip } from "./coaching-card-add-clip";
import { CoachingCardClipThumbnail } from "./coaching-card-clip-thumbnail";
import type { CoachingCardDetailClip, CoachingCardDetailPlaylist } from "./coaching-card-clips-model";
import {
  buildCoachingCardClips,
  resolveCoachingClipSource,
  resolveCoachingClipThumbnail,
  groupCoachingCardPlaylists,
  clipMutationPayload,
} from "./coaching-card-clips-model";
import { CoachingCardStreamLink } from "./coaching-card-stream-link";
import { useCoachingClipMedia } from "./use-coaching-clip-media";
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
const issueService = new IssueService();

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
  disabled = false,
  allowAdding = false,
  onModalChange,
}: {
  issue: TIssue;
  workspaceSlug: string;
  projectId: string;
  disabled?: boolean;
  allowAdding?: boolean;
  onModalChange?: (open: boolean) => void;
}) => {
  const {
    issue: { fetchIssue },
    fetchActivities,
  } = useIssueDetail();
  const [persisted, setPersisted] = useState<{ cardId: string; data: TCoachingCardData } | null>(null);
  const card = persisted?.cardId === issue.id ? persisted.data : issue.coaching_card_data;
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const canAdd = allowAdding && !disabled && !issue.archived_at;
  useEffect(() => {
    if (!canAdd) setAdding(false);
  }, [canAdd]);
  useEffect(() => {
    setPersisted(null);
    setAdding(false);
  }, [issue.id, issue.coaching_card_data]);
  useEffect(() => {
    onModalChange?.(adding);
    return () => onModalChange?.(false);
  }, [adding, onModalChange]);
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
  const saveClip = async (clip: CoachingCardDetailClip, requestId: string) => {
    if (!canAdd || saving) return;
    setSaving(true);
    try {
      const response = await issueService.saveCoachingCardClip(
        workspaceSlug,
        projectId,
        issue.id,
        clipMutationPayload(clip, requestId)
      );
      if (response.coaching_card_data) {
        setPersisted({ cardId: issue.id, data: response.coaching_card_data });
        const updated = buildCoachingCardClips(response.coaching_card_data, issue.created_at);
        const added = updated[updated.length - 1];
        if (added) {
          setSelection({ cardId: issue.id, key: added.key });
          setExpanded({ cardId: issue.id, playlistId: added.playlistId ?? null });
          setPlayRequest((value) => value + 1);
        }
      }
      void fetchIssue(workspaceSlug, projectId, issue.id).catch(() => {});
      void fetchActivities(workspaceSlug, projectId, issue.id).catch(() => {});
      window.dispatchEvent(new CustomEvent("coaching-card-updated", { detail: { projectId } }));
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Clip added" });
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Unable to add clip", message: "Please try again." });
      throw error;
    } finally {
      setSaving(false);
    }
  };
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
  const { data: selectedMedia, isLoading: isSelectedMediaLoading } = useCoachingClipMedia(
    workspaceSlug,
    projectId,
    activeClip?.sourceMedia
  );
  const waitingForVideo = Boolean(
    activeClip?.sourceMedia && (isSelectedMediaLoading || selectedMedia?.isTranscodeActive)
  );
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
      ? (selectedMedia?.meta?.annotations ??
          (activeClip.sourceMedia.artifact_id === card?.source_media?.artifact_id
            ? card.source_media.annotations
            : undefined))
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
        waitingForVideo ? (
          <div
            role="status"
            className="flex aspect-video flex-col items-center justify-center gap-3 rounded-lg border border-custom-border-300 bg-custom-background-90 p-6 text-center text-sm text-custom-text-100"
          >
            <Loader2 className="h-6 w-6 animate-spin text-custom-primary-100" aria-hidden="true" />
            <p>
              {selectedMedia?.isTranscodeActive
                ? `Video processing · ${selectedMedia.transcodeProgress ?? 0}%`
                : "Checking video…"}
            </p>
            <p className="text-xs text-custom-text-300">The clip will be ready to play when processing finishes.</p>
          </div>
        ) : selectedMedia?.isTranscodeFailed ? (
          <div
            role="status"
            className="flex aspect-video items-center justify-center rounded-lg border border-custom-border-300 bg-custom-background-90 p-6 text-center text-sm text-custom-text-100"
          >
            {selectedMedia.transcodeError || "Video processing failed. Please retry from the media library."}
          </div>
        ) : source ? (
          <CoachingCardClipPlayer
            clip={activeClip}
            src={source}
            poster={poster}
            autoPlay={playRequest > 0}
            playRequest={playRequest}
            paused={adding}
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
      {!isLoading && !waitingForVideo && !selectedMedia?.isTranscodeFailed && (
        <CoachingCardStreamLink source={source} />
      )}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-custom-text-100">{playlists.length > 1 ? "Playlists" : "Clips"}</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-custom-text-100">
              {clips.length} {clips.length === 1 ? "clip" : "clips"}
            </span>
            {canAdd && (
              <Button variant="link-primary" size="sm" type="button" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add clip
              </Button>
            )}
          </div>
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
                  {playlist.clips.map((clip) => (
                    <CoachingCardClipThumbnail
                      key={clip.key}
                      clip={clip}
                      workspaceSlug={workspaceSlug}
                      projectId={projectId}
                      selected={activeClip?.key === clip.key}
                      onSelect={() => playClip(clip.key)}
                    />
                  ))}
                </ul>
              </ScrollArea>
            </div>
          </div>
        ))}
      </div>
      {adding && canAdd && (
        <CoachingCardAddClip
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          saving={saving}
          sources={clips}
          currentClip={activeClip}
          onAdd={saveClip}
          onClose={() => {
            if (!saving) setAdding(false);
          }}
        />
      )}
    </section>
  );
};
