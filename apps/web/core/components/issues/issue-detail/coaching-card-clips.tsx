"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useResolvedMediaSources } from "ce/features/media-library/hooks/media-detail-hooks";
import { useMediaLibraryItem } from "ce/features/media-library/hooks/use-media-library-item";
import dynamic from "next/dynamic";
import { Plus, Video, Play, Maximize } from "lucide-react";
import { API_BASE_URL } from "@plane/constants";
import { EmptyState } from "@plane/propel/empty-state";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCoachingCardData, TIssue } from "@plane/types";
import { ImageWithFallback, AlertModalCore, Badge, Button, CustomMenu, CustomSelect, Loader, Tooltip } from "@plane/ui";
import { cn, renderFormattedDate } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { IssueService } from "@/services/issue/issue.service";
import { CoachingCardAddClip } from "./coaching-card-add-clip";
import { CoachingCardClipBrowser } from "./coaching-card-clip-browser";
import { CoachingCardStreamLink } from "./coaching-card-stream-link";
import type { CoachingCardDetailClip, ClipGroup, ClipSort } from "./coaching-card-clips-model";
import {
  buildCoachingCardClips,
  resolveCoachingClipSource,
  resolveCoachingClipThumbnail,
  clipTypeConfig,
  filterAndSortClips,
  clipMutationPayload,
} from "./coaching-card-clips-model";
import { formatCardDuration } from "./sg-event-detail-page/create-card-model";
import { buildCustomPlaylistThumbnailUrl, formatLooseLabel, getArchivedHlsBaseUrl } from "./sg-event-detail-page/utils";
const CoachingCardClipPlayer = dynamic(
  () => import("./coaching-card-clip-player").then((module) => module.CoachingCardClipPlayer),
  { ssr: false }
);

const clipService = new IssueService();

