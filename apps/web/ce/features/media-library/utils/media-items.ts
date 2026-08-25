"use client";

import { API_BASE_URL } from "@plane/constants";
import { renderWorkspaceDate } from "@plane/utils";

import type { TMediaArtifact } from "@/services/media-library.service";
import type { TMediaItem, TMediaSection } from "../types/media-library.types";
import { getDisplayMediaTitle } from "./media-detail-utils";
import { formatMediaDurationLabel } from "./media-duration";
import { getEventMediaContextLabel, getEventMediaDateLabel, getEventMediaDetails } from "./media-event";

type TArtifactContext = {
  workspaceSlug: string;
  projectId: string;
  packageId: string;
  metadata?: Record<string, Record<string, unknown>>;
  dateFormat?: string | null;
  groupBatches?: boolean;
};

const VIDEO_FORMATS = new Set(["mp4", "m3u8", "mov", "webm", "avi", "mkv", "mpeg", "mpg", "m4v"]);
const IMAGE_FORMATS = new Set([
  "jpg",
  "jpeg",
  "png",
  "svg",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "avif",
  "heic",
  "heif",
  "thumbnail",
]);
const GENERIC_FORMAT_VALUES = new Set([
  "application/octet-stream",
  "application",
  "video",
  "image",
  "binary",
  "octet-stream",
]);
const FORMAT_OVERRIDES: Record<string, string> = {
  "application/vnd.apple.mpegurl": "m3u8",
  "application/x-mpegurl": "m3u8",
  "video/quicktime": "mov",
  "video/x-quicktime": "mov",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
  "image/svg+xml": "svg",
};
const VIDEO_ACTIONS = new Set(["play", "play_hls", "play_streaming", "open_mp4"]);
const DOCUMENT_THUMBNAILS: Record<string, string> = {
  pdf: "attachment/pdf-icon.png",
  doc: "attachment/doc-icon.png",
  docx: "attachment/doc-icon.png",
  xls: "attachment/excel-icon.png",
  xlsx: "attachment/excel-icon.png",
  csv: "attachment/csv-icon.png",
  txt: "attachment/txt-icon.png",
  json: "attachment/txt-icon.png",
  md: "attachment/txt-icon.png",
  log: "attachment/txt-icon.png",
  xml: "attachment/txt-icon.png",
  yml: "attachment/txt-icon.png",
  yaml: "attachment/txt-icon.png",
  html: "attachment/html-icon.png",
  css: "attachment/css-icon.png",
};
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const THUMBNAIL_HINT_KEYS = ["thumbnail", "thumbnail_url", "thumbnailUrl", "poster", "poster_url", "posterUrl"];
const ACTIVE_TRANSCODE_STATUSES = new Set([
  "UPLOAD_COMPLETE",
  "QUEUED",
  "CLAIMED",
  "PROBING",
  "PROCESSING",
  "TRANSCODING",
  "PACKAGING",
  "VALIDATING",
  "RETRY_PENDING",
]);
const FAILED_TRANSCODE_STATUSES = new Set(["FAILED", "QUEUE_FAILED", "CANCELLED"]);

const resolveArtifactPath = (path: string) => {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `/${path.replace(/^\/+/, "")}`;
};

const joinApiPath = (base: string, path: string) => `${base?.replace(/\/$/, "") ?? ""}${path}`;

const buildArtifactFileUrl = (context: TArtifactContext, artifactName: string) =>
  joinApiPath(
    API_BASE_URL,
    `/api/workspaces/${context.workspaceSlug}/projects/${context.projectId}/media-library/packages/${context.packageId}/artifacts/${encodeURIComponent(
      artifactName
    )}/file/`
  );

