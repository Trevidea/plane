import useSWR from "swr";
import type { TMediaItem } from "ce/features/media-library/types/media-library.types";
import { mapArtifactsToMediaItems } from "ce/features/media-library/utils/media-items";
import { MediaLibraryService } from "@/services/media-library.service";
import type { CoachingCardDetailClip } from "./coaching-card-clips-model";

const mediaService = new MediaLibraryService();

// Shared by the selected player and each thumbnail; SWR deduplicates requests for the same video.
export const useCoachingClipMedia = (
  workspaceSlug: string,
  projectId: string,
  source?: CoachingCardDetailClip["sourceMedia"]
) =>
  useSWR<TMediaItem | null>(
    source ? ["coaching-clip-media", workspaceSlug, projectId, source.package_id, source.artifact_id] : null,
    async () => {
      if (!source) return null;
      const load = async () => {
        const [manifest, artifacts] = await Promise.all([
          mediaService.ensureProjectLibrary(workspaceSlug, projectId),
          mediaService.getArtifactDetail(workspaceSlug, projectId, source.package_id, source.artifact_id),
        ]);
        const entries = Array.isArray(artifacts) ? artifacts : [];
        const artifact = entries.find((entry) => entry.name === source.artifact_id);
        const item = mapArtifactsToMediaItems(entries, {
          workspaceSlug,
          projectId,
          packageId: source.package_id,
          metadata: manifest?.metadata,
          groupBatches: false,
        }).find((entry) => entry.id === source.artifact_id);
        return { item, artifact };
      };
      const { item, artifact } = await load();
      if (!item) return null;
      const jobId = item.transcodeJobId || artifact?.transcode_job?.job_id;
      if (item.isTranscodeComplete || !jobId || (!item.isTranscodeActive && !artifact?.transcode_job)) return item;
      let job;
      try {
        job = await mediaService.getArtifactTranscodeJob(
          workspaceSlug,
          projectId,
          source.package_id,
          source.artifact_id,
          jobId
        );
      } catch {
        // Metadata still provides a useful status while the job service is temporarily unavailable.
        return item;
      }
      const complete = ["COMPLETED", "READY", "UPLOADED"].includes(job.status);
      const failed = ["FAILED", "QUEUE_FAILED", "CANCELLED"].includes(job.status);
      const refreshed = complete ? (await load()).item || item : item;
      return {
        ...refreshed,
        videoSrc: complete ? job.playable_url || refreshed.videoSrc : refreshed.videoSrc,
        transcodeStatus: job.status,
        transcodeProgress: complete
          ? 100
          : Math.min(100, Math.max(0, Math.round(job.progress ?? item.transcodeProgress ?? 0))),
        transcodeLabel: complete
          ? "Ready"
          : failed
            ? "Processing failed"
            : job.status === "QUEUED"
              ? "Queued"
              : "Processing",
        transcodeError: job.error?.message || job.error?.code || item.transcodeError,
        isTranscodeActive: !complete && !failed,
        isTranscodeComplete: complete,
        isTranscodeFailed: failed,
      };
    },
    {
      refreshInterval: (item) => (item?.isTranscodeActive ? 3000 : 0),
      errorRetryInterval: 5000,
      dedupingInterval: 1000,
      revalidateOnFocus: true,
    }
  );
