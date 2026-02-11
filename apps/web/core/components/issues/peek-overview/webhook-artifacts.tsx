"use client";

import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import { Copy, ExternalLink, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { copyUrlToClipboard } from "@plane/utils";

import { MediaLibraryService } from "@/services/media-library.service";
import type { TMediaArtifact } from "@/services/media-library.service";

type TWebhookArtifactMediaType = "video" | "image" | "document";

type TWebhookArtifact = {
  id: string;
  title: string;
  format: string;
  action: string;
  path: string;
  openUrl: string;
  mediaType: TWebhookArtifactMediaType;
};

type PeekOverviewWebhookArtifactsProps = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  onVideoModalOpenChange?: (isOpen: boolean) => void;
};

const VIDEO_ARTIFACT_FORMATS = new Set([
  "mov",
  "webm",
  "avi",
  "mkv",
  "mpeg",
  "mpg",
  "m4v",
  "mp4",
  "m3u8",
  "stream",
]);
const IMAGE_ARTIFACT_FORMATS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

const VIDEO_ARTIFACT_ACTIONS = new Set(["play", "stream", "play_hls", "play_streaming", "open_mp4"]);
const IMAGE_ARTIFACT_ACTIONS = new Set(["open_image", "view_image"]);
const HLS_MIME_TYPES = ["application/x-mpegURL", "application/vnd.apple.mpegurl"] as const;

type TVideoSourceCandidate = {
  src: string;
  type?: string;
  withCredentials: boolean;
  crossOrigin: "anonymous" | "use-credentials";
};

const inferFormatFromPath = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  const withoutQuery = normalized.split("?")[0].split("#")[0];
  const fileName = withoutQuery.split("/").pop() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1);
};

const resolveWebhookArtifactType = (format: string, action: string, path: string, openUrl: string): TWebhookArtifactMediaType => {
  const normalizedFormat = format.toLowerCase().trim();
  const normalizedAction = action.toLowerCase().trim();
  const inferredFormat = inferFormatFromPath(path) || inferFormatFromPath(openUrl);

  if (
    VIDEO_ARTIFACT_FORMATS.has(normalizedFormat) ||
    VIDEO_ARTIFACT_ACTIONS.has(normalizedAction) ||
    inferredFormat === "m3u8" ||
    openUrl.toLowerCase().includes(".m3u8")
  ) {
    return "video";
  }

  if (
    IMAGE_ARTIFACT_FORMATS.has(normalizedFormat) ||
    IMAGE_ARTIFACT_ACTIONS.has(normalizedAction) ||
    IMAGE_ARTIFACT_FORMATS.has(inferredFormat)
  ) {
    return "image";
  }

  return "document";
};

const getVideoMimeType = (format: string) => {
  const normalized = format.toLowerCase();
  if (normalized === "mp4" || normalized === "m4v") return "video/mp4";
  if (normalized === "m3u8" || normalized === "stream") return "application/x-mpegURL";
  if (normalized === "mov") return "video/quicktime";
  if (normalized === "webm") return "video/webm";
  if (normalized === "avi") return "video/x-msvideo";
  if (normalized === "mkv") return "video/x-matroska";
  if (normalized === "mpeg" || normalized === "mpg") return "video/mpeg";
  return "";
};

const getCredentialModeForSource = (source: string) => {
  if (typeof window === "undefined") {
    return {
      withCredentials: true,
      crossOrigin: "use-credentials" as const,
    };
  }

  if (!source || source.startsWith("/")) {
    return {
      withCredentials: true,
      crossOrigin: "use-credentials" as const,
    };
  }

  try {
    const parsed = new URL(source, window.location.origin);
    const isSameOrigin = parsed.origin === window.location.origin;
    return {
      withCredentials: isSameOrigin,
      crossOrigin: isSameOrigin ? ("use-credentials" as const) : ("anonymous" as const),
    };
  } catch {
    return {
      withCredentials: true,
      crossOrigin: "use-credentials" as const,
    };
  }
};