const resolveArtifactSource = (artifact: TMediaArtifact, context?: TArtifactContext) => {
  const rawPath = artifact.path ?? "";
  if (rawPath && /^https?:\/\//i.test(rawPath)) return rawPath;
  const action = (artifact.action ?? "").toLowerCase();
  if (rawPath && action === "play_hls") return resolveArtifactPath(rawPath);
  if (context && artifact.name) {
    return buildArtifactFileUrl(context, artifact.name);
  }
  return resolveArtifactPath(rawPath);
};

const formatDateLabel = (value: string, dateFormat?: string | null) => renderWorkspaceDate(value, dateFormat) ?? value;

const getMetaObject = (meta: unknown) => {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  return {};
};

const resolveArtifactMeta = (artifact: TMediaArtifact, metadata?: Record<string, Record<string, unknown>>) => {
  const directMeta = getMetaObject(artifact.meta);
  if (Object.keys(directMeta).length > 0) return directMeta;
  const ref = (artifact.metadata_ref ?? "").trim() || artifact.name;
  return getMetaObject(metadata?.[ref]);
};

const getMetaString = (meta: Record<string, unknown>, keys: string[], fallback = "") => {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
};

const getArtifactWorkItemId = (artifact: TMediaArtifact, meta: Record<string, unknown>) => {
  const rawArtifactWorkItemId = artifact.work_item_id;
  const artifactWorkItemId =
    typeof rawArtifactWorkItemId === "string"
      ? rawArtifactWorkItemId.trim()
      : rawArtifactWorkItemId
        ? String(rawArtifactWorkItemId).trim()
        : "";
  if (artifactWorkItemId) return artifactWorkItemId;
  return getMetaString(meta, ["work_item_id", "workItemId"], "").trim();
};

const getMetaNumber = (meta: Record<string, unknown>, keys: string[], fallback = 0) => {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return fallback;
};

const getMetaBoolean = (meta: Record<string, unknown>, keys: string[], fallback = false) => {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes"].includes(normalized)) return true;
      if (["0", "false", "no"].includes(normalized)) return false;
    }
  }
  return fallback;
};

const hasAnnotationList = (value: unknown) => Array.isArray(value) && value.length > 0;

const hasAnnotationsInMediaReferences = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false;

  return value.some((entry) => {
    const reference = getMetaObject(entry);
    return (
      hasAnnotationList(reference.annotations) ||
      hasAnnotationsInMediaReferences(reference.mediaReferences) ||
      hasAnnotationsInMediaReferences(reference.media_references) ||
      hasAnnotationsInMediaReferences(reference.devices)
    );
  });
};

const hasSavedVideoAnnotations = (meta: Record<string, unknown>) => {
  const sources = [meta, getMetaObject(meta.event), getMetaObject(meta.rawEvent ?? meta.raw_event)];

  return sources.some(
    (source) =>
      hasAnnotationList(source.annotations) ||
      hasAnnotationsInMediaReferences(source.mediaReferences) ||
      hasAnnotationsInMediaReferences(source.media_references) ||
      hasAnnotationsInMediaReferences(source.devices)
  );
};

const getTranscodeLabel = (status: string) => {
  switch (status) {
    case "UPLOAD_COMPLETE":
    case "QUEUED":
      return "Queued";
    case "CLAIMED":
    case "PROBING":
    case "PROCESSING":
    case "TRANSCODING":
    case "PACKAGING":
    case "VALIDATING":
    case "RETRY_PENDING":
      return "Uploading";
    case "COMPLETED":
    case "READY":
    case "UPLOADED":
      return "Uploaded";
    case "CANCELLED":
      return "Cancelled";
    case "QUEUE_FAILED":
    case "FAILED":
      return "Failed";
    default:
      return status ? status.replace(/_/g, " ").toLowerCase() : "";
  }
};

const getTranscodeState = (meta: Record<string, unknown>) => {
  const status = getMetaString(meta, ["transcode_status"], "").trim().toUpperCase();
  const progress = Math.min(100, Math.max(0, Math.round(getMetaNumber(meta, ["transcode_progress"], 0))));
  const hlsPending = getMetaBoolean(meta, ["hls_pending", "hlsPending"], false);
  const isComplete =
    status === "COMPLETED" ||
    status === "READY" ||
    status === "UPLOADED" ||
    (!hlsPending && Boolean(getMetaString(meta, ["hls_master_playlist"], "")));
  const isFailed = FAILED_TRANSCODE_STATUSES.has(status);
  const isActive = !isComplete && !isFailed && (hlsPending || ACTIVE_TRANSCODE_STATUSES.has(status));
  const error = getMetaString(meta, ["transcode_error"], "");
  return {
    transcodeStatus: status || undefined,
    transcodeJobId: getMetaString(meta, ["transcode_job_id"], "") || undefined,
    transcodeAssetId: getMetaString(meta, ["transcode_asset_id"], "") || undefined,
    transcodeProgress: isComplete ? 100 : progress,
    transcodeLabel: status ? getTranscodeLabel(status) : hlsPending ? "Uploading" : undefined,
    transcodeError: error || undefined,
    isTranscodeActive: isActive,
    isTranscodeFailed: isFailed,
    isTranscodeComplete: isComplete,
  };
};

