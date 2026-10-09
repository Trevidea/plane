import type { TCoachingCardData } from "@plane/types";

export const sortCoachingClipsByTime = <T extends { startSeconds: number; sourceStartSeconds?: number }>(clips: T[]) =>
  [...clips].sort((a, b) => (a.sourceStartSeconds ?? a.startSeconds) - (b.sourceStartSeconds ?? b.startSeconds));

export const resolveCoachingStreamLink = (source: string) => {
  try {
    const url = new URL(source, "http://localhost");
    if (url.pathname === "/api/hls") {
      const upstream = url.searchParams.get("url");
      if (upstream && /^https?:\/\//i.test(upstream)) return upstream;
    }
  } catch {
    console.error("Failed to parse coaching clip source URL:", source);
  }
  return source;
};

export const resolveCoachingClipThumbnail = (value: string | null | undefined, apiBaseUrl: string) => {
  const thumbnail = value?.trim() || "";
  return thumbnail.startsWith("/api/") ? `${apiBaseUrl.replace(/\/+$/, "")}${thumbnail}` : thumbnail;
};

export type CoachingCardDetailClip = {
  key: string;
  slot: number;
  title: string;
  playlistName: string;
  playlistId?: string;
  sourceUrl: string;
  thumbnail: string | null;
  startSeconds: number;
  endSeconds: number | null;
  durationSeconds: number | null;
  addedAt: string;
  clipType?: string;
  sourceName?: string;
  eventId?: string;
  period?: string;
  gameClock?: string;
  createdBy?: string;
  note?: string;
  tags?: string[];
  streamId?: string;
  playerIds?: string[];
  positionGroupIds?: string[];
  associationId?: string;
  playbackMode?: "source" | "clip";
  sourceStartSeconds?: number;
  playlistStartSeconds?: number;
  playlistDurationSeconds?: number;
  sourceType?: string;
  sourceMedia?: { package_id: string; artifact_id: string };
  startSegment?: number | null;
  endSegment?: number | null;
};

const validSeconds = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export const buildCoachingCardClips = (
  card: TCoachingCardData,
  createdAt: string,
  context?: {
    workspaceSlug: string;
    projectId: string;
    apiBaseUrl?: string;
    uploadedSourceUrl?: string;
    uploadedThumbnail?: string | null;
  }
): CoachingCardDetailClip[] => {
  const primary = card.primary_clip;
  const addedAt = card.metadata?.created_at || createdAt;
  const clips = (card.playlists ?? []).flatMap((playlist, playlistIndex) =>
    (playlist.clips ?? []).map((clip, index): CoachingCardDetailClip => {
      const isPrimary = primary?.association_id
        ? primary.association_id === clip.association_id
        : primary?.playlist_id === playlist.id && primary.clip_id === clip.id;
      const startSeconds =
        validSeconds(isPrimary ? (primary?.start_seconds ?? clip.start_seconds) : clip.start_seconds) ?? 0;
      const endSeconds = validSeconds(isPrimary ? (primary?.end_seconds ?? clip.end_seconds) : clip.end_seconds);
      return {
        key: clip.association_id || `legacy:${playlistIndex}:${index}`,
        associationId: clip.association_id || `legacy:${playlistIndex}:${index}`,
        slot: 0,
        title: clip.title?.trim() || "Original Clip",
        playlistName: playlist.name,
        playlistId: playlist.id,
        sourceUrl:
          (isPrimary ? primary?.source_url?.trim() || clip.source_url : clip.source_url)?.trim() ||
          (context && card.source_media?.artifact_id === clip.id
            ? context.uploadedSourceUrl?.trim() ||
              `${(context.apiBaseUrl || "").replace(/\/+$/, "")}/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/projects/${encodeURIComponent(context.projectId)}/media-library/packages/${encodeURIComponent(card.source_media.package_id)}/artifacts/${encodeURIComponent(card.source_media.artifact_id)}/file/`
            : ""),
        thumbnail:
          (card.source_media?.artifact_id === clip.id ? context?.uploadedThumbnail : null) ||
          clip.thumbnail ||
          (isPrimary ? card.summary?.primary_thumbnail : null) ||
          null,
        startSeconds,
        endSeconds: endSeconds !== null && endSeconds > startSeconds ? endSeconds : null,
        durationSeconds:
          validSeconds(clip.duration_seconds) ??
          (endSeconds !== null && endSeconds > startSeconds ? endSeconds - startSeconds : null),
        addedAt: clip.created_at || addedAt,
        playbackMode: clip.playback_mode,
        sourceStartSeconds: clip.source_start_seconds ?? undefined,
        sourceType: clip.source_type,
        sourceMedia: clip.source_media ?? undefined,
        startSegment: clip.start_segment,
        endSegment: clip.end_segment,
        clipType: clip.clip_type || (isPrimary ? "original" : "game_film"),
        sourceName:
          clip.source_name || clip.event_name || card.source_issue?.name || card.source_media?.title || playlist.name,
        eventId: clip.event_id || primary?.event_id,
        period: clip.period || clip.group || playlist.name,
        gameClock: clip.game_clock || clip.timecode,
        createdBy: clip.created_by?.name || card.metadata?.author?.name,
        note: clip.note,
        tags: clip.tags,
        streamId: clip.stream_id,
        playerIds: clip.player_ids,
        positionGroupIds: clip.position_group_ids,
      };
    })
  );
  // Legacy cards can point every clip at a combined playlist while retaining
  // timestamps from the original recording. Keep offsets before primary reordering.
  for (const playlist of card.playlists ?? []) {
    const playlistClips = clips.filter((clip) => clip.playlistId === playlist.id);
    if (
      playlistClips.length < 2 ||
      playlistClips.some(
        (clip) =>
          clip.playbackMode || !clip.sourceUrl || !clip.durationSeconds || clip.sourceUrl !== playlistClips[0].sourceUrl
      )
    )
      continue;
    const total = playlistClips.reduce((sum, clip) => sum + clip.durationSeconds!, 0);
    let offset = 0;
    for (const clip of playlistClips) {
      clip.playlistStartSeconds = offset;
      clip.playlistDurationSeconds = total;
      offset += clip.durationSeconds!;
    }
  }
  const primaryIndex = (card.playlists ?? [])
    .flatMap((playlist) =>
      (playlist.clips ?? []).map((clip) =>
        primary?.association_id
          ? primary.association_id === clip.association_id
          : primary?.playlist_id === playlist.id && primary.clip_id === clip.id
      )
    )
    .findIndex(Boolean);
  if (primaryIndex > 0) clips.unshift(...clips.splice(primaryIndex, 1));
  if (primaryIndex < 0 && primary?.source_url?.trim()) {
    const startSeconds = validSeconds(primary.start_seconds) ?? 0;
    const endSeconds = validSeconds(primary.end_seconds);
    clips.unshift({
      key: primary.association_id || "legacy:0:0",
      associationId: primary.association_id || "legacy:0:0",
      slot: 0,
      title: card.summary?.primary_clip_title || "Original Clip",
      playlistName: "",
      sourceUrl: primary.source_url.trim(),
      thumbnail: card.summary?.primary_thumbnail || null,
      startSeconds,
      endSeconds: endSeconds !== null && endSeconds > startSeconds ? endSeconds : null,
      durationSeconds: endSeconds !== null && endSeconds > startSeconds ? endSeconds - startSeconds : null,
      addedAt,
      clipType: "original",
      sourceName: card.source_issue?.name || card.source_media?.title,
      createdBy: card.metadata?.author?.name,
    });
  }
  return clips.map((clip, slot) => ({ ...clip, slot }));
};

export const resolveCoachingClipSource = (source: string, archiveBase: string) => {
  const value = source.trim();
  if (!value) return "";
  if (/^(https?:\/\/|\/)/i.test(value)) return value;
  return `${archiveBase.replace(/\/+$/, "")}/${value}`;
};

export const getClipPlaybackRange = (
  clip: Pick<
    CoachingCardDetailClip,
    | "startSeconds"
    | "endSeconds"
    | "durationSeconds"
    | "playbackMode"
    | "sourceStartSeconds"
    | "playlistStartSeconds"
    | "playlistDurationSeconds"
  >,
  mediaDuration: number
) => {
  const sourceDuration = Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : null;
  if (clip.playbackMode === "source" && sourceDuration !== null && clip.startSeconds >= sourceDuration) {
    throw new Error("Clip range is outside the available source video.");
  }
  const start =
    clip.playbackMode === "clip"
      ? Math.max(0, clip.startSeconds - (clip.sourceStartSeconds ?? clip.startSeconds))
      : sourceDuration !== null && clip.startSeconds >= sourceDuration
        ? clip.playlistDurationSeconds && (clip.playlistStartSeconds ?? 0) < sourceDuration
          ? (clip.playlistStartSeconds ?? 0)
          : 0
        : clip.startSeconds;
  const requestedEnd =
    clip.playbackMode === "clip"
      ? clip.endSeconds !== null
        ? clip.endSeconds - (clip.sourceStartSeconds ?? clip.startSeconds)
        : null
      : start === clip.startSeconds
        ? clip.endSeconds
        : null;
  const end =
    requestedEnd ??
    (clip.durationSeconds !== null && clip.durationSeconds > 0 ? start + clip.durationSeconds : sourceDuration);
  const boundedEnd = sourceDuration !== null && end !== null ? Math.min(end, sourceDuration) : end;
  return { start, end: boundedEnd, duration: boundedEnd !== null ? Math.max(0, boundedEnd - start) : 0 };
};

export const COACHING_CLIP_TYPES = {
  original: { label: "Original Tagged Clip", group: "game" },
  game_film: { label: "Game Film", group: "game" },
  practice_check: { label: "Practice Check", group: "practice" },
  verified_on_film: { label: "Verified on Film", group: "verification" },
  coach_added: { label: "Coach Added Clip", group: "other" },
  player_submitted: { label: "Player Submitted Clip", group: "other" },
  reference: { label: "Reference Clip", group: "reference" },
  teaching: { label: "Teaching Clip", group: "reference" },
  scout: { label: "Scout Clip", group: "reference" },
  comparison: { label: "Comparison Clip", group: "reference" },
} as const;
export type CoachingClipType = keyof typeof COACHING_CLIP_TYPES;
export type ClipGroup = "all" | "game" | "practice" | "verification" | "reference" | "other";
export type ClipSort = "oldest" | "newest" | "type" | "source";
export const clipTypeConfig = (type?: string) =>
  COACHING_CLIP_TYPES[type as CoachingClipType] ?? {
    label: type?.replace(/_/g, " ") || "Coach Added Clip",
    group: "other",
  };

export const parseClipTime = (value: string): number | null => {
  if (!value.trim()) return 0;
  const parts = value.trim().split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((number, index) => !Number.isFinite(number) || (index > 0 && number >= 60))) return null;
  return numbers.reduce((total, number) => total * 60 + number, 0);
};
export const filterAndSortClips = (clips: CoachingCardDetailClip[], group: ClipGroup, sort: ClipSort) =>
  clips
    .filter((clip) => group === "all" || clipTypeConfig(clip.clipType).group === group)
    .sort((a, b) => {
      if (sort === "type") return clipTypeConfig(a.clipType).label.localeCompare(clipTypeConfig(b.clipType).label);
      if (sort === "source") return (a.sourceName || "").localeCompare(b.sourceName || "");
      const delta = (Date.parse(a.addedAt) || 0) - (Date.parse(b.addedAt) || 0);
      return sort === "newest" ? -delta : delta;
    });

