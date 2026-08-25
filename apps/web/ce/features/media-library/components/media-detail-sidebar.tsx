"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, CalendarClock, Clock, Handshake, MapPin, Signal, Tag, User, Volleyball, X } from "lucide-react";
import type { EditorRefApi } from "@plane/editor";
import type { TNameDescriptionLoader } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
import { CategoryDropdown } from "@/components/dropdowns/category-property";
import { DateDropdown } from "@/components/dropdowns/date";
import { LevelDropdown } from "@/components/dropdowns/level-property";
import { LocationDropdown } from "@/components/dropdowns/location-property";
import { ProgramDropdown } from "@/components/dropdowns/program-property";
import SportDropdown from "@/components/dropdowns/sport-property";
import { TimeDropdown } from "@/components/dropdowns/time-picker";
import { YearRangeDropdown } from "@/components/dropdowns/year-property";
import type { TIssueOperations } from "@/components/issues/issue-detail";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import OppositionTeamProperty from "@/plane-web/components/issues/issue-details/opposition-team-property";
import { MediaLibraryService } from "@/services/media-library.service";
import type { TMediaItem } from "../types/media-library.types";
import { formatFileSize, formatMetaLabel, formatMetaValue } from "../utils/media-detail-utils";
import {
  getEventMediaDetails,
  getEventMediaMetrics,
  isEventMediaItem,
} from "../utils/media-event";
import { DetailIssueOverview } from "./detail-peek-overview";
import { PeekOverviewIssueDetails } from "./detail-peek-overview/issue-detail";

type TMediaDetailSidebarProps = {
  workspaceSlug: string;
  projectId: string;
  item: TMediaItem;
  onMediaItemUpdated?: (updates?: Partial<TMediaItem>) => void;
};

type TOppositionTeam = {
  name: string;
  logo: string;
};

type TEditableMetaKey =
  | "category"
  | "sport"
  | "program"
  | "level"
  | "season"
  | "location"
  | "start_date"
  | "start_time"
  | "opposition"
  | "tags";

const HIDDEN_ADDITIONAL_META_KEYS = new Set([
  "hlspending",
  "hlsmasterplaylist",
  "hlsrendition",
  "hlsrenditions",
  "poster",
  "posterurl",
  "thumbnailartifactid",
  "thumbnailartifactpath",
  "transcodeassetid",
  "transcodecompletedat",
  "transcodejobid",
  "transcodeprofile",
  "transcodeprogress",
  "uploadid",
  "requestid",
  "viewevents",
  "durationseconds",
  "durationsec",
  "width",
  "height",
  "sourcewidth",
  "sourceheight",
  "videowidth",
  "videoheight",
  "videocodec",
  "audiocodec",
  "framerate",
  "averageframerate",
  "sourcecontainer",
]);

const normalizeAdditionalMetaKey = (key: string) => key.replace(/[-_\s]+/g, "").toLowerCase();

const getMetaRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
};

const parseMetaNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalizedValue = value.trim();
  if (!normalizedValue) return null;
  if (normalizedValue.includes("/")) {
    const [rawNumerator, rawDenominator] = normalizedValue.split("/", 2);
    const numerator = Number(rawNumerator);
    const denominator = Number(rawDenominator);
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : null;
  }
  const parsed = Number(normalizedValue);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseHlsRenditions = (value: unknown) => {
  if (Array.isArray(value)) return value.map(getMetaRecord).filter((entry) => Object.keys(entry).length > 0);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(getMetaRecord).filter((entry) => Object.keys(entry).length > 0) : [];
  } catch {
    return [];
  }
};

const getBestHlsRendition = (meta: Record<string, unknown>) => {
  const renditions = parseHlsRenditions(meta.hls_renditions ?? meta.hlsRenditions);
  return renditions
    .map((rendition, index) => {
      const width = parseMetaNumber(rendition.width) ?? parseMetaNumber(rendition.configured_width) ?? 0;
      const height = parseMetaNumber(rendition.height) ?? parseMetaNumber(rendition.configured_height) ?? 0;
      const frameRate =
        parseMetaNumber(rendition.frame_rate) ??
        parseMetaNumber(rendition.frameRate) ??
        parseMetaNumber(rendition.average_frame_rate);
      const bandwidth =
        parseMetaNumber(rendition.bandwidth) ??
        parseMetaNumber(rendition.configured_bandwidth) ??
        parseMetaNumber(rendition.average_bandwidth) ??
        0;
      return {
        bandwidth,
        frameRate,
        height: Math.round(height),
        index,
        width: Math.round(width),
      };
    })
    .filter((rendition) => rendition.width > 0 || rendition.height > 0 || rendition.frameRate)
    .sort((left, right) => {
      if (left.height !== right.height) return right.height - left.height;
      if (left.width !== right.width) return right.width - left.width;
      if (left.bandwidth !== right.bandwidth) return right.bandwidth - left.bandwidth;
      return left.index - right.index;
    })[0];
};