const getMetaStringArray = (meta: Record<string, unknown>, key: string) => {
  const value = meta[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
};

const getMetaDuration = (meta: Record<string, unknown>, keys: string[], fallback = "") => {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" || typeof value === "number") {
      const duration = formatMediaDurationLabel(value);
      if (duration) return duration;
    }
  }
  return fallback;
};

const getFormatFromPath = (value?: string) => {
  const rawValue = value?.trim();
  if (!rawValue) return "";
  const withoutQuery = rawValue.split("?")[0].split("#")[0];
  const fileName = withoutQuery.split("/").pop() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1).toLowerCase();
};

const containsHtmlTags = (value: string) => /<\/?[a-z][^>]*>/i.test(value);

const decodeHtmlEntities = (value: string) => {
  if (!value) return "";
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized === "nbsp") return " ";
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    if (normalized.startsWith("#x")) {
      const code = Number.parseInt(normalized.slice(2), 16);
      if (!Number.isFinite(code)) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    if (normalized.startsWith("#")) {
      const code = Number.parseInt(normalized.slice(1), 10);
      if (!Number.isFinite(code)) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    return "";
  });
};

const htmlToPlainText = (value: string) => {
  if (!value) return "";
  if (!containsHtmlTags(value)) return value.trim();
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|blockquote|pre)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};

const inferFormatFromPaths = (...paths: Array<string | null | undefined>) => {
  for (const path of paths) {
    if (!path) continue;
    const inferred = getFormatFromPath(path);
    if (inferred) return inferred;
  }
  return "";
};

const normalizeFormat = (value: string | null | undefined, ...fallbackPaths: Array<string | null | undefined>) => {
  const rawValue = (value ?? "").trim().toLowerCase();
  const cleaned = rawValue.replace(/^\./, "");
  if (cleaned) {
    const override = FORMAT_OVERRIDES[cleaned];
    if (override) return override;
    if (GENERIC_FORMAT_VALUES.has(cleaned)) {
      return inferFormatFromPaths(...fallbackPaths);
    }
    if (cleaned.includes("/")) {
      const [, subtype = ""] = cleaned.split("/");
      if (subtype === "vnd.apple.mpegurl" || subtype === "x-mpegurl" || subtype === "mpegurl") return "m3u8";
      if (subtype === "quicktime") return "mov";
      if (subtype === "x-matroska") return "mkv";
      if (subtype === "x-msvideo") return "avi";
      if (subtype === "svg+xml") return "svg";
      return subtype.replace(/^x-/, "");
    }
    return cleaned;
  }
  return inferFormatFromPaths(...fallbackPaths);
};

const getMediaType = (format: string, rawFormat = "", action = ""): TMediaItem["mediaType"] => {
  if (format === "collection" || action === "open_collection") return "collection";
  if (VIDEO_FORMATS.has(format)) return "video";
  if (IMAGE_FORMATS.has(format)) return "image";
  const normalizedRaw = rawFormat.trim().toLowerCase();
  if (normalizedRaw.startsWith("video/") || normalizedRaw === "video" || normalizedRaw.includes("mpegurl")) {
    return "video";
  }
  if (normalizedRaw.startsWith("image/") || normalizedRaw === "image") return "image";
  if (VIDEO_ACTIONS.has(action.trim().toLowerCase())) return "video";
  return "document";
};

export const getDocumentThumbnailPath = (format?: string) => {
  const key = (format ?? "").toLowerCase();
  return DOCUMENT_THUMBNAILS[key] ?? "attachment/default-icon.png";
};

const getPlaneCoachThumbnailPath = () => "attachment/video-icon.png";

export const resolveMediaItemActionHref = (item: TMediaItem) => {
  const action = (item.action ?? "").toLowerCase();

  if (item.mediaType === "collection") return item.collectionHref ?? null;
  if (item.mediaType === "video" || VIDEO_ACTIONS.has(action)) return null;
  if (action === "open_pdf" && item.fileSrc) {
    return `/viewer?src=${encodeURIComponent(item.fileSrc)}&type=pdf`;
  }
  if ((action === "download" || action === "view") && item.fileSrc) {
    return item.fileSrc;
  }

  return null;
};

const getUploadBatchId = (item: TMediaItem) => {
  const value = item.meta?.upload_batch_id ?? item.meta?.uploadBatchId;
  return typeof value === "string" && value.trim() ? value.trim() : "";
};

