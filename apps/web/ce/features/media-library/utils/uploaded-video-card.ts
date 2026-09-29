import type { TCustomPlaylist } from "@/services/media-library.service";
import type { TMediaItem } from "../types/media-library.types";

export const hasValidVideoAnnotations = (annotations: unknown): boolean =>
  annotations == null ||
  (Array.isArray(annotations) &&
    annotations.every(
      (annotation) =>
        annotation &&
        typeof annotation === "object" &&
        typeof annotation.id === "string" &&
        annotation.id.trim().length > 0 &&
        typeof annotation.type === "string" &&
        annotation.type.trim().length > 0 &&
        Number.isFinite(annotation.startTime) &&
        annotation.startTime >= 0 &&
        Number.isFinite(annotation.endTime) &&
        annotation.endTime > annotation.startTime
    ));

export const canCreateUploadedVideoCard = (state: {
  isVideo: boolean;
  isEvent: boolean;
  packageId?: string;
  artifactId?: string;
  annotations: unknown;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  isRecording: boolean;
}): boolean =>
  state.isVideo &&
  !state.isEvent &&
  Boolean(state.packageId && state.artifactId) &&
  hasValidVideoAnnotations(state.annotations) &&
  !state.hasUnsavedChanges &&
  !state.isSaving &&
  !state.isRecording;

export const buildUploadedVideoCardPlaylist = (
  item: Pick<TMediaItem, "id" | "title" | "thumbnail" | "videoSrc">,
  durationSeconds: number | null
): TCustomPlaylist => {
  const title = item.title.trim() || "Uploaded video";
  return {
    id: `uploaded-video:${item.id}`,
    event_id: "",
    name: title,
    url: item.videoSrc ?? "",
    thumbnail: item.thumbnail || null,
    clip: 1,
    clips: [
      {
        id: item.id,
        title,
        thumbnail: item.thumbnail || null,
        durationSeconds:
          durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : null,
      },
    ],
  };
};
