import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Dialog } from "@headlessui/react";
import { Button, CustomSelect, EModalWidth, Input, Loader, ModalCore, TextArea } from "@plane/ui";
import { useResolvedMediaSources } from "ce/features/media-library/hooks/media-detail-hooks";
import { useMediaLibraryItems } from "ce/features/media-library/hooks/use-media-library-items";
import type { CoachingCardDetailClip } from "./coaching-card-clips-model";
import {
  COACHING_CLIP_TYPES,
  clipTypeConfig,
  parseClipTime,
  resolveCoachingClipSource,
} from "./coaching-card-clips-model";
import { getArchivedHlsBaseUrl } from "./sg-event-detail-page/utils";

const ClipPlayer = dynamic(
  () => import("./coaching-card-clip-player").then((module) => module.CoachingCardClipPlayer),
  { ssr: false }
);

// Uses the same project library query and media resolution as the existing media UI.
const LibrarySourcePicker = ({
  workspaceSlug,
  projectId,
  onSelect,
}: {
  workspaceSlug: string;
  projectId: string;
  onSelect: (source: Partial<CoachingCardDetailClip>) => void;
}) => {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [page, setPage] = useState(1);
  const { items, isLoading, pagination } = useMediaLibraryItems(workspaceSlug, projectId, undefined, {
    query,
    perPage: 25,
    page,
  });
  const item = items.find((entry) => entry.id === selectedId);
  const { effectiveVideoSrc } = useResolvedMediaSources({
    item,
    meta: item?.meta ?? {},
    documentFormat: item?.format ?? "",
    normalizedAction: item?.action ?? "",
  });
  return (
    <div className="space-y-2">
      <Input
        aria-label="Search project videos"
        value={query}
        placeholder="Search project videos…"
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(1);
          setSelectedId("");
        }}
      />
      {isLoading ? (
        <Loader>
          <Loader.Item width="100%" height="28px" />
        </Loader>
      ) : (
        <CustomSelect
          value={selectedId}
          label={item?.title || "Select project video"}
          onChange={setSelectedId}
          optionsClassName="z-50"
        >
          {items
            .filter((entry) => entry.mediaType === "video" || entry.linkedMediaType === "video")
            .map((entry) => (
              <CustomSelect.Option key={entry.id} value={entry.id}>
                {entry.title}
              </CustomSelect.Option>
            ))}
        </CustomSelect>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button
            variant="link-primary"
            size="sm"
            type="button"
            disabled={page === 1 || isLoading}
            onClick={() => {
              setPage(page - 1);
              setSelectedId("");
            }}
          >
            Previous
          </Button>
          <Button
            variant="link-primary"
            size="sm"
            type="button"
            disabled={!pagination?.nextPageResults || isLoading}
            onClick={() => {
              setPage(page + 1);
              setSelectedId("");
            }}
          >
            Next
          </Button>
        </div>
        <Button
          variant="neutral-primary"
          size="sm"
          type="button"
          disabled={!item || !effectiveVideoSrc}
          onClick={() => {
            if (item && effectiveVideoSrc)
              onSelect({
                sourceUrl: effectiveVideoSrc,
                sourceName: item.title,
                thumbnail: item.thumbnail || null,
                sourceMedia: item.packageId ? { package_id: item.packageId, artifact_id: item.id } : undefined,
                playbackMode: "source",
              });
          }}
        >
          Use video
        </Button>
      </div>
      {!isLoading && !items.some((entry) => entry.mediaType === "video" || entry.linkedMediaType === "video") && (
        <p className="text-xs text-custom-text-300">No videos found. Try another search or enter a video URL.</p>
      )}
    </div>
  );
};

