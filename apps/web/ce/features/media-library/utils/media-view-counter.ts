export type TMediaPlaybackViewEvent = {
  eventType: string;
  isVideo: boolean;
  packageId?: string | null;
  artifactId?: string | null;
  alreadyRecorded?: boolean;
};

const hasValue = (value?: string | null) => typeof value === "string" && value.trim().length > 0;

export const shouldRecordMediaPlaybackView = ({
  eventType,
  isVideo,
  packageId,
  artifactId,
  alreadyRecorded,
}: TMediaPlaybackViewEvent) =>
  eventType === "playing" && isVideo && hasValue(packageId) && hasValue(artifactId) && !alreadyRecorded;

export const buildMediaViewStorageKey = ({
  workspaceSlug,
  projectId,
  packageId,
  artifactId,
}: {
  workspaceSlug: string;
  projectId: string;
  packageId: string;
  artifactId: string;
}) => `media-view:${workspaceSlug}:${projectId}:${packageId}:${artifactId}`;