const dedupeSourceCandidates = (candidates: TVideoSourceCandidate[]) => {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.src}|${candidate.type ?? ""}|${candidate.withCredentials ? "1" : "0"}|${candidate.crossOrigin}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const buildSourceCandidates = (rawSource: string, isHlsStream: boolean, format: string): TVideoSourceCandidate[] => {
  const trimmed = rawSource.trim();
  if (!trimmed) return [];

  let directSource = trimmed;
  let proxiedSource = "";
  let isMixedContentBlocked = false;

  if (typeof window !== "undefined" && !trimmed.startsWith("/")) {
    try {
      const parsed = new URL(trimmed, window.location.origin);
      const absolute = parsed.toString();
      const isCrossOrigin = parsed.origin !== window.location.origin;
      isMixedContentBlocked = window.location.protocol === "https:" && parsed.protocol === "http:";

      directSource = absolute;
      if (isHlsStream && isCrossOrigin) {
        proxiedSource = `/api/hls?url=${encodeURIComponent(absolute)}`;
        if (isMixedContentBlocked) {
          directSource = "";
        }
      }
    } catch {
      directSource = trimmed;
      proxiedSource = "";
    }
  }

  const candidates: TVideoSourceCandidate[] = [];
  const appendSource = (source: string, type?: string) => {
    if (!source) return;
    const { withCredentials, crossOrigin } = getCredentialModeForSource(source);
    candidates.push({
      src: source,
      type,
      withCredentials,
      crossOrigin,
    });
  };

  if (isHlsStream) {
    if (!isMixedContentBlocked && directSource) {
      HLS_MIME_TYPES.forEach((type) => appendSource(directSource, type));
    }
    if (proxiedSource) {
      HLS_MIME_TYPES.forEach((type) => appendSource(proxiedSource, type));
    }
    if (isMixedContentBlocked && directSource) {
      HLS_MIME_TYPES.forEach((type) => appendSource(directSource, type));
    }
  } else {
    const type = getVideoMimeType(format) || undefined;
    appendSource(directSource, type);
  }

  return dedupeSourceCandidates(candidates);
};

const resolveManifestMeta = (
  artifact: TMediaArtifact,
  metadata: Record<string, Record<string, unknown>> | undefined
) => {
  const direct = artifact.meta;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  const metadataRef = artifact.metadata_ref || artifact.name;
  if (!metadataRef || !metadata || typeof metadata !== "object") return {};
  const resolved = metadata[metadataRef];
  if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) return resolved;
  return {};
};

const toTimestamp = (value: string | undefined) => {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
};

const resolveOpenUrl = (
  path: string,
  workspaceSlug: string,
  projectId: string,
  packageId: string,
  artifactId: string
) => {
  const trimmed = path.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;

  const endpoint = `/api/workspaces/${workspaceSlug}/projects/${projectId}/media-library/packages/${packageId}/artifacts/${encodeURIComponent(
    artifactId
  )}/file/`;

  if (typeof window === "undefined") return endpoint;

  try {
    return new URL(endpoint, window.location.origin).toString();
  } catch {
    return endpoint;
  }
};