const getUploadBatchName = (item: TMediaItem) => {
  const value = item.meta?.upload_batch_name ?? item.meta?.uploadBatchName;
  return typeof value === "string" && value.trim() ? value.trim() : "Upload";
};

const getUploadBatchSize = (item: TMediaItem) => {
  const value = item.meta?.upload_batch_size ?? item.meta?.uploadBatchSize;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const getUploadBatchStatus = (items: TMediaItem[]) => {
  if (items.some((item) => item.isTranscodeFailed || item.transcodeLabel === "Failed")) return "Partially Failed";
  if (items.some((item) => item.isTranscodeActive)) return "Processing";
  if (items.some((item) => item.transcodeStatus === "UPLOAD_COMPLETE" || item.transcodeStatus === "QUEUED")) {
    return "Uploading";
  }
  return "Completed";
};

const groupUploadBatchItems = (items: TMediaItem[], context?: TArtifactContext) => {
  const grouped = new Map<string, TMediaItem[]>();
  const output: TMediaItem[] = [];

  for (const item of items) {
    const batchId = getUploadBatchId(item);
    const batchSize = getUploadBatchSize(item);
    if (!batchId || batchSize <= 1) {
      output.push(item);
      continue;
    }
    const group = grouped.get(batchId);
    if (group) group.push(item);
    else grouped.set(batchId, [item]);
  }

  for (const [batchId, batchItems] of grouped.entries()) {
    const representative = batchItems.find((item) => item.thumbnail) ?? batchItems[0];
    const batchName = getUploadBatchName(representative);
    const statusLabel = getUploadBatchStatus(batchItems);
    const collectionHref =
      context?.workspaceSlug && context?.projectId
        ? `/${context.workspaceSlug}/projects/${context.projectId}/media-library/section/${encodeURIComponent(
            batchName
          )}?batch_id=${encodeURIComponent(batchId)}`
        : undefined;

    output.push({
      id: batchId,
      packageId: context?.packageId,
      title: batchName,
      description: `${batchItems.length} ${batchItems.length === 1 ? "file" : "files"}`,
      format: "collection",
      action: "open_collection",
      link: null,
      workItemId: null,
      author: representative.author,
      createdAt: representative.createdAt,
      views: batchItems.reduce((total, item) => total + (item.views || 0), 0),
      duration: "",
      primaryTag: batchName,
      secondaryTag: statusLabel,
      itemsCount: batchItems.length,
      meta: {
        upload_batch_id: batchId,
        upload_batch_name: batchName,
        upload_batch_size: batchItems.length,
        processing_state: statusLabel,
        category: getMetaString(representative.meta, ["category"], ""),
        location: getMetaString(representative.meta, ["location"], ""),
      },
      mediaType: "collection",
      collectionHref,
      thumbnail: representative.thumbnail,
      docs: [],
      isTranscodeActive: statusLabel === "Uploading" || statusLabel === "Processing",
      isTranscodeFailed: statusLabel === "Partially Failed",
      isTranscodeComplete: statusLabel === "Completed",
      transcodeLabel: statusLabel,
    });
  }

  return output.sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return 0;
    return rightTime - leftTime;
  });
};