const getResolutionName = (width: number, height: number) => {
  const longestSide = Math.max(width, height);
  const shortestSide = Math.min(width, height);
  if (longestSide >= 7680 || shortestSide >= 4320) return "8K UHD";
  if (longestSide >= 3840 || shortestSide >= 2160) return "4K UHD";
  if (shortestSide >= 1440) return "Quad HD";
  if (shortestSide >= 1080) return "Full HD";
  if (shortestSide >= 720) return "HD";
  if (shortestSide >= 480) return "SD";
  return "";
};

const formatResolutionSpec = (width: number, height: number) => {
  if (width <= 0 && height <= 0) return "--";
  const resolutionName = getResolutionName(width, height);
  const heightLabel = height > 0 ? `${height}p` : "";
  const dimensionsLabel = width > 0 && height > 0 ? `${width} x ${height}` : "";
  return [heightLabel, resolutionName, dimensionsLabel ? `(${dimensionsLabel})` : ""].filter(Boolean).join(" ");
};

const formatFrameRateSpec = (frameRate: number | null | undefined) => {
  if (!frameRate || !Number.isFinite(frameRate) || frameRate <= 0) return "--";
  const rounded = Math.round(frameRate);
  const normalizedFrameRate = Math.abs(frameRate - rounded) < 0.01 ? String(rounded) : frameRate.toFixed(2);
  return `${normalizedFrameRate} fps`;
};

const getFirstMetaNumber = (meta: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const parsed = parseMetaNumber(meta[key]);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return null;
};

const getFirstMetaString = (meta: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const formatCodecSpec = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "--";
  const labels: Record<string, string> = {
    h264: "H.264",
    avc1: "H.264",
    hevc: "H.265 / HEVC",
    h265: "H.265 / HEVC",
    aac: "AAC",
    mp3: "MP3",
    mp2: "MP2",
    mpeg4: "MPEG-4",
    prores: "Apple ProRes",
    alac: "Apple Lossless",
    ac3: "Dolby Digital",
    eac3: "Dolby Digital Plus",
  };
  return labels[normalized] ?? normalized.toUpperCase();
};

const formatContainerSpec = (value: string) => {
  if (!value.trim()) return "--";
  const labels: Record<string, string> = {
    mov: "MOV",
    mp4: "MP4",
    m4a: "M4A",
    "3gp": "3GP",
    "3g2": "3G2",
    mj2: "MJ2",
  };
  const parts = value
    .split(",")
    .map((entry) => labels[entry.trim().toLowerCase()] ?? entry.trim().toUpperCase())
    .filter(Boolean);
  const primaryParts = parts.filter((entry) => entry === "MOV" || entry === "MP4");
  return Array.from(new Set(primaryParts.length > 0 ? primaryParts : parts)).join(" / ") || "--";
};