const CoachingCardClipManager = ({
  issue,
  workspaceSlug,
  projectId,
  disabled = false,
  onModalChange,
}: {
  issue: TIssue;
  workspaceSlug: string;
  projectId: string;
  disabled?: boolean;
  onModalChange?: (open: boolean) => void;
}) => {
  const {
    issue: { fetchIssue },
    fetchActivities,
  } = useIssueDetail();
  const [persisted, setPersisted] = useState<{ cardId: string; data: TCoachingCardData } | null>(null);
  const cardData = persisted?.cardId === issue.id ? persisted.data : issue.coaching_card_data;
  useEffect(() => setPersisted(null), [issue.id, issue.coaching_card_data]);
  const uploadedMedia = cardData?.source_media;
  const { item: mediaItem, isLoading: isMediaLoading } = useMediaLibraryItem(
    workspaceSlug,
    projectId,
    uploadedMedia?.artifact_id
  );
  const { effectiveVideoSrc: uploadedSourceUrl } = useResolvedMediaSources({
    item: mediaItem,
    meta: mediaItem?.meta ?? {},
    documentFormat: mediaItem?.format ?? "",
    normalizedAction: (mediaItem?.action ?? "").toLowerCase(),
  });
  const savedClips = useMemo(
    () =>
      cardData
        ? buildCoachingCardClips(cardData, issue.created_at, {
            workspaceSlug,
            projectId,
            apiBaseUrl: API_BASE_URL,
            uploadedSourceUrl,
            uploadedThumbnail: mediaItem?.thumbnail,
          })
        : [],
    [cardData, issue.created_at, workspaceSlug, projectId, uploadedSourceUrl, mediaItem?.thumbnail]
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [playRequest, setPlayRequest] = useState(0);
  const [dialog, setDialog] = useState<"add" | CoachingCardDetailClip | null>(null);
  const [removing, setRemoving] = useState<CoachingCardDetailClip | null>(null);
  const [saving, setSaving] = useState(false);
  const [captured, setCaptured] = useState<{ key: string; start: number; end: number | null } | null>(null);
  const [group, setGroup] = useState<ClipGroup>("all");
  const [sort, setSort] = useState<ClipSort>("oldest");
  const position = useRef(0);
  const playerContainer = useRef<HTMLDivElement>(null);
  const clips = savedClips;
  const activeClip = clips.find((clip) => clip.key === selectedKey) ?? filterAndSortClips(clips, "all", "oldest")[0];
  const { item: selectedMedia } = useMediaLibraryItem(workspaceSlug, projectId, activeClip?.sourceMedia?.artifact_id);
  const { effectiveVideoSrc: selectedMediaSrc } = useResolvedMediaSources({
    item: activeClip?.sourceMedia ? selectedMedia : null,
    meta: selectedMedia?.meta ?? {},
    documentFormat: selectedMedia?.format ?? "",
    normalizedAction: selectedMedia?.action ?? "",
  });
  const shown = filterAndSortClips(clips, clips.length > 2 ? group : "all", sort);
  const modalOpen = Boolean(dialog || removing);
  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get("clip");
    if (linked) setSelectedKey(linked);
  }, [issue.id]);
  useEffect(() => {
    onModalChange?.(modalOpen);
    return () => onModalChange?.(false);
  }, [modalOpen, onModalChange]);
  const acceptResponse = (response: Partial<TIssue>) => {
    if (response.coaching_card_data) setPersisted({ cardId: issue.id, data: response.coaching_card_data });
    void fetchIssue(workspaceSlug, projectId, issue.id).catch(() => {});
    void fetchActivities(workspaceSlug, projectId, issue.id).catch(() => {});
    window.dispatchEvent(new CustomEvent("coaching-card-updated", { detail: { projectId } }));
  };
  const saveClip = async (clip: CoachingCardDetailClip, requestId: string) => {
    if (disabled || saving) return;
    setSaving(true);
    try {
      const response = await clipService.saveCoachingCardClip(
        workspaceSlug,
        projectId,
        issue.id,
        clipMutationPayload(clip, requestId),
        clip.associationId
      );
      acceptResponse(response);
      const updatedClips = response.coaching_card_data
        ? buildCoachingCardClips(response.coaching_card_data, issue.created_at)
        : [];
      setSelectedKey(clip.associationId || updatedClips[updatedClips.length - 1]?.key || null);
      setAutoPlay(false);
      setGroup("all");
      setCaptured(null);
      setToast({ type: TOAST_TYPE.SUCCESS, title: clip.associationId ? "Clip updated" : "Clip added" });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Unable to save clip",
        message: "Your changes are still here. Please try again.",
      });
      throw error;
    } finally {
      setSaving(false);
    }
  };
  const removeClip = async () => {
    if (!removing || disabled || saving) return;
    setSaving(true);
    try {
      const response = await clipService.removeCoachingCardClip(
        workspaceSlug,
        projectId,
        issue.id,
        removing.associationId || removing.key
      );
      acceptResponse(response);
      if (selectedKey === removing.key) {
        setSelectedKey(null);
        setAutoPlay(false);
      }
      setCaptured(null);
      setRemoving(null);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Clip removed" });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Unable to remove clip", message: "Please try again." });
    } finally {
      setSaving(false);
    }
  };
  const copy = async (clip: CoachingCardDetailClip) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("card", issue.id);
      url.searchParams.set("clip", clip.associationId || clip.key);
      await navigator.clipboard.writeText(url.href);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Clip link copied" });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Unable to copy clip link" });
    }
  };
  const openClip = (clip: CoachingCardDetailClip) => {
    position.current = clip.startSeconds;
    setCaptured(null);
    setSelectedKey(clip.key);
    setAutoPlay(true);
    setPlayRequest((request) => request + 1);
  };
  const menus = (clip: CoachingCardDetailClip) => (
    <CustomMenu ellipsis placement="bottom-end" optionsClassName="z-50" ariaLabel="Clip actions">
      <CustomMenu.MenuItem onClick={() => openClip(clip)} disabled={!clip.sourceUrl}>
        Open clip
      </CustomMenu.MenuItem>
      {!disabled && <CustomMenu.MenuItem onClick={() => setDialog(clip)}>Edit details</CustomMenu.MenuItem>}
      {!disabled && <CustomMenu.MenuItem onClick={() => setDialog(clip)}>Change clip type</CustomMenu.MenuItem>}
      <CustomMenu.MenuItem onClick={() => void copy(clip)} disabled={!clip.sourceUrl}>
        Copy clip link
      </CustomMenu.MenuItem>
      {!disabled && (
        <CustomMenu.MenuItem
          onClick={() =>
            setDialog({
              ...clip,
              sourceUrl: "",
              sourceMedia: undefined,
              streamId: undefined,
              startSegment: null,
              endSegment: null,
            })
          }
        >
          Replace clip source
        </CustomMenu.MenuItem>
      )}
      {!disabled && <CustomMenu.MenuItem onClick={() => setRemoving(clip)}>Remove from card</CustomMenu.MenuItem>}
    </CustomMenu>
  );
  if (issue.category !== "Coaching Card") return null;
  const source = activeClip
    ? (activeClip.sourceMedia ? selectedMediaSrc : "") ||
      resolveCoachingClipSource(activeClip.sourceUrl, getArchivedHlsBaseUrl())
    : "";
  const poster = activeClip?.thumbnail
    ? activeClip.thumbnail.startsWith("/")
      ? resolveCoachingClipThumbnail(activeClip.thumbnail, API_BASE_URL)
      : buildCustomPlaylistThumbnailUrl(activeClip.thumbnail)
    : (activeClip?.sourceMedia ? selectedMedia?.thumbnail : mediaItem?.thumbnail) || undefined;
  return (
    <section aria-label="Clips" className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-custom-text-100">Clips</h3>
        {!disabled && (
          <Button variant="link-primary" size="sm" type="button" onClick={() => setDialog("add")}>
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            Add clip
          </Button>
        )}
      </div>
      {isMediaLoading ? (
        <Loader>
          <Loader.Item width="100%" height="200px" />
          <Loader.Item width="65%" height="16px" />
          <Loader.Item width="100%" height="64px" />
        </Loader>
      ) : activeClip ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h4 className="truncate text-sm font-medium text-custom-text-100">
                {formatLooseLabel(activeClip.title)}
              </h4>
              <p className="text-xs text-custom-text-300">
                {clipTypeConfig(activeClip.clipType).label}
                {activeClip.sourceName ? ` · ${activeClip.sourceName}` : ""}
                {activeClip.period ? ` · ${activeClip.period}` : ""}
                {activeClip.gameClock ? ` · ${activeClip.gameClock}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip tooltipContent="Open full player">
                <Button
                  variant="neutral-primary"
                  size="sm"
                  type="button"
                  aria-label="Open full player"
                  disabled={!source}
                  onClick={() =>
                    void playerContainer.current
                      ?.querySelector<HTMLElement>("[data-coaching-player]")
                      ?.requestFullscreen?.()
                      .catch(() => {})
                  }
                >
                  <Maximize className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
              {menus(activeClip)}
            </div>
          </div>
          <CoachingCardStreamLink source={source} />
          <div ref={playerContainer}>
            {source ? (
              <CoachingCardClipPlayer
                onSetStart={
                  !disabled ? () => setCaptured({ key: activeClip.key, start: position.current, end: null }) : undefined
                }
                onSetEnd={
                  !disabled
                    ? () =>
                        setCaptured((current) => ({
                          key: activeClip.key,
                          start: current?.key === activeClip.key ? current.start : activeClip.startSeconds,
                          end: position.current,
                        }))
                    : undefined
                }
                clip={activeClip}
                src={source}
                poster={poster || undefined}
                autoPlay={autoPlay}
                playRequest={playRequest}
                paused={modalOpen}
                onPosition={(seconds) => {
                  position.current = seconds;
                }}
              />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded border border-custom-border-200 bg-custom-background-90 text-sm text-custom-text-300">
                This clip has no saved video source.
              </div>
            )}
          </div>
          {captured?.key === activeClip.key && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-custom-text-300">
              <span>
                Selected range · {formatCardDuration(captured.start)} → {formatCardDuration(captured.end)}
              </span>
              <Button variant="link-primary" size="sm" onClick={() => setDialog("add")}>
                Add this range
              </Button>
            </div>
          )}
          <details open className="text-xs text-custom-text-200">
            <summary className="cursor-pointer py-1 font-medium focus-visible:outline-custom-primary-100">
              Clip details
            </summary>
            <dl className="mt-2 grid grid-cols-[100px_1fr] gap-x-3 gap-y-2">
              <dt className="text-custom-text-300">Type</dt>
              <dd>{clipTypeConfig(activeClip.clipType).label}</dd>
              <dt className="text-custom-text-300">Source</dt>
              <dd>{activeClip.sourceName || activeClip.playlistName || "—"}</dd>
              <dt className="text-custom-text-300">Period / clock</dt>
              <dd>{[activeClip.period, activeClip.gameClock].filter(Boolean).join(" · ") || "—"}</dd>
              <dt className="text-custom-text-300">Range</dt>
              <dd>
                {formatCardDuration(activeClip.startSeconds)} → {formatCardDuration(activeClip.endSeconds)} ·{" "}
                {activeClip.durationSeconds ?? "—"} sec
              </dd>
              <dt className="text-custom-text-300">Created by</dt>
              <dd>{activeClip.createdBy || "—"}</dd>
              <dt className="text-custom-text-300">Created</dt>
              <dd>{activeClip.addedAt ? renderFormattedDate(activeClip.addedAt) : "—"}</dd>
            </dl>
          </details>
          {activeClip.tags?.length ? (
            <div className="flex flex-wrap gap-1">
              {activeClip.tags.map((tag) => (
                <Badge key={tag} variant="neutral" size="sm">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
          {activeClip.note && (
            <div className="space-y-1 text-xs">
              <p className="font-medium text-custom-text-200">Coach note</p>
              <p className="whitespace-pre-wrap text-custom-text-300">{activeClip.note}</p>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          type="simple"
          className="mx-auto py-6"
          asset={<Video className="h-6 w-6 text-custom-text-300" />}
          title="No clips added yet."
          description="Add game film, practice footage, verification footage, or reference video to this coaching card."
          actions={
            !disabled ? [{ label: "+ Add clip", onClick: () => setDialog("add"), variant: "primary" }] : undefined
          }
        />
      )}
      {clips.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-custom-text-300">
            <span>
              {clips.length} clip{clips.length === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              {clips.length > 2 && (
                <CustomSelect
                  value={group}
                  label={
                    {
                      all: "All clips",
                      game: "Game film",
                      practice: "Practice",
                      verification: "Verification",
                      reference: "Reference",
                      other: "Other",
                    }[group]
                  }
                  onChange={setGroup}
                  optionsClassName="z-40"
                >
                  {Object.entries({
                    all: "All clips",
                    game: "Game film",
                    practice: "Practice",
                    verification: "Verification",
                    reference: "Reference",
                    other: "Other",
                  }).map(([key, label]) => (
                    <CustomSelect.Option key={key} value={key}>
                      {label}
                    </CustomSelect.Option>
                  ))}
                </CustomSelect>
              )}
              <CustomSelect
                value={sort}
                label={{ oldest: "Oldest first", newest: "Newest first", type: "Clip type", source: "Source" }[sort]}
                onChange={setSort}
                optionsClassName="z-40"
              >
                {Object.entries({
                  oldest: "Oldest first",
                  newest: "Newest first",
                  type: "Clip type",
                  source: "Source",
                }).map(([key, label]) => (
                  <CustomSelect.Option key={key} value={key}>
                    {label}
                  </CustomSelect.Option>
                ))}
              </CustomSelect>
            </div>
          </div>
          <ul aria-label="Clip list" className="space-y-2">
            {shown.map((clip) => (
              <li
                key={clip.key}
                className={cn(
                  "flex items-center gap-2 rounded-md border border-custom-border-200 bg-custom-background-90 p-2",
                  activeClip?.key === clip.key && "border-custom-primary-100/50 bg-custom-primary-100/5"
                )}
              >
                <button
                  type="button"
                  aria-label={`Play clip: ${clip.title}`}
                  aria-pressed={activeClip?.key === clip.key}
                  disabled={!clip.sourceUrl}
                  onClick={() => openClip(clip)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100 disabled:opacity-50"
                >
                  <span className="relative flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-custom-background-80">
                    {clip.thumbnail && (
                      <ImageWithFallback
                        src={
                          clip.thumbnail.startsWith("/")
                            ? resolveCoachingClipThumbnail(clip.thumbnail, API_BASE_URL)
                            : buildCustomPlaylistThumbnailUrl(clip.thumbnail)
                        }
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                    <Play
                      aria-hidden="true"
                      className="relative h-4 w-4 rounded bg-custom-background-100/80 text-custom-text-100"
                    />
                  </span>
                  <span className="min-w-0 space-y-1 text-xs">
                    <span className="block truncate font-medium text-custom-text-100">
                      {formatLooseLabel(clip.title)}
                    </span>
                    <span className="block truncate text-custom-text-300">
                      {clipTypeConfig(clip.clipType).label} · {clip.sourceName || clip.playlistName || "Video"}
                    </span>
                    {(clip.period || clip.gameClock) && (
                      <span className="block text-custom-text-300">
                        {[clip.period, clip.gameClock].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    <span className="block text-custom-text-300">
                      {formatCardDuration(clip.startSeconds)} → {formatCardDuration(clip.endSeconds)} ·{" "}
                      {clip.durationSeconds ?? "—"} sec
                    </span>
                    {(clip.createdBy || clip.addedAt) && (
                      <span className="block text-[10px] text-custom-text-300">
                        {[clip.createdBy, clip.addedAt ? renderFormattedDate(clip.addedAt) : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1">{menus(clip)}</div>
                {clip.tags?.length ? (
                  <div className="hidden flex-wrap gap-1 sm:flex">
                    {clip.tags.slice(0, 2).map((tag) => (
                      <Badge key={tag} size="sm" variant="neutral">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {!shown.length && <p className="py-4 text-center text-xs text-custom-text-300">No clips in this group.</p>}
        </>
      )}
      {dialog && (
        <CoachingCardAddClip
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          saving={saving}
          onClose={() => {
            if (!saving) {
              setDialog(null);
              setCaptured(null);
            }
          }}
          onAdd={saveClip}
          initialClip={dialog === "add" ? undefined : dialog}
          currentClip={activeClip}
          capturedRange={captured?.key === activeClip?.key ? captured : undefined}
          sources={clips}
          getPosition={activeClip && source ? () => position.current : undefined}
        />
      )}
      <AlertModalCore
        isOpen={Boolean(removing)}
        title="Remove clip?"
        content="This clip will be removed from this coaching card. The original video will not be deleted."
        isSubmitting={saving}
        primaryButtonText={{ default: "Remove clip", loading: "Removing…" }}
        handleClose={() => {
          if (!saving) setRemoving(null);
        }}
        handleSubmit={() => void removeClip()}
        variant="danger"
      />
    </section>
  );
};

export const CoachingCardClips = ({
  viewOnly = false,
  ...props
}: Parameters<typeof CoachingCardClipManager>[0] & { viewOnly?: boolean }) =>
  viewOnly ? (
    <CoachingCardClipBrowser issue={props.issue} workspaceSlug={props.workspaceSlug} projectId={props.projectId} />
  ) : (
    <CoachingCardClipManager {...props} />
  );