export const CoachingCardAddClip = ({
  onClose,
  onAdd,
  initialClip,
  currentClip,
  sources = [],
  getPosition,
  workspaceSlug,
  projectId,
  saving = false,
  capturedRange,
}: {
  onClose: () => void;
  onAdd?: (clip: CoachingCardDetailClip, requestId: string) => Promise<void> | void;
  initialClip?: CoachingCardDetailClip;
  currentClip?: CoachingCardDetailClip;
  sources?: CoachingCardDetailClip[];
  getPosition?: () => number;
  workspaceSlug?: string;
  projectId?: string;
  saving?: boolean;
  capturedRange?: { start: number; end: number | null };
}) => {
  const base = initialClip || currentClip;
  const requestId = useRef(crypto.randomUUID());
  const [title, setTitle] = useState(initialClip?.title || "");
  const [url, setUrl] = useState(base?.sourceUrl || "");
  const [source, setSource] = useState<Partial<CoachingCardDetailClip>>(base || {});
  const [sourceKey, setSourceKey] = useState(base?.key || "");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [start, setStart] = useState(
    String(initialClip?.startSeconds ?? capturedRange?.start ?? currentClip?.startSeconds ?? "")
  );
  const [end, setEnd] = useState(
    String(initialClip?.endSeconds ?? capturedRange?.end ?? currentClip?.endSeconds ?? "")
  );
  const [type, setType] = useState(initialClip?.clipType || "coach_added");
  const [note, setNote] = useState(initialClip?.note || "");
  const [sourceName, setSourceName] = useState(base?.sourceName || "");
  const [period, setPeriod] = useState(initialClip?.period || "");
  const [clock, setClock] = useState(initialClip?.gameClock || "");
  const [tags, setTags] = useState(initialClip?.tags?.join(", ") || "");
  const [preview, setPreview] = useState<CoachingCardDetailClip | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const busy = saving || submitting;
  const selectSource = (next: Partial<CoachingCardDetailClip>) => {
    setSource(next);
    setUrl(next.sourceUrl || "");
    setSourceName(next.sourceName || next.title || "");
    setStart(String(next.startSeconds ?? 0));
    setEnd(String(next.endSeconds ?? ""));
    setPeriod(next.period || "");
    setClock(next.gameClock || "");
    setLibraryOpen(false);
  };
  const submit = async () => {
    if (busy) return;
    const startSeconds = parseClipTime(start);
    const endSeconds = end.trim() ? parseClipTime(end) : null;
    const resolved = resolveCoachingClipSource(url, getArchivedHlsBaseUrl());
    let parsed: URL;
    try {
      parsed = new URL(resolved, window.location.origin);
      if (!["https:", "http:"].includes(parsed.protocol) || !url.trim()) throw new Error();
      if (startSeconds === null || (end.trim() && (endSeconds === null || endSeconds <= startSeconds)))
        throw new Error();
    } catch {
      setError("Enter an HTTP or HTTPS video URL and an end time after the start time.");
      return;
    }
    const clip: CoachingCardDetailClip = {
      ...source,
      ...initialClip,
      key: initialClip?.key || requestId.current,
      associationId: initialClip?.associationId,
      slot: initialClip?.slot ?? sources.length,
      title: title.trim() || "Coaching clip",
      clipType: type,
      playlistName: initialClip?.playlistName || "",
      sourceName: sourceName.trim(),
      sourceUrl: parsed.href,
      thumbnail: source.thumbnail ?? null,
      sourceMedia: source.sourceMedia,
      streamId: source.streamId,
      eventId: source.eventId,
      startSegment: source.startSegment,
      endSegment: source.endSegment,
      playbackMode: source.playbackMode || "source",
      sourceStartSeconds:
        source.sourceStartSeconds ?? (source.playbackMode === "clip" ? source.startSeconds : undefined),
      startSeconds: startSeconds!,
      endSeconds,
      durationSeconds: endSeconds === null ? null : endSeconds - startSeconds!,
      addedAt: initialClip?.addedAt || new Date().toISOString(),
      note: note.trim(),
      period,
      gameClock: clock,
      tags: [
        ...new Set(
          tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        ),
      ],
    };
    setError("");
    setSubmitting(true);
    try {
      if (onAdd) {
        await onAdd(clip, requestId.current);
        onClose();
      } else setPreview(clip);
    } catch {
      setError("Unable to save this clip. Your changes are still here. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <ModalCore
      isOpen
      handleClose={() => {
        if (!busy) onClose();
      }}
      width={EModalWidth.LG}
    >
      <form
        data-prevent-outside-click
        className="max-h-[90vh] overflow-y-auto p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Dialog.Title className="text-base font-semibold text-custom-text-100">
          {initialClip ? "Edit clip details" : "Add clip"}
        </Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-custom-text-300">
          Choose footage and a range to attach to this coaching card.
        </Dialog.Description>
        <fieldset disabled={busy} className="mt-4 space-y-4">
          <label className="block space-y-1 text-xs text-custom-text-200">
            <span>Clip type</span>
            <CustomSelect
              value={type}
              label={clipTypeConfig(type).label}
              onChange={setType}
              disabled={busy}
              optionsClassName="z-50"
            >
              {Object.entries(COACHING_CLIP_TYPES).map(([value, config]) => (
                <CustomSelect.Option key={value} value={value}>
                  {config.label}
                </CustomSelect.Option>
              ))}
            </CustomSelect>
          </label>
          {sources.length > 0 && (
            <label className="block space-y-1 text-xs text-custom-text-200">
              <span>Video source</span>
              <CustomSelect
                value={sourceKey}
                label={sources.find((entry) => entry.key === sourceKey)?.sourceName || "Select existing video"}
                disabled={busy}
                optionsClassName="z-50"
                onChange={(key: string) => {
                  setSourceKey(key);
                  const next = sources.find((entry) => entry.key === key);
                  if (next) selectSource(next);
                }}
              >
                {sources
                  .filter((clip) => clip.sourceUrl)
                  .map((clip) => (
                    <CustomSelect.Option key={clip.key} value={clip.key}>
                      {clip.sourceName || clip.title}
                    </CustomSelect.Option>
                  ))}
              </CustomSelect>
            </label>
          )}
          {workspaceSlug && projectId && (
            <div className="space-y-2">
              <Button variant="link-primary" size="sm" type="button" onClick={() => setLibraryOpen(!libraryOpen)}>
                Choose from media library
              </Button>
              {libraryOpen && (
                <LibrarySourcePicker
                  workspaceSlug={workspaceSlug}
                  projectId={projectId}
                  onSelect={(next) => {
                    setSourceKey("");
                    selectSource(next);
                  }}
                />
              )}
            </div>
          )}
          <label className="block space-y-1 text-xs text-custom-text-200">
            <span>Video URL</span>
            <Input
              required
              value={url}
              placeholder="https://…/playlist.m3u8"
              onChange={(event) => {
                setUrl(event.target.value);
                setSource({ playbackMode: "source" });
                setSourceKey("");
                setStart("0");
                setEnd("");
                setPeriod("");
                setClock("");
              }}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-xs text-custom-text-200">
              <span>Start (seconds or timecode)</span>
              <Input value={start} onChange={(event) => setStart(event.target.value)} placeholder="00:18" />
              {getPosition && sourceKey === currentClip?.key && (
                <Button
                  variant="link-primary"
                  size="sm"
                  type="button"
                  onClick={() => setStart(getPosition().toFixed(2))}
                >
                  Set start from player
                </Button>
              )}
            </label>
            <label className="block space-y-1 text-xs text-custom-text-200">
              <span>End (optional)</span>
              <Input value={end} onChange={(event) => setEnd(event.target.value)} placeholder="00:31" />
              {getPosition && sourceKey === currentClip?.key && (
                <Button variant="link-primary" size="sm" type="button" onClick={() => setEnd(getPosition().toFixed(2))}>
                  Set end from player
                </Button>
              )}
            </label>
          </div>
          <label className="block space-y-1 text-xs text-custom-text-200">
            <span>Clip title</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Practice rep — corrected footwork"
            />
          </label>
          <label className="block space-y-1 text-xs text-custom-text-200">
            <span>Source / event name</span>
            <Input
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
              placeholder="Practice · Oct 8"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-xs text-custom-text-200">
              <span>Period</span>
              <Input value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="Q2" />
            </label>
            <label className="block space-y-1 text-xs text-custom-text-200">
              <span>Game clock</span>
              <Input value={clock} onChange={(event) => setClock(event.target.value)} placeholder="08:42" />
            </label>
          </div>
          <label className="block space-y-1 text-xs text-custom-text-200">
            <span>Tags (comma separated)</span>
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Footwork, First step" />
          </label>
          <label className="block space-y-1 text-xs text-custom-text-200">
            <span>Coach note</span>
            <TextArea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional coaching note"
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="mt-3 text-xs text-custom-text-200">
            {error}
          </p>
        )}
        {preview && !onAdd && <ClipPlayer clip={preview} src={preview.sourceUrl} autoPlay={false} />}
        <div className="mt-4 flex justify-end gap-2 border-t border-custom-border-200 pt-4">
          <Button variant="neutral-primary" size="sm" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={busy} loading={busy}>
            {onAdd ? (initialClip ? "Save changes" : "Add clip") : "Preview clip"}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
};
