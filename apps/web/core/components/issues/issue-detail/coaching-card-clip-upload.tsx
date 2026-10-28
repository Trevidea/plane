import { useEffect, useRef, useState } from "react";
import { MediaLibraryUploadJobRow } from "ce/features/media-library/components/media-library-upload-status";
import {
  MediaLibraryProvider,
  useMediaLibrary,
  useOptionalMediaLibrary,
} from "ce/features/media-library/store/media-library-context";
import { buildArtifactFileUrl } from "ce/features/media-library/utils/media-artifact-url";
import {
  FALLBACK_MEDIA_LIBRARY_MAX_FILE_SIZE,
  formatFileSize,
  getFileExtension,
  isActiveUploadStatus,
  readMediaLibraryFileSizeLimit,
} from "ce/features/media-library/utils/media-library-upload-jobs";
import { UploadCloud } from "lucide-react";
import { Button } from "@plane/ui";
import { useInstance } from "@/hooks/store/use-instance";
import type { CoachingCardDetailClip } from "./coaching-card-clips-model";

type Props = {
  workspaceSlug: string;
  projectId: string;
  disabled: boolean;
  onSelect: (source: Partial<CoachingCardDetailClip>) => void;
  onPendingChange: (pending: boolean) => void;
};

const ClipUpload = ({ workspaceSlug, projectId, disabled, onSelect, onPendingChange }: Props) => {
  const { config } = useInstance();
  const { enqueueUploadBatch, uploadJobs } = useMediaLibrary();
  const [jobId, setJobId] = useState<string>();
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const selectedArtifact = useRef<string>();
  const job = uploadJobs.find((entry) => entry.id === jobId);
  const active = Boolean(job && isActiveUploadStatus(job.status));
  const maxFileSize =
    readMediaLibraryFileSizeLimit(config?.media_library_file_size_limit) ??
    readMediaLibraryFileSizeLimit(process.env.NEXT_PUBLIC_MEDIA_LIBRARY_FILE_SIZE_LIMIT) ??
    FALLBACK_MEDIA_LIBRARY_MAX_FILE_SIZE;
  // A saved artifact can be attached as soon as upload finishes; transcoding is independent.
  const ready = Boolean(job?.artifact?.name && job.packageId);

  useEffect(() => {
    onPendingChange(Boolean(job && !ready));
  }, [job, ready, onPendingChange]);
  useEffect(() => () => onPendingChange(false), [onPendingChange]);
  useEffect(() => {
    if (!ready || !job?.artifact || !job.packageId || selectedArtifact.current === job.artifact.name) return;
    selectedArtifact.current = job.artifact.name;
    onSelect({
      sourceUrl: buildArtifactFileUrl({ workspaceSlug, projectId, packageId: job.packageId }, job.artifact.name),
      sourceName: job.artifact.title,
      sourceMedia: { package_id: job.packageId, artifact_id: job.artifact.name },
      playbackMode: "source",
      startSeconds: 0,
      endSeconds: null,
    });
  }, [ready, job, workspaceSlug, projectId, onSelect]);

  const upload = (file?: File) => {
    if (!file || active || disabled) return;
    if (!["mp4", "mov"].includes(getFileExtension(file.name))) {
      setError("Choose an MP4 or MOV video.");
      return;
    }
    if (!file.size || file.size > maxFileSize) {
      setError(`Choose a non-empty video up to ${formatFileSize(maxFileSize)}.`);
      return;
    }
    setError("");
    const [queued] = enqueueUploadBatch({ workspaceSlug, projectId, files: [file], meta: { source: "web" } });
    if (queued) {
      onPendingChange(true);
      setJobId(queued.id);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-custom-border-200 p-3">
      <input
        ref={input}
        type="file"
        accept=".mp4,.mov,video/mp4,video/quicktime"
        aria-label="Upload video file"
        className="hidden"
        disabled={disabled || active}
        onChange={(event) => {
          upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <Button
        variant="neutral-primary"
        size="sm"
        type="button"
        disabled={disabled || active}
        onClick={() => input.current?.click()}
      >
        <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
        Upload new video
      </Button>
      <p className="text-xs text-custom-text-300">
        MP4 or MOV · Up to {formatFileSize(maxFileSize)}. Saved to this program’s media library.
      </p>
      {job && <MediaLibraryUploadJobRow job={job} />}
      {job?.status === "processing" && (
        <p role="status" className="text-xs text-custom-text-300">
          Upload complete. You can add this clip while video processing continues in the background.
        </p>
      )}
      {job && !active && !ready && (
        <Button variant="link-primary" size="sm" type="button" onClick={() => setJobId(undefined)}>
          Use current video
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
};

// Coaching cards can also open from workspace views outside the project layout.
export const CoachingCardClipUpload = (props: Props) => {
  const library = useOptionalMediaLibrary();
  return library ? (
    <ClipUpload {...props} />
  ) : (
    <MediaLibraryProvider>
      <ClipUpload {...props} />
    </MediaLibraryProvider>
  );
};
