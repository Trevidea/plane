import type { TCoachingCardData } from "@plane/types";

export type CoachingCardDetailClip = {
  key: string;
  slot: number;
  title: string;
  playlistName: string;
  sourceUrl: string;
  thumbnail: string | null;
  startSeconds: number;
  endSeconds: number | null;
  durationSeconds: number | null;
  addedAt: string;
};

const validSeconds = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export const buildCoachingCardClips = (
  card: TCoachingCardData,
  createdAt: string,
  context?: { workspaceSlug: string; projectId: string; apiBaseUrl?: string; uploadedSourceUrl?: string }
): CoachingCardDetailClip[] => {
  const primary = card.primary_clip;
  const addedAt = card.metadata?.created_at || createdAt;
  const clips = (card.playlists ?? []).flatMap((playlist) =>
    (playlist.clips ?? []).map((clip, index): CoachingCardDetailClip => {
      const isPrimary = primary?.playlist_id === playlist.id && primary.clip_id === clip.id;
      const startSeconds =
        validSeconds(isPrimary ? (primary.start_seconds ?? clip.start_seconds) : clip.start_seconds) ?? 0;
      const endSeconds = validSeconds(isPrimary ? (primary.end_seconds ?? clip.end_seconds) : clip.end_seconds);
      return {
        key: JSON.stringify([playlist.id, clip.id, index]),
        slot: 0,
        title: clip.title?.trim() || "Original Clip",
        playlistName: playlist.name,
        sourceUrl:
          (isPrimary ? primary.source_url?.trim() || clip.source_url : clip.source_url)?.trim() ||
          (context && card.source_media?.artifact_id === clip.id
            ? context.uploadedSourceUrl?.trim() ||
              `${(context.apiBaseUrl || "").replace(/\/+$/, "")}/api/workspaces/${encodeURIComponent(context.workspaceSlug)}/projects/${encodeURIComponent(context.projectId)}/media-library/packages/${encodeURIComponent(card.source_media.package_id)}/artifacts/${encodeURIComponent(card.source_media.artifact_id)}/file/`
            : ""),
        thumbnail: clip.thumbnail || (isPrimary ? card.summary?.primary_thumbnail : null) || null,
        startSeconds,
        endSeconds: endSeconds !== null && endSeconds > startSeconds ? endSeconds : null,
        durationSeconds:
          validSeconds(clip.duration_seconds) ??
          (endSeconds !== null && endSeconds > startSeconds ? endSeconds - startSeconds : null),
        addedAt,
      };
    })
  );
  const primaryIndex = (card.playlists ?? [])
    .flatMap((playlist) =>
      (playlist.clips ?? []).map((clip) => primary?.playlist_id === playlist.id && primary.clip_id === clip.id)
    )
    .findIndex(Boolean);
  if (primaryIndex > 0) clips.unshift(...clips.splice(primaryIndex, 1));
  if (primaryIndex < 0 && primary?.source_url?.trim()) {
    const startSeconds = validSeconds(primary.start_seconds) ?? 0;
    const endSeconds = validSeconds(primary.end_seconds);
    clips.unshift({
      key: JSON.stringify([primary.playlist_id, primary.clip_id]),
      slot: 0,
      title: card.summary?.primary_clip_title || "Original Clip",
      playlistName: "",
      sourceUrl: primary.source_url.trim(),
      thumbnail: card.summary?.primary_thumbnail || null,
      startSeconds,
      endSeconds: endSeconds !== null && endSeconds > startSeconds ? endSeconds : null,
      durationSeconds: endSeconds !== null && endSeconds > startSeconds ? endSeconds - startSeconds : null,
      addedAt,
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
  clip: Pick<CoachingCardDetailClip, "startSeconds" | "endSeconds" | "durationSeconds">,
  mediaDuration: number
) => {
  const sourceDuration = Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : null;
  const start = sourceDuration !== null && clip.startSeconds >= sourceDuration ? 0 : clip.startSeconds;
  const requestedEnd = start === clip.startSeconds ? clip.endSeconds : null;
  const end =
    requestedEnd ??
    (clip.durationSeconds !== null && clip.durationSeconds > 0 ? start + clip.durationSeconds : sourceDuration);
  const boundedEnd = sourceDuration !== null && end !== null ? Math.min(end, sourceDuration) : end;
  return { start, end: boundedEnd, duration: boundedEnd !== null ? Math.max(0, boundedEnd - start) : 0 };
};