export const mapArtifactsToMediaItems = (artifacts: TMediaArtifact[], context?: TArtifactContext): TMediaItem[] => {
  const formatDisplayTitle = (title: string, format: string, mediaType: TMediaItem["mediaType"]) => {
    const normalizedTitle = title.trim();

    if (!normalizedTitle) {
      return "";
    }

    if (mediaType === "document") {
      return getDisplayMediaTitle(normalizedTitle);
    }

    return normalizedTitle;
  };

  const thumbnailByLink = new Map<string, string>();
  const mediaTypeByName = new Map<string, TMediaItem["mediaType"]>();
  const artifactByName = new Map<string, TMediaArtifact>();

  const normalizeKey = (value: string) => value.trim().toLowerCase();
  const resolveArtifactNameSource = (value: string) => {
    const linkedArtifact = artifactByName.get(normalizeKey(value));
    return linkedArtifact ? resolveArtifactSource(linkedArtifact, context) : "";
  };
  const resolveThumbnailHint = (value: string) => {
    const normalizedValue = value.trim();
    if (!normalizedValue) return "";
    const artifactSource = resolveArtifactNameSource(normalizedValue);
    if (artifactSource) return artifactSource;
    if (context && ARTIFACT_NAME_PATTERN.test(normalizedValue)) return buildArtifactFileUrl(context, normalizedValue);
    return resolveArtifactPath(normalizedValue);
  };
  const getThumbnailHint = (artifact: TMediaArtifact, meta: Record<string, unknown>) => {
    const artifactRecord = artifact as TMediaArtifact & Record<string, unknown>;
    for (const key of THUMBNAIL_HINT_KEYS) {
      const value = artifactRecord[key] ?? meta[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };

  for (const artifact of artifacts) {
    const rawFormat = artifact.format ?? "";
    const normalizedAction = (artifact.action ?? "").toLowerCase();
    const actionFormat =
      normalizedAction === "play_hls" || normalizedAction === "play_streaming"
        ? "m3u8"
        : normalizedAction === "open_mp4"
          ? "mp4"
          : "";
    const format = normalizeFormat(rawFormat, artifact.path, artifact.name, artifact.link) || actionFormat;
    if (artifact.name) {
      mediaTypeByName.set(normalizeKey(artifact.name), getMediaType(format, rawFormat, artifact.action ?? ""));
      artifactByName.set(normalizeKey(artifact.name), artifact);
    }
    if (!artifact.link || !IMAGE_FORMATS.has(format)) continue;
    const isPreview = artifact.action === "preview" || format === "thumbnail";
    if (isPreview) {
      thumbnailByLink.set(normalizeKey(artifact.link), resolveArtifactSource(artifact, context));
    }
  }

  const sortedArtifacts = [...artifacts].sort((left, right) => {
    const leftTime = Date.parse(left.created_at || left.updated_at || "");
    const rightTime = Date.parse(right.created_at || right.updated_at || "");
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
    if (Number.isNaN(leftTime)) return 1;
    if (Number.isNaN(rightTime)) return -1;
    return rightTime - leftTime;
  });

  const items = sortedArtifacts.map((artifact) => {
    const rawFormat = artifact.format ?? "";
    const normalizedAction = (artifact.action ?? "").toLowerCase();
    const actionFormat =
      normalizedAction === "play_hls" || normalizedAction === "play_streaming"
        ? "m3u8"
        : normalizedAction === "open_mp4"
          ? "mp4"
          : "";
    const format = normalizeFormat(rawFormat, artifact.path, artifact.name, artifact.link) || actionFormat;
    const mediaType = getMediaType(format, rawFormat, artifact.action ?? "");
    const meta = resolveArtifactMeta(artifact, context?.metadata);
    const eventDetails = getEventMediaDetails(meta);
    const workItemId = getArtifactWorkItemId(artifact, meta);
    const linkedArtifact = artifact.link ? artifactByName.get(normalizeKey(artifact.link)) : undefined;
    const linkedTitle = format === "thumbnail" && linkedArtifact?.title ? linkedArtifact.title : artifact.title;
    const displayTitle = formatDisplayTitle(eventDetails?.title || linkedTitle, format, mediaType);
    // console.log("Display Title:", displayTitle, "Format:", format, "Media Type:", mediaType, "Event Details:", eventDetails, "Linked Artifact:", linkedArtifact);
    const baseDescription = (artifact.description ?? getMetaString(meta, ["description", "summary"], "")).trim();
    const eventContextLabel = getEventMediaContextLabel(meta);
    const eventDateLabel = getEventMediaDateLabel(meta, context?.dateFormat);
    const descriptionSource =
      eventDetails && !baseDescription
        ? [eventContextLabel, eventDateLabel].filter((entry): entry is string => Boolean(entry)).join(" · ")
        : baseDescription;
    const description = format === "thumbnail" ? "" : htmlToPlainText(descriptionSource);
    const descriptionHtml =
      format === "thumbnail" || !containsHtmlTags(descriptionSource) ? undefined : descriptionSource;

    const createdAt = formatDateLabel(artifact.created_at || artifact.updated_at || "", context?.dateFormat);
    const views = getMetaNumber(meta, ["views"], 0);
    const duration = getMetaDuration(meta, ["duration", "duration_seconds", "duration_sec", "durationSec"], "");

    const primaryTag = getMetaString(meta, ["category"], "");
    const linkValue = artifact.link ?? getMetaString(meta, ["for"], "");
    const linkTarget = linkValue ? normalizeKey(linkValue) : "";
    const linkFormat = getFormatFromPath(linkValue);
    const linkedFormat = linkedArtifact
      ? normalizeFormat(linkedArtifact.format, linkedArtifact.path, linkedArtifact.name, linkedArtifact.link) ||
        linkFormat
      : linkFormat || undefined;
    const metaKind = getMetaString(meta, ["kind"], "").toLowerCase();
    const metaSource = getMetaString(meta, ["source"], "").toLowerCase();
    const inferredLinkedMediaType =
      normalizedAction === "play" ||
      normalizedAction === "preview" ||
      normalizedAction === "play_hls" ||
      normalizedAction === "play_streaming" ||
      normalizedAction === "open_mp4"
        ? "video"
        : normalizedAction === "view" || normalizedAction === "open_image"
          ? "image"
          : format === "thumbnail" && (normalizedAction === "open_pdf" || normalizedAction === "download")
            ? "document"
            : format === "thumbnail" && metaKind === "thumbnail"
              ? "document"
              : format === "thumbnail" && metaSource === "generated"
                ? "video"
                : format === "thumbnail"
                  ? "image"
                  : "document";
    const linkedMediaType = linkTarget
      ? (mediaTypeByName.get(linkTarget) ?? (linkFormat ? getMediaType(linkFormat) : inferredLinkedMediaType))
      : undefined;
    const secondaryTag =
      getMetaString(meta, ["location", "season", "level", "coach"], "") || (eventDetails?.status ?? "");
    const itemsCount = getMetaNumber(meta, ["itemsCount", "items_count"], 1);
    const author = getMetaString(meta, ["coach", "author", "creator"], "Media Library");
    const docs = getMetaStringArray(meta, "docs");

    const rawPath = artifact.path ?? "";
    const resolvedPath = resolveArtifactSource(artifact, context);
    const downloadablePath = context && artifact.name ? buildArtifactFileUrl(context, artifact.name) : "";
    const directDownloadPath = rawPath && /^https?:\/\//i.test(rawPath) ? rawPath : "";
    const preferredDownloadPath =
      mediaType === "video" ? downloadablePath || directDownloadPath : directDownloadPath || downloadablePath;

    const metaThumbnail = getThumbnailHint(artifact, meta);
    const transcodeState = getTranscodeState(meta);
    const isAnnotated = hasSavedVideoAnnotations(meta);
    const artifactThumbnail = artifact.name ? thumbnailByLink.get(normalizeKey(artifact.name)) : "";
    const planeCoachThumbnail =
      metaSource === "plane-coach" && mediaType === "document" ? metaThumbnail || getPlaneCoachThumbnailPath() : "";
    const fallbackThumbnail =
      mediaType === "image"
        ? resolvedPath
        : planeCoachThumbnail || (mediaType === "document" ? getDocumentThumbnailPath(format) : "");
    const thumbnail = resolveArtifactPath(
      artifactThumbnail || resolveThumbnailHint(metaThumbnail) || planeCoachThumbnail || fallbackThumbnail
    );

    return {
      id: artifact.name,
      packageId: context?.packageId,
      title: displayTitle,
      description,
      descriptionHtml,
      format,
      linkedFormat,
      action: artifact.action,
      link: artifact.link ?? null,
      workItemId: workItemId || null,
      author,
      createdAt,
      eventDateLabel,
      views,
      duration,
      primaryTag,
      secondaryTag,
      itemsCount,
      meta,
      mediaType,
      linkedMediaType,
      thumbnail,
      videoSrc: mediaType === "video" ? resolvedPath : undefined,
      imageSrc: mediaType === "image" ? resolvedPath : undefined,
      fileSrc: mediaType === "document" ? resolvedPath : undefined,
      downloadSrc: preferredDownloadPath || undefined,
      docs,
      isAnnotated,
      ...transcodeState,
    };
  });

  return context?.groupBatches === false ? items : groupUploadBatchItems(items, context);
};

export const groupMediaItemsByTag = (items: TMediaItem[], fallbackTitle = "Media"): TMediaSection[] => {
  const grouped = new Map<string, TMediaItem[]>();
  for (const item of items) {
    const key = item.primaryTag || fallbackTitle;
    const group = grouped.get(key);
    if (group) group.push(item);
    else grouped.set(key, [item]);
  }

  return Array.from(grouped.entries()).map(([title, sectionItems]) => ({
    title,
    items: sectionItems,
  }));
};