export const MediaDetailSidebar = ({
  workspaceSlug,
  projectId,
  item,
  onMediaItemUpdated,
}: TMediaDetailSidebarProps) => {
  const { setPeekIssue } = useIssueDetail();
  const { getUserDetails } = useMember();
  const workItemId = item?.workItemId ?? "";
  const hasWorkItemId = Boolean(workItemId);
  const mediaLibraryService = useMemo(() => new MediaLibraryService(), []);
  const sidebarClassName =
    "w-full min-w-[300px] border-l border-custom-border-200 bg-custom-sidebar-background-100 py-5 lg:min-w-80 xl:min-w-96 lg:h-full lg:overflow-hidden lg:overscroll-y-contain";
  const artifactEditorRef = useRef<EditorRefApi>(null);
  const artifactFormIssueOperations = useMemo<TIssueOperations>(
    () => ({
      fetch: async () => {},
      update: async () => {},
      remove: async () => {},
    }),
    []
  );
  const [isSubmitting, setIsSubmitting] = useState<TNameDescriptionLoader>("saved");
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const artifactMeta = useMemo(() => (item?.meta ?? {}) as Record<string, unknown>, [item?.meta]);
  const isEventItem = useMemo(() => isEventMediaItem(item), [item]);
  const eventDetails = useMemo(() => getEventMediaDetails(item), [item]);
  const eventDateLabel = item.eventDateLabel;
  const eventMetrics = useMemo(() => getEventMediaMetrics(item), [item]);
  const getMetaString = useCallback(
    (key: string) => {
      const value = artifactMeta[key];
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    },
    [artifactMeta]
  );
  const oppositionTeamValue = useMemo(() => {
    const value = artifactMeta.opposition;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const name = (value as Record<string, unknown>).name;
    const logo = (value as Record<string, unknown>).logo;
    if (typeof name !== "string" || !name.trim()) return null;
    return {
      name: name.trim(),
      logo: typeof logo === "string" ? logo : "",
    } as TOppositionTeam;
  }, [artifactMeta]);
  const updateEditableMeta = useCallback(
    async (key: TEditableMetaKey, value: string | string[] | TOppositionTeam | null) => {
      const nextMeta = { ...artifactMeta, [key]: value ?? null };
      setIsSavingMeta(true);
      try {
        if (item?.packageId) {
          await mediaLibraryService.updateManifestArtifacts(workspaceSlug, projectId, item.packageId, {
            artifact_id: item.id,
            artifact: {
              meta: nextMeta,
            },
          });
        }
        onMediaItemUpdated?.({ meta: nextMeta });
      } finally {
        setIsSavingMeta(false);
      }
    },
    [artifactMeta, item?.id, item?.packageId, mediaLibraryService, onMediaItemUpdated, projectId, workspaceSlug]
  );
  const baseMetaKeys = useMemo(
    () =>
      new Set([
        "category",
        "sport",
        "program",
        "level",
        "season",
        "location",
        "start_date",
        "start_time",
        "opposition",
        "tags",
        "created_by",
        "createdBy",
      ]),
    []
  );
  const createdByMemberId = useMemo(() => {
    const value = artifactMeta.created_by ?? artifactMeta.createdBy;
    if (typeof value !== "string") return "";
    return value.trim();
  }, [artifactMeta]);
  const createdByLabel = useMemo(() => {
    if (createdByMemberId) return getUserDetails(createdByMemberId)?.display_name ?? createdByMemberId;
    return formatMetaValue(item.author);
  }, [createdByMemberId, getUserDetails, item.author]);
  const userTags = useMemo(
    () =>
      Array.isArray(artifactMeta.tags)
        ? artifactMeta.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
        : [],
    [artifactMeta.tags]
  );
  const addUserTags = useCallback(
    (rawValue: string) => {
      const parts = rawValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (parts.length === 0) return;
      const nextTags = [...userTags];
      for (const part of parts) {
        if (!nextTags.some((tag) => tag.toLowerCase() === part.toLowerCase())) nextTags.push(part);
      }
      setTagDraft("");
      void updateEditableMeta("tags", nextTags);
    },
    [updateEditableMeta, userTags]
  );
  const removeUserTag = useCallback(
    (value: string) => {
      void updateEditableMeta(
        "tags",
        userTags.filter((tag) => tag.toLowerCase() !== value.toLowerCase())
      );
    },
    [updateEditableMeta, userTags]
  );
  const additionalMetaEntries = useMemo(
    () =>
      Object.entries(artifactMeta).filter(([key, value]) => {
        if (baseMetaKeys.has(key)) return false;
        const normalizedKey = key.toLowerCase();
        if (
          HIDDEN_ADDITIONAL_META_KEYS.has(normalizeAdditionalMetaKey(key)) ||
          normalizedKey === "annotations" ||
          normalizedKey === "kind" ||
          normalizedKey === "thumbnail" ||
          normalizedKey === "tags"
        )
          return false;
        const normalized = formatMetaValue(value);
        return normalized && normalized !== "--";
      }),
    [artifactMeta, baseMetaKeys]
  );
  const getFormattedAdditionalMetaValue = useCallback((key: string, value: unknown) => {
    const normalizedKey = key.toLowerCase();
    const compactKey = normalizeAdditionalMetaKey(key);
    if (
      normalizedKey === "file_size" ||
      normalizedKey === "filesize" ||
      normalizedKey === "size_in_bytes" ||
      compactKey === "sourcefilesize"
    ) {
      const sizeValue = formatFileSize(value);
      return sizeValue;
    }
    return formatMetaValue(value);
  }, []);
  const mediaSpecFields = useMemo(() => {
    const isHlsMedia =
      item.format.toLowerCase() === "m3u8" ||
      Boolean(
        artifactMeta.hls_master_playlist ||
          artifactMeta.hlsMasterPlaylist ||
          artifactMeta.hls_renditions ||
          artifactMeta.hlsRenditions
      );
    if (!isHlsMedia) return [];

    const bestRendition = getBestHlsRendition(artifactMeta);
    if (!bestRendition) return [];

    return [
      { label: "Resolution", value: formatResolutionSpec(bestRendition.width, bestRendition.height) },
      { label: "Frame rate", value: formatFrameRateSpec(bestRendition.frameRate) },
    ].filter((field) => field.value && field.value !== "--");
  }, [artifactMeta, item.format]);
  const technicalMetadataFields = useMemo(() => {
    const width = getFirstMetaNumber(artifactMeta, ["width", "video_width", "videoWidth"]);
    const height = getFirstMetaNumber(artifactMeta, ["height", "video_height", "videoHeight"]);
    const sourceWidth = getFirstMetaNumber(artifactMeta, ["source_width", "sourceWidth"]);
    const sourceHeight = getFirstMetaNumber(artifactMeta, ["source_height", "sourceHeight"]);
    const frameRate = getFirstMetaNumber(artifactMeta, ["frame_rate", "frameRate", "average_frame_rate"]);
    const videoCodec = getFirstMetaString(artifactMeta, ["video_codec", "videoCodec"]);
    const audioCodec = getFirstMetaString(artifactMeta, ["audio_codec", "audioCodec"]);
    const sourceContainer = getFirstMetaString(artifactMeta, ["source_container", "sourceContainer"]);

    const fields = [];
    if (width && height) {
      fields.push({ label: "Resolution", value: formatResolutionSpec(Math.round(width), Math.round(height)) });
    }
    if (sourceWidth && sourceHeight && (sourceWidth !== width || sourceHeight !== height)) {
      fields.push({
        label: "Source resolution",
        value: formatResolutionSpec(Math.round(sourceWidth), Math.round(sourceHeight)),
      });
    }
    if (frameRate) fields.push({ label: "Frame rate", value: formatFrameRateSpec(frameRate) });
    if (videoCodec) fields.push({ label: "Video", value: formatCodecSpec(videoCodec) });
    if (audioCodec) fields.push({ label: "Audio", value: formatCodecSpec(audioCodec) });
    if (sourceContainer) fields.push({ label: "Container", value: formatContainerSpec(sourceContainer) });

    return fields.filter((field) => field.value && field.value !== "--");
  }, [artifactMeta]);
  const fallbackFields = useMemo(
    () => [
      { label: "Format", value: formatMetaValue(item.format) },
      ...mediaSpecFields,
      { label: "Duration", value: formatMetaValue(item.duration) },
      { label: "Created", value: formatMetaValue(item.createdAt) },
    ],
    [item.createdAt, item.duration, item.format, mediaSpecFields]
  );
  const eventSummaryFields = useMemo(
    () =>
      !eventDetails
        ? []
        : [
            { label: "Status", value: formatMetaValue(eventDetails.status) },
            { label: "Event date", value: formatMetaValue(eventDateLabel) },
            { label: "Sport", value: formatMetaValue(eventDetails.sport) },
            { label: "Program", value: formatMetaValue(eventDetails.program) },
            { label: "Level", value: formatMetaValue(eventDetails.level) },
            { label: "Season", value: formatMetaValue(eventDetails.year) },
            { label: "Stream", value: formatMetaValue(eventDetails.primaryStreamName || eventDetails.primaryStreamId) },
            { label: "Location", value: formatMetaValue(eventDetails.locationLabel) },
            { label: "Metrics", value: formatMetaValue(eventMetrics.join(" · ")) },
          ].filter((field) => field.value && field.value !== "--"),
    [eventDateLabel, eventDetails, eventMetrics]
  );
  const eventSummarySection =
    isEventItem && eventSummaryFields.length > 0 ? (
      <div className="space-y-3">
        <h6 className="text-sm font-medium text-custom-text-100">Event Summary</h6>
        <div className="space-y-2">
          {eventSummaryFields.map((field) => (
            <div key={field.label} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-custom-text-300">{field.label}</span>
              <span className="ml-auto block max-w-[65%] truncate text-right text-custom-text-100" title={field.value}>
                {field.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  useEffect(() => {
    if (!workItemId) {
      setPeekIssue(undefined);
      return;
    }
    setPeekIssue({ workspaceSlug, projectId, issueId: workItemId });
  }, [projectId, setPeekIssue, workItemId, workspaceSlug]);

  if (workItemId && isEventItem) {
    return (
      <div className={sidebarClassName}>
        <div className="vertical-scrollbar scrollbar-md h-full overflow-y-auto px-6">
          <div className="space-y-6">
            <DetailIssueOverview embedIssue mediaItem={item} onMediaItemUpdated={onMediaItemUpdated} />
            {eventSummarySection}
          </div>
        </div>
      </div>
    );
  }

  if (!workItemId) {
    return (
      <div className={sidebarClassName}>
        <div className="vertical-scrollbar scrollbar-md h-full overflow-y-auto px-6">
          <div className="space-y-6">
            <div className="space-y-3">
              <PeekOverviewIssueDetails
                editorRef={artifactEditorRef}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                issueId={item.id}
                issueOperations={artifactFormIssueOperations}
                disabled={false}
                isArchived={false}
                isSubmitting={isSubmitting}
                setIsSubmitting={setIsSubmitting}
                mediaItem={item}
                onMediaItemUpdated={onMediaItemUpdated}
              />
            </div>

            <div className="space-y-3">
              <h6 className="text-sm font-medium text-custom-text-100">Media Details</h6>
              <div className="space-y-2">
                {fallbackFields
                  .filter((field) => field.value && field.value !== "--")
                  .map((field) => (
                    <div key={field.label} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-custom-text-300">{field.label}</span>
                      <span
                        className="ml-auto block max-w-[65%] truncate text-right text-custom-text-100"
                        title={field.value}
                      >
                        {field.value}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {eventSummarySection}

            <div>
              <h6 className="text-sm font-medium">Event Details</h6>
              <div className="mt-3 w-full space-y-2">
                <div className="flex h-8 w-full items-center gap-3">
                  <div className="flex w-1/4 flex-shrink-0 items-center gap-1 text-sm text-custom-text-300">
                    <User className="h-4 w-4 flex-shrink-0" />
                    <span>Created by</span>
                  </div>
                  <span className="w-3/4 rounded px-2 py-0.5 text-sm text-custom-text-100">{createdByLabel}</span>
                </div>

                {hasWorkItemId ? (
                  <>
                    <div className="flex h-8 w-full items-center gap-3">
                      <div className="flex w-1/4 flex-shrink-0 items-center gap-1 text-sm text-custom-text-300">
                        <CalendarClock className="h-4 w-4 flex-shrink-0" />
                        <span>Start date</span>
                      </div>
                      <DateDropdown
                        value={getMetaString("start_date")}
                        onChange={(value) =>
                          void updateEditableMeta(
                            "start_date",
                            value ? (renderFormattedPayloadDate(value) ?? null) : null
                          )
                        }
                        placeholder="Add start date"
                        buttonVariant="transparent-with-text"
                        className="w-3/4 flex-grow group"
                        buttonContainerClassName="w-full text-left"
                        buttonClassName={`text-sm ${getMetaString("start_date") ? "" : "text-custom-text-400"}`}
                        hideIcon
                        disabled={isSavingMeta}
                        clearIconClassName="h-3 w-3 hidden group-hover:inline"
                      />
                    </div>

                    <div className="flex h-8 w-full items-center gap-3">
                      <div className="flex w-1/4 flex-shrink-0 items-center gap-1 text-sm text-custom-text-300">
                        <Clock className="h-4 w-4 flex-shrink-0" />
                        <span>Start time</span>
                      </div>
                      <TimeDropdown
                        value={getMetaString("start_time")}
                        onChange={(value) => void updateEditableMeta("start_time", value)}
                        placeholder="Add start time"
                        buttonVariant="transparent-with-text"
                        className="w-3/4 flex-grow group"
                        buttonContainerClassName="w-full text-left"
                        buttonClassName={`text-sm ${getMetaString("start_time") ? "" : "text-custom-text-400"}`}
                        hideIcon
                        disabled={isSavingMeta}
                        clearIconClassName="h-3 w-3 hidden group-hover:inline"
                      />
                    </div>
                  </>
                ) : null}

                <div className="flex h-8 w-full items-center gap-3">
                  <div className="flex w-1/4 flex-shrink-0 items-center gap-1 text-sm text-custom-text-300">
                    <Signal className="h-4 w-4 flex-shrink-0" />
                    <span>Level</span>
                  </div>
                  <LevelDropdown
                    value={getMetaString("level")}
                    onChange={(value) => void updateEditableMeta("level", value)}
                    placeholder="Add level"
                    buttonVariant="transparent-with-text"
                    className="w-3/4 flex-grow group"
                    buttonContainerClassName="w-full text-left"
                    buttonClassName={`text-sm ${getMetaString("level") ? "" : "text-custom-text-400"}`}
                    hideIcon
                    disabled={isSavingMeta}
                    clearIconClassName="h-3 w-3 hidden group-hover:inline"
                  />
                </div>

                <div className="flex h-8 w-full items-center gap-3">
                  <div className="flex w-1/4 flex-shrink-0 items-center gap-1 text-sm text-custom-text-300">
                    <User className="h-4 w-4 flex-shrink-0" />
                    <span>Program</span>
                  </div>
                  <ProgramDropdown
                    value={getMetaString("program")}
                    onChange={(value) => void updateEditableMeta("program", value)}
                    placeholder="Add program"
                    buttonVariant="transparent-with-text"
                    className="w-3/4 flex-grow group"
                    buttonContainerClassName="w-full text-left"
                    buttonClassName={`text-sm ${getMetaString("program") ? "" : "text-custom-text-400"}`}
                    hideIcon
                    disabled={isSavingMeta}
                    clearIconClassName="h-3 w-3 hidden group-hover:inline"
                  />
                </div>

                <div className="flex h-8 w-full items-center gap-3">
                  <div className="flex w-1/4 flex-shrink-0 items-center gap-1 text-sm text-custom-text-300">
                    <Volleyball className="h-4 w-4 flex-shrink-0" />
                    <span>Sport</span>
                  </div>
                  <SportDropdown
                    value={getMetaString("sport")}
                    onChange={(value) => void updateEditableMeta("sport", value)}
                    placeholder="Add sport"
                    buttonVariant="transparent-with-text"
                    className="w-3/4 flex-grow group"
                    buttonContainerClassName="w-full text-left"
                    buttonClassName={`text-sm ${getMetaString("sport") ? "" : "text-custom-text-400"}`}
                    hideIcon
                    disabled={isSavingMeta}
                    clearIconClassName="h-3 w-3 hidden group-hover:inline"
                  />
                </div>

                <div className="flex h-8 w-full items-center gap-3">
                  <div className="flex w-1/4 flex-shrink-0 items-center gap-1 text-sm text-custom-text-300">
                    <Handshake className="h-4 w-4 flex-shrink-0" />
                    <span>Opposition</span>
                  </div>
                  <div className="w-3/4">
                    <OppositionTeamProperty
                      storageKey={`opp-team-media-${item.id}`}
                      value={oppositionTeamValue}
                      onChange={(team) => void updateEditableMeta("opposition", team)}
                      disabled={isSavingMeta}
                    />
                  </div>
                </div>

                <div className="flex h-8 w-full items-center gap-3">
                  <div className="flex w-1/4 flex-shrink-0 items-center gap-1 text-sm text-custom-text-300">
                    <Tag className="h-4 w-4 flex-shrink-0" />
                    <span>Category</span>
                  </div>
                  <CategoryDropdown
                    value={getMetaString("category")}
                    onChange={(value) => void updateEditableMeta("category", value)}
                    placeholder="Add category"
                    buttonVariant="transparent-with-text"
                    className="w-3/4 flex-grow group"
                    buttonContainerClassName="w-full text-left"
                    buttonClassName={`text-sm ${getMetaString("category") ? "" : "text-custom-text-400"}`}
                    hideIcon
                    disabled={isSavingMeta}
                    clearIconClassName="h-3 w-3 hidden group-hover:inline"
                  />
                </div>

                <div className="flex h-8 w-full items-center gap-3">
                  <div className="flex w-1/4 flex-shrink-0 items-center gap-1 text-sm text-custom-text-300">
                    <MapPin className="h-4 w-4 flex-shrink-0" />
                    <span>Location</span>
                  </div>
                  <LocationDropdown
                    value={getMetaString("location")}
                    onChange={(value) => void updateEditableMeta("location", value)}
                    placeholder="Add location"
                    buttonVariant="transparent-with-text"
                    className="w-3/4 flex-grow group"
                    buttonContainerClassName="w-full text-left"
                    buttonClassName={`text-sm ${
                      getMetaString("location") ? "" : "text-custom-text-400"
                    }`}
                    hideIcon
                    disabled={isSavingMeta}
                    clearIconClassName="h-3 w-3 hidden group-hover:inline"
                    dropdownClassName="z-[70]"
                  />
                </div>

                <div className="flex h-8 w-full items-center gap-3">
                  <div className="flex w-1/4 flex-shrink-0 items-center gap-1 text-sm text-custom-text-300">
                    <Calendar className="h-4 w-4 flex-shrink-0" />
                    <span>Season</span>
                  </div>
                  <YearRangeDropdown
                    value={getMetaString("season")}
                    onChange={(value) => void updateEditableMeta("season", value)}
                    placeholder="Add season"
                    buttonVariant="transparent-with-text"
                    className="w-3/4 flex-grow group"
                    buttonContainerClassName="w-full text-left"
                    buttonClassName={`text-sm ${getMetaString("season") ? "" : "text-custom-text-400"}`}
                    hideIcon
                    disabled={isSavingMeta}
                    clearIconClassName="h-3 w-3 hidden group-hover:inline"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h6 className="text-sm font-medium text-custom-text-100">Tags</h6>
              <div className="flex min-h-[34px] flex-wrap items-center gap-2 rounded-md border border-custom-border-200 bg-custom-background-100 px-2 py-1.5">
                {userTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-custom-primary-100/30 bg-custom-primary-100/15 px-2 py-0.5 text-[11px] font-medium text-custom-primary-100"
                  >
                    <span className="truncate">{tag}</span>
                    <button
                      type="button"
                      onClick={() => removeUserTag(tag)}
                      className="text-custom-primary-100/80 hover:text-custom-primary-100"
                      disabled={isSavingMeta}
                      aria-label={`Remove ${tag}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addUserTags(tagDraft);
                    }
                  }}
                  onBlur={() => addUserTags(tagDraft)}
                  placeholder={userTags.length === 0 ? "Add tags" : ""}
                  className="min-w-[140px] flex-1 bg-transparent px-1 py-0.5 text-[11px] text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none"
                  disabled={isSavingMeta}
                />
              </div>
              <div className="text-[10px] text-custom-text-300">Press comma or Enter to add.</div>
            </div>

            {technicalMetadataFields.length > 0 || additionalMetaEntries.length > 0 ? (
              <div className="space-y-3">
                <h6 className="text-sm font-medium text-custom-text-100">Metadata</h6>
                <div className="space-y-2">
                  {technicalMetadataFields.map((field) => (
                    <div key={field.label} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-custom-text-300">{field.label}</span>
                      <span
                        className="ml-auto block max-w-[65%] truncate text-right text-custom-text-100"
                        title={field.value}
                      >
                        {field.value}
                      </span>
                    </div>
                  ))}
                  {additionalMetaEntries.map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-custom-text-300">{formatMetaLabel(key)}</span>
                      <span
                        className="ml-auto block max-w-[65%] truncate text-right text-custom-text-100"
                        title={getFormattedAdditionalMetaValue(key, value)}
                      >
                        {getFormattedAdditionalMetaValue(key, value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={sidebarClassName}>
      <DetailIssueOverview embedIssue mediaItem={item} onMediaItemUpdated={onMediaItemUpdated} />
    </div>
  );
};
