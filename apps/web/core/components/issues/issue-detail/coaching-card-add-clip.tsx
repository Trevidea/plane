import { useRef, useState } from "react";
import { useResolvedMediaSources } from "ce/features/media-library/hooks/media-detail-hooks";
import { useMediaLibraryItem } from "ce/features/media-library/hooks/use-media-library-item";
import { useMediaLibraryItems } from "ce/features/media-library/hooks/use-media-library-items";
import { Dialog } from "@headlessui/react";
import { Button, CustomSelect, EModalWidth, Input, Loader, ModalCore, TextArea } from "@plane/ui";
import { CoachingCardClipUpload } from "./coaching-card-clip-upload";
import type { CoachingCardDetailClip } from "./coaching-card-clips-model";
import {
  COACHING_CLIP_TYPES,
  clipTypeConfig,
  parseClipTime,
  resolveCoachingClipSource,
} from "./coaching-card-clips-model";
import { getArchivedHlsBaseUrl } from "./sg-event-detail-page/utils";

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
        className="w-full text-custom-text-100"
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
          input
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
        <p className="text-xs text-custom-text-300">No videos found. Try another search or upload a new video.</p>
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
  onAdd: (clip: CoachingCardDetailClip, requestId: string) => Promise<void> | void;
  initialClip?: CoachingCardDetailClip;
  currentClip?: CoachingCardDetailClip;
  sources?: CoachingCardDetailClip[];
  getPosition?: () => number;
  workspaceSlug?: string;
  projectId?: string;
  saving?: boolean;
  capturedRange?: { start: number; end: number | null };
}) => {
  // Existing footage is inherited only when editing or explicitly adding a captured range.
  const base = initialClip || (capturedRange ? currentClip : undefined);
  const showClipDetails = Boolean(initialClip || capturedRange);
  const requestId = useRef(crypto.randomUUID());
  const [title, setTitle] = useState(initialClip?.title || "");
  const [url, setUrl] = useState(base?.sourceUrl || "");
  const [source, setSource] = useState<Partial<CoachingCardDetailClip>>(base || {});
  const [sourceKey, setSourceKey] = useState(base?.key || "");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [start, setStart] = useState(
    String(initialClip?.startSeconds ?? capturedRange?.start ?? base?.startSeconds ?? "0")
  );
  const [end, setEnd] = useState(String(initialClip?.endSeconds ?? capturedRange?.end ?? base?.endSeconds ?? ""));
  const [type, setType] = useState(initialClip?.clipType || "coach_added");
  const [note, setNote] = useState(initialClip?.note || "");
  const [sourceName, setSourceName] = useState(base?.sourceName || "");
  const [period, setPeriod] = useState(initialClip?.period || "");
  const [clock, setClock] = useState(initialClip?.gameClock || "");
  const [tags, setTags] = useState(initialClip?.tags?.join(", ") || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadPending, setUploadPending] = useState(false);
  const busy = saving || submitting;
  const { item: sourceItem } = useMediaLibraryItem(workspaceSlug, projectId, source.sourceMedia?.artifact_id);
  const { effectiveVideoSrc: mediaSourceUrl } = useResolvedMediaSources({
    item: sourceItem?.id === source.sourceMedia?.artifact_id ? sourceItem : null,
    meta: sourceItem?.meta ?? {},
    documentFormat: sourceItem?.format ?? "",
    normalizedAction: sourceItem?.action ?? "",
  });
  const resolvedSourceUrl =
    (source.sourceMedia && sourceItem?.id === source.sourceMedia.artifact_id ? mediaSourceUrl : "") ||
    resolveCoachingClipSource(url, getArchivedHlsBaseUrl());
  const selectSource = (next: Partial<CoachingCardDetailClip>) => {
    setError("");
    setSource(next);
    setUrl(next.sourceUrl || "");
    setSourceName(next.sourceName || next.title || "");
    setStart(String(next.startSeconds ?? 0));
    setEnd(String(next.endSeconds ?? ""));
    setPeriod(next.period || "");
    setClock(next.gameClock || "");
    setLibraryOpen(false);
  };
  const readDraft = (): CoachingCardDetailClip | null => {
    if (!title.trim()) {
      setError("Enter a clip title.");
      return null;
    }
    const startSeconds = parseClipTime(start);
    const endSeconds = end.trim() ? parseClipTime(end) : null;
    const resolved = resolvedSourceUrl;
    let parsed: URL;
    try {
      parsed = new URL(resolved, window.location.origin);
      if (!["https:", "http:"].includes(parsed.protocol) || !url.trim()) throw new Error();
      if (startSeconds === null || (end.trim() && (endSeconds === null || endSeconds <= startSeconds)))
        throw new Error();
    } catch {
      setError(
        showClipDetails
          ? "Enter an HTTP or HTTPS video URL and an end time after the start time."
          : "Upload a video or choose one from the media library."
      );
      return null;
    }
    const clip: CoachingCardDetailClip = {
      ...source,
      ...initialClip,
      key: initialClip?.key || requestId.current,
      associationId: initialClip?.associationId,
      slot: initialClip?.slot ?? sources.length,
      title: title.trim(),
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
    return clip;
  };
  const submit = async () => {
    if (busy || uploadPending) return;
    const clip = readDraft();
    if (!clip) return;
    setSubmitting(true);
    try {
      await onAdd(clip, requestId.current);
      onClose();
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
        className="flex max-h-[90vh] flex-col p-5 text-custom-text-100"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Dialog.Title className="text-base font-semibold text-custom-text-100">
          {initialClip ? "Edit clip details" : "Add clip"}
        </Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-custom-text-300">
          {initialClip || capturedRange
            ? "Choose footage and a range to attach to this coaching card."
            : "Upload a new video or choose from the media library to add a separate clip."}
        </Dialog.Description>
        <div className="mt-4 min-h-0 overflow-y-auto">
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            <label className="block space-y-1 text-xs text-custom-text-200">
              <span>Clip type</span>
              <CustomSelect
                input
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
            {(initialClip || capturedRange) && sources.length > 0 && (
              <label className="block space-y-1 text-xs text-custom-text-200">
                <span>Video source</span>
                <CustomSelect
                  input
                  value={sourceKey}
                  label={sources.find((entry) => entry.key === sourceKey)?.sourceName || "Select existing video"}
                  disabled={busy || uploadPending}
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
                <Button
                  variant="link-primary"
                  size="sm"
                  type="button"
                  disabled={uploadPending}
                  onClick={() => setLibraryOpen(!libraryOpen)}
                >
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
            {!initialClip && workspaceSlug && projectId && (
              <CoachingCardClipUpload
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                disabled={busy}
                onPendingChange={setUploadPending}
                onSelect={(next) => {
                  setSourceKey("");
                  selectSource(next);
                }}
              />
            )}
            {showClipDetails && (
              <>
                <label className="block space-y-1 text-xs text-custom-text-200">
                  <span>Video URL</span>
                  <Input
                    className="w-full text-custom-text-100"
                    required
                    disabled={uploadPending}
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
                    <Input
                      className="w-full text-custom-text-100"
                      value={start}
                      onChange={(event) => setStart(event.target.value)}
                      placeholder="00:18"
                    />
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
                    <Input
                      className="w-full text-custom-text-100"
                      value={end}
                      onChange={(event) => setEnd(event.target.value)}
                      placeholder="00:31"
                    />
                    {getPosition && sourceKey === currentClip?.key && (
                      <Button
                        variant="link-primary"
                        size="sm"
                        type="button"
                        onClick={() => setEnd(getPosition().toFixed(2))}
                      >
                        Set end from player
                      </Button>
                    )}
                  </label>
                </div>
              </>
            )}
            <label className="block space-y-1 text-xs text-custom-text-200">
              <span>Clip title</span>
              <Input
                className="w-full text-custom-text-100"
                value={title}
                required
                maxLength={255}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setError("");
                }}
                placeholder="Practice rep — corrected footwork"
              />
            </label>
            {showClipDetails && (
              <>
                <label className="block space-y-1 text-xs text-custom-text-200">
                  <span>Source / event name</span>
                  <Input
                    className="w-full text-custom-text-100"
                    value={sourceName}
                    onChange={(event) => setSourceName(event.target.value)}
                    placeholder="Practice · Oct 8"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1 text-xs text-custom-text-200">
                    <span>Period</span>
                    <Input
                      className="w-full text-custom-text-100"
                      value={period}
                      onChange={(event) => setPeriod(event.target.value)}
                      placeholder="Q2"
                    />
                  </label>
                  <label className="block space-y-1 text-xs text-custom-text-200">
                    <span>Game clock</span>
                    <Input
                      className="w-full text-custom-text-100"
                      value={clock}
                      onChange={(event) => setClock(event.target.value)}
                      placeholder="08:42"
                    />
                  </label>
                </div>
                <label className="block space-y-1 text-xs text-custom-text-200">
                  <span>Tags (comma separated)</span>
                  <Input
                    className="w-full text-custom-text-100"
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                    placeholder="Footwork, First step"
                  />
                </label>
              </>
            )}
            <label className="block space-y-1 text-xs text-custom-text-200">
              <span>Coach note</span>
              <TextArea
                rows={4}
                className="min-h-28 resize-y text-sm text-custom-text-100"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional coaching note"
              />
            </label>
          </fieldset>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-xs text-custom-text-200">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2 border-t border-custom-border-200 pt-4">
          <Button variant="neutral-primary" size="sm" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={busy || uploadPending || !resolvedSourceUrl || !title.trim()}
            loading={busy}
          >
            {initialClip ? "Save changes" : "Add clip"}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
};