export const clipMutationPayload = (clip: CoachingCardDetailClip, requestId: string) => ({
  request_id: requestId,
  title: clip.title,
  clip_type: clip.clipType || "coach_added",
  source_url: clip.sourceUrl,
  source_name: clip.sourceName || "",
  source_type: clip.sourceType || "",
  source_media: clip.sourceMedia ?? null,
  start_seconds: clip.startSeconds,
  end_seconds: clip.endSeconds,
  playback_mode: clip.playbackMode || "source",
  source_start_seconds: clip.sourceStartSeconds ?? null,
  period: clip.period || "",
  game_clock: clip.gameClock || "",
  note: clip.note || "",
  tags: clip.tags || [],
  thumbnail: clip.thumbnail,
  stream_id: clip.streamId || "",
  event_id: clip.eventId || "",
  start_segment: clip.startSegment ?? null,
  end_segment: clip.endSegment ?? null,
  ...(clip.playerIds ? { player_ids: clip.playerIds } : {}),
  ...(clip.positionGroupIds ? { position_group_ids: clip.positionGroupIds } : {}),
});

export const isCoachingClipHls = (src: string) => {
  try {
    return /\.m3u8(?:[?#]|$)/i.test(decodeURIComponent(src));
  } catch {
    return /\.m3u8(?:[?#]|$)/i.test(src);
  }
};