export const PeekOverviewWebhookArtifacts: FC<PeekOverviewWebhookArtifactsProps> = observer((props) => {
  const { workspaceSlug, projectId, issueId, onVideoModalOpenChange } = props;
  const mediaLibraryService = useMemo(() => new MediaLibraryService(), []);
  const [artifacts, setArtifacts] = useState<TWebhookArtifact[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<TWebhookArtifact | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const loadWebhookArtifacts = async () => {
      if (!workspaceSlug || !projectId || !issueId) {
        if (!isCancelled) setArtifacts([]);
        return;
      }

      if (!isCancelled) {
        setArtifacts([]);
      }
      try {
        const manifest = await mediaLibraryService.ensureProjectLibrary(workspaceSlug, projectId);
        const packageId = typeof manifest?.id === "string" ? manifest.id : "";
        if (!packageId) {
          if (!isCancelled) setArtifacts([]);
          return;
        }

        const manifestArtifacts: TMediaArtifact[] = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
        const manifestMetadata =
          manifest && typeof manifest === "object" && manifest.metadata && typeof manifest.metadata === "object"
            ? (manifest.metadata as Record<string, Record<string, unknown>>)
            : undefined;

        const nextArtifacts = manifestArtifacts
          .filter((artifact) => {
            const name = artifact.name?.trim() ?? "";
            if (!name) return false;

            const format = (artifact.format || "").toLowerCase();
            if (format === "thumbnail") return false;

            const meta = resolveManifestMeta(artifact, manifestMetadata);
            const source = typeof meta.source === "string" ? meta.source.toLowerCase().trim() : "";
            if (source !== "webhook") return false;

            const artifactWorkItemId = artifact.work_item_id ?? "";
            const metaWorkItemId = typeof meta.work_item_id === "string" ? meta.work_item_id : "";
            if (artifactWorkItemId) return artifactWorkItemId === issueId;
            if (metaWorkItemId) return metaWorkItemId === issueId;
            return false;
          })
          .sort(
            (a, b) =>
              toTimestamp((b.updated_at as string) || (b.created_at as string)) -
              toTimestamp((a.updated_at as string) || (a.created_at as string))
          )
          .map((artifact) => {
            const name = artifact.name ?? "";
            const title = artifact.title?.trim() ? artifact.title : name || "Webhook asset";
            const action = artifact.action || "";
            const path = artifact.path || "";
            const openUrl = resolveOpenUrl(path, workspaceSlug, projectId, packageId, name);
            const inferredFormat = inferFormatFromPath(path) || inferFormatFromPath(openUrl) || "file";
            const format = (artifact.format || inferredFormat || "file").toLowerCase();
            const mediaType = resolveWebhookArtifactType(format, action, path, openUrl);

            return {
              id: name || `${title}-${openUrl}`,
              title,
              format,
              action,
              path: path || openUrl,
              openUrl,
              mediaType,
            };
          });

        if (!isCancelled) {
          setArtifacts(nextArtifacts);
        }
      } catch {
        if (!isCancelled) {
          setArtifacts([]);
        }
      }
    };

    void loadWebhookArtifacts();

    return () => {
      isCancelled = true;
    };
  }, [issueId, mediaLibraryService, projectId, workspaceSlug]);

  const handleCopyPath = useCallback((value: string) => {
    copyUrlToClipboard(value)
      .then(() => {
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Path copied",
          message: "Artifact path copied to clipboard.",
        });
      })
      .catch(() => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Copy failed",
          message: "Unable to copy artifact path.",
        });
      });
  }, []);

  const handleOpenArtifactModal = useCallback(
    (artifact: TWebhookArtifact) => {
      onVideoModalOpenChange?.(true);
      setActiveArtifact(artifact);
    },
    [onVideoModalOpenChange]
  );

  const handleCloseArtifactModal = useCallback(() => {
    onVideoModalOpenChange?.(false);
    setActiveArtifact(null);
  }, [onVideoModalOpenChange]);

  useEffect(
    () => () => {
      onVideoModalOpenChange?.(false);
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    },
    [onVideoModalOpenChange]
  );

  useEffect(() => {
    if (activeArtifact?.mediaType !== "video" || !videoElement) {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
      return;
    }

    const mountedVideoElement: HTMLVideoElement = videoElement;
    const rawSource = activeArtifact.openUrl.trim();
    if (!rawSource) return;

    const normalizedFormat = activeArtifact.format.toLowerCase().trim();
    const normalizedAction = activeArtifact.action.toLowerCase().trim();
    const normalizedSource = rawSource.toLowerCase();
    const normalizedPath = activeArtifact.path.toLowerCase();
    const isHlsStream =
      normalizedFormat === "m3u8" ||
      normalizedFormat === "stream" ||
      normalizedAction === "play_hls" ||
      normalizedAction === "play_streaming" ||
      normalizedAction === "stream" ||
      normalizedSource.includes(".m3u8") ||
      normalizedPath.includes(".m3u8");

    const sourceCandidates = buildSourceCandidates(rawSource, isHlsStream, normalizedFormat);
    if (sourceCandidates.length === 0) return;

    let candidateIndex = 0;
    let isDisposed = false;
    let sourceStartupTimer: ReturnType<typeof setTimeout> | null = null;

    function switchToCandidate(nextIndex: number) {
      if (isDisposed || nextIndex < 0 || nextIndex >= sourceCandidates.length) return;
      const nextCandidate = sourceCandidates[nextIndex];

      if (playerRef.current) {
        playerRef.current.off("error", handlePlayerError);
        playerRef.current.dispose();
        playerRef.current = null;
      }

      const player = videojs(mountedVideoElement, {
        controls: true,
        preload: "auto",
        autoplay: false,
        fluid: true,
        responsive: true,
        playsinline: true,
        crossOrigin: nextCandidate.crossOrigin,
        html5: {
          vhs: {
            withCredentials: nextCandidate.withCredentials,
            overrideNative: true,
          },
        },
      });

      playerRef.current = player;
      player.on("error", handlePlayerError);
      player.one("loadeddata", () => {
        if (sourceStartupTimer) {
          clearTimeout(sourceStartupTimer);
          sourceStartupTimer = null;
        }
      });
      player.src(nextCandidate.type ? { src: nextCandidate.src, type: nextCandidate.type } : { src: nextCandidate.src });
      player.load();
      const playAttempt = player.play();
      if (playAttempt && typeof playAttempt.catch === "function") {
        void playAttempt.catch(() => {
          // Ignore autoplay failures and let the user start playback manually.
        });
      }

      if (sourceStartupTimer) {
        clearTimeout(sourceStartupTimer);
      }
      sourceStartupTimer = setTimeout(() => {
        if (isDisposed) return;
        const currentPlayer = playerRef.current;
        if (!currentPlayer) return;
        const duration = currentPlayer.duration();
        const hasMetadata = typeof duration === "number" && Number.isFinite(duration) && duration > 0;
        if (!hasMetadata) {
          handlePlayerError();
        }
      }, 8000);
    }

    function handlePlayerError() {
      if (sourceStartupTimer) {
        clearTimeout(sourceStartupTimer);
        sourceStartupTimer = null;
      }
      const nextIndex = candidateIndex + 1;
      if (nextIndex >= sourceCandidates.length) {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Unable to preview video",
          message: "No compatible source was found for this artifact.",
        });
        return;
      }

      candidateIndex = nextIndex;
      switchToCandidate(candidateIndex);
    }

    switchToCandidate(candidateIndex);

    return () => {
      isDisposed = true;
      if (sourceStartupTimer) {
        clearTimeout(sourceStartupTimer);
        sourceStartupTimer = null;
      }
      if (playerRef.current) {
        playerRef.current.off("error", handlePlayerError);
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [activeArtifact, videoElement]);

  if (artifacts.length === 0) return <></>;

  return (
    <div className="space-y-2">
      {artifacts.map((artifact) => (
        <div
          key={artifact.id}
          className="group rounded-lg border border-custom-border-200 bg-custom-background-90 px-3 py-2.5 transition-colors hover:border-custom-border-300"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-custom-text-100">{artifact.title}</p>
              <p className="text-[11px] uppercase tracking-wide text-custom-text-300">
                {artifact.mediaType} {artifact.format ? `• ${artifact.format}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleOpenArtifactModal(artifact)}
                className="rounded p-1.5 text-custom-text-300 transition-colors hover:bg-custom-background-100 hover:text-custom-text-100"
                title="Open preview"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleCopyPath(artifact.path)}
                className="rounded p-1.5 text-custom-text-300 transition-colors hover:bg-custom-background-100 hover:text-custom-text-100"
                title="Copy path"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <p className="break-all rounded-md bg-custom-background-100 px-2 py-1.5 text-xs leading-5 text-custom-text-300">
            {artifact.path}
          </p>
        </div>
      ))}

      <ModalCore
        isOpen={Boolean(activeArtifact)}
        handleClose={handleCloseArtifactModal}
        position={EModalPosition.CENTER}
        width={EModalWidth.XXXXL}
        className="overflow-hidden p-0"
      >
        <div
          data-prevent-outside-click
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-custom-border-200 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-custom-text-100">{activeArtifact?.title ?? "Artifact"}</p>
              <p className="text-[11px] uppercase tracking-wide text-custom-text-300">
                {activeArtifact?.mediaType ?? "preview"} {activeArtifact?.format ? `• ${activeArtifact.format}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCloseArtifactModal}
              className="rounded p-1.5 text-custom-text-300 transition-colors hover:bg-custom-background-90 hover:text-custom-text-100"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3 p-4">
            {activeArtifact?.mediaType === "video" && (
              <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
                <div data-vjs-player className="h-full w-full">
                  <video ref={setVideoElement} className="video-js vjs-default-skin h-full w-full" playsInline preload="auto" />
                </div>
              </div>
            )}

            {activeArtifact?.mediaType === "image" && (
              <div className="flex min-h-[420px] max-h-[70vh] w-full items-center justify-center overflow-hidden rounded-md bg-black/80 p-2">
                <img
                  src={activeArtifact.openUrl}
                  alt={activeArtifact.title}
                  className="max-h-[68vh] w-auto max-w-full object-contain"
                  loading="lazy"
                />
              </div>
            )}

            {activeArtifact?.mediaType === "document" && (
              <div className="h-[70vh] w-full overflow-hidden rounded-md border border-custom-border-200 bg-custom-background-100">
                <iframe
                  src={activeArtifact.openUrl}
                  title={activeArtifact.title}
                  className="h-full w-full"
                  loading="lazy"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <p className="break-all rounded-md bg-custom-background-90 px-2 py-1.5 text-xs leading-5 text-custom-text-300">
                {activeArtifact?.path}
              </p>
              <a
                href={activeArtifact?.openUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-md border border-custom-border-200 px-2 py-1.5 text-xs text-custom-text-200 hover:text-custom-text-100"
              >
                Open file
              </a>
            </div>
          </div>
        </div>
      </ModalCore>
    </div>
  );
});
