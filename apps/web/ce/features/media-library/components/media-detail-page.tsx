"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import videojs from "video.js";
import { ArrowLeft } from "lucide-react";
// import "video.js/dist/video-js.css";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import {
  buildSgEventAnnotationDisplayMeta,
  buildSgEventAnnotationVideoItem,
  buildSgEventAnnotationViewKey,
  getSgEventMediaReferenceAnnotations,
  VideoAnnotationEditor,
} from "@/components/annotation";
import { LogoSpinner } from "@/components/common/logo-spinner";
import { SgEventDetailPage } from "@/components/issues/issue-detail/sg-event-detail-page";
import { useMember } from "@/hooks/store/use-member";
import { useAppRouter } from "@/hooks/use-app-router";
import type { TCustomPlaylistAnnotation } from "@/services/media-library.service";
import { MediaLibraryService } from "@/services/media-library.service";
import { PLAYER_STYLE } from "../constants/player-styles";
import { useDocumentPreview, useResolvedMediaSources } from "../hooks/media-detail-hooks";
import { useMediaLibraryItem } from "../hooks/use-media-library-item";
import type { TMediaItem } from "../types/media-library.types";
import {
  getCaptionTracks,
  getMetaString,
  getQualitySelection,
  getVideoMimeType,
  getVideoRepresentations,
} from "../utils/media-detail-utils";
import { isEventMediaItem } from "../utils/media-event";
import { buildMediaViewStorageKey, shouldRecordMediaPlaybackView } from "../utils/media-view-counter";
import { MediaDetailPreview } from "./media-detail-preview";
import { MediaDetailSidebar } from "./media-detail-sidebar";

type TPipCaptionMode = "disabled" | "hidden" | "showing";

const MEDIA_VIEWER_SESSION_KEY = "plane-media-viewer-session-id";

const getMediaViewerSessionId = () => {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(MEDIA_VIEWER_SESSION_KEY);
    if (existing) return existing;
    const next =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `viewer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(MEDIA_VIEWER_SESSION_KEY, next);
    return next;
  } catch {
    return `viewer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};
const VIDEO_READY_STATE_HAVE_CURRENT_DATA = 2;

const MediaDetailPage = () => {
  const { mediaId, workspaceSlug, projectId } = useParams() as {
    mediaId: string;
    workspaceSlug: string;
    projectId: string;
  };
  const router = useAppRouter();
  const { getUserDetails } = useMember();
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("from") ?? "";
  const annotationParam = (searchParams.get("annotation") ?? searchParams.get("annotate") ?? "").toLowerCase();
  const shouldOpenVideoAnnotationWorkspaceFromQuery = ["1", "true", "open", "video"].includes(annotationParam);
  const annotationStreamParam = searchParams.get("stream") ?? "";
  const annotationStreamIdParam = searchParams.get("streamId") ?? "";
  const annotationDeviceIdParam = searchParams.get("deviceId") ?? "";
  const annotationViewKeyParam = searchParams.get("viewKey") ?? "";
  const annotationVideoSrcParam = searchParams.get("videoSrc") ?? "";
  const annotationViewParam = searchParams.get("view") ?? "";
  const customPlaylistIdParam = searchParams.get("customPlaylistId") ?? "";
  const isCustomPlaylistAnnotation = Boolean(
    shouldOpenVideoAnnotationWorkspaceFromQuery && customPlaylistIdParam.trim()
  );
  const backHref = useMemo(() => {
    const defaultHref = `/${workspaceSlug}/projects/${projectId}/media-library`;
    const projectHrefPrefix = `/${workspaceSlug}/projects/${projectId}`;
    if (!fromParam || !fromParam.startsWith("/") || fromParam.startsWith("//")) return defaultHref;
    if (fromParam !== projectHrefPrefix && !fromParam.startsWith(`${projectHrefPrefix}/`)) return defaultHref;
    return fromParam;
  }, [fromParam, projectId, workspaceSlug]);
  const { item: rawItem, isLoading } = useMediaLibraryItem(workspaceSlug, projectId, mediaId);
  const [mediaItemOverrides, setMediaItemOverrides] = useState<Partial<TMediaItem> | null>(null);
  const mediaLibraryService = useMemo(() => new MediaLibraryService(), []);
  const annotationVideoItem = useMemo(
    () =>
      shouldOpenVideoAnnotationWorkspaceFromQuery
        ? buildSgEventAnnotationVideoItem(rawItem, {
            deviceId: annotationDeviceIdParam,
            streamId: annotationStreamIdParam,
            streamName: annotationStreamParam,
            title: annotationViewParam,
            viewKey: annotationViewKeyParam,
            videoSrc: annotationVideoSrcParam,
          })
        : null,
    [
      annotationDeviceIdParam,
      annotationStreamParam,
      annotationStreamIdParam,
      annotationVideoSrcParam,
      annotationViewKeyParam,
      annotationViewParam,
      rawItem,
      shouldOpenVideoAnnotationWorkspaceFromQuery,
    ]
  );
  const baseItem = annotationVideoItem ?? rawItem;
  const item = useMemo(
    () => (baseItem ? { ...baseItem, ...(mediaItemOverrides ?? {}) } : baseItem),
    [baseItem, mediaItemOverrides]
  );
  const isSgEventAsset = useMemo(() => (item ? isEventMediaItem(item) : false), [item]);
  const handleMediaItemUpdated = useCallback((updates?: Partial<TMediaItem>) => {
    if (!updates || Object.keys(updates).length === 0) return;
    setMediaItemOverrides((prev) => ({ ...(prev ?? {}), ...updates }));
  }, []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);
  const viewRecordedRef = useRef(false);
  const [isImageZoomOpen, setIsImageZoomOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVideoFrameReady, setIsVideoFrameReady] = useState(false);
  const [isVideoAnnotationMode, setIsVideoAnnotationMode] = useState(false);
  const [isVideoAnnotationWorkspaceOpen, setIsVideoAnnotationWorkspaceOpen] = useState(false);
  const [hasUnsavedVideoAnnotationChanges, setHasUnsavedVideoAnnotationChanges] = useState(false);
  const [videoAnnotationWorkspaceActivationKey, setVideoAnnotationWorkspaceActivationKey] = useState(0);
  const [videoAnnotationBackPromptKey, setVideoAnnotationBackPromptKey] = useState(0);
  const [currentVideoSeconds, setCurrentVideoSeconds] = useState(0);
  const [currentVideoDurationSeconds, setCurrentVideoDurationSeconds] = useState<number | null>(null);
  const [videoAnnotationPropertiesElement, setVideoAnnotationPropertiesElement] = useState<HTMLDivElement | null>(null);
  const [videoAnnotationToolbarElement, setVideoAnnotationToolbarElement] = useState<HTMLDivElement | null>(null);
  const [videoTimelineElement, setVideoTimelineElement] = useState<HTMLDivElement | null>(null);
  const [playerTick, setPlayerTick] = useState(0);
  const [qualitySelection, setQualitySelection] = useState<string | null>(null);
  const [playerElement, setPlayerElement] = useState<HTMLElement | null>(null);
  const videoAnnotationSaveBeforeCloseRef = useRef<(() => Promise<boolean>) | null>(null);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const pipCaptionModesRef = useRef<Array<{ track: TextTrack; mode: TPipCaptionMode }>>([]);
  const inactivityTimeoutRef = useRef<number | null>(null);
  const annotationEventJsonSource = rawItem?.fileSrc || rawItem?.downloadSrc || "";
  useEffect(() => {
    setMediaItemOverrides(null);
    viewRecordedRef.current = false;
  }, [rawItem?.id]);

  useEffect(() => {
    setCurrentVideoSeconds(0);
    setCurrentVideoDurationSeconds(null);
    setIsVideoFrameReady(false);
    setIsVideoAnnotationMode(false);
    setIsVideoAnnotationWorkspaceOpen(false);
  }, [item?.id]);

  useEffect(() => {
    const sourceItem = rawItem;
    if (!shouldOpenVideoAnnotationWorkspaceFromQuery || !annotationEventJsonSource || !sourceItem) return;

    let isCancelled = false;
    const loadEventViewAnnotations = async () => {
      for (const credentials of ["include", "omit"] as const) {
        try {
          const response = await fetch(annotationEventJsonSource, { credentials });
          if (!response.ok) continue;

          const payload = await response.json().catch(() => null);
          const eventPayload =
            payload && typeof payload === "object" && !Array.isArray(payload)
              ? (payload as Record<string, unknown>)
              : null;
          if (!eventPayload || isCancelled) return;

          const annotationVideoSource =
            annotationVideoSrcParam ||
            (typeof annotationVideoItem?.videoSrc === "string" ? annotationVideoItem.videoSrc : "") ||
            (typeof annotationVideoItem?.fileSrc === "string" ? annotationVideoItem.fileSrc : "");
          const nextMeta = buildSgEventAnnotationDisplayMeta(sourceItem.meta ?? {}, {
            deviceId: annotationDeviceIdParam,
            eventPayload,
            streamId: annotationStreamIdParam,
            streamName: annotationStreamParam,
            title: annotationViewParam,
            viewKey: annotationViewKeyParam,
            videoSrc: annotationVideoSource,
          });
          handleMediaItemUpdated({
            meta: {
              ...(annotationVideoItem?.meta ?? {}),
              ...nextMeta,
            },
          });
          return;
        } catch {
          continue;
        }
      }
    };

    void loadEventViewAnnotations();

    return () => {
      isCancelled = true;
    };
  }, [
    annotationDeviceIdParam,
    annotationStreamIdParam,
    annotationStreamParam,
    annotationVideoSrcParam,
    annotationViewKeyParam,
    annotationViewParam,
    annotationVideoItem?.fileSrc,
    annotationVideoItem?.meta,
    annotationVideoItem?.videoSrc,
    annotationEventJsonSource,
    handleMediaItemUpdated,
    rawItem,
    shouldOpenVideoAnnotationWorkspaceFromQuery,
  ]);

  const meta = (item?.meta ?? {}) as Record<string, unknown>;
  const normalizedAction = (item?.action ?? "").toLowerCase();
  const documentFormat = item?.format?.toLowerCase() ?? "";
  const {
    resolvedVideoFormat,
    isVideoAction,
    isVideoFormat,
    isVideo,
    isHls,
    proxiedVideoSrc,
    effectiveVideoSrc,
    effectiveImageSrc,
    effectiveDocumentSrc,
    useCredentials,
    crossOrigin,
    useDocumentCredentials,
  } = useResolvedMediaSources({
    item,
    meta,
    documentFormat,
    normalizedAction,
  });
  console.log("Resolved Media Sources:", crossOrigin, useCredentials);
  const isPdf = item?.mediaType === "document" && documentFormat === "pdf";
  const isTextDocument =
    item?.mediaType === "document" && new Set(["txt", "json", "md", "log", "yaml", "yml", "xml"]).has(documentFormat);
  const isDocx = item?.mediaType === "document" && documentFormat === "docx";
  const isSpreadsheet = item?.mediaType === "document" && new Set(["xlsx", "xls", "csv"]).has(documentFormat);
  const isPptx = item?.mediaType === "document" && documentFormat === "pptx";
  const isBinaryDocument = item?.mediaType === "document" && !isTextDocument;
  const isSupportedDocument = item?.mediaType === "document" && (isPdf || isDocx || isSpreadsheet || isTextDocument);
  const isUnsupportedDocument = item?.mediaType === "document" && !isSupportedDocument;

  const {
    textPreview,
    textPreviewError,
    isTextPreviewLoading,
    documentPreviewUrl,
    documentPreviewHtml,
    documentPreviewError,
    isDocumentPreviewLoading,
  } = useDocumentPreview({
    item,
    documentFormat,
    effectiveDocumentSrc,
    isTextDocument,
    isBinaryDocument,
    isUnsupportedDocument,
    isDocx,
    isSpreadsheet,
    isPptx,
    useDocumentCredentials,
  });

  const sanitizedDocumentPreviewHtml = useMemo(
    () => (documentPreviewHtml ? DOMPurify.sanitize(documentPreviewHtml, { USE_PROFILES: { html: true } }) : ""),
    [documentPreviewHtml]
  );

  const handleTogglePip = useCallback(async () => {
    const video = videoRef.current as HTMLVideoElement | null;
    if (!video || typeof document === "undefined") return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if ((video as any).requestPictureInPicture) {
        await (video as any).requestPictureInPicture();
      }
    } catch (error) {
      console.error("Picture-in-Picture error:", error);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Picture-in-Picture failed",
        message: "Your browser blocked Picture-in-Picture or it isn't supported for this media.",
      });
    }
  }, []);

  useEffect(() => {
    if (!isVideo) {
      setIsVideoFrameReady(false);
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
      return;
    }

    const videoElement = videoRef.current;
    if (!videoElement || !videoElement.isConnected) return;

    if (playerRef.current && playerRef.current.el?.() !== videoElement) {
      playerRef.current.dispose();
      playerRef.current = null;
    }

    if (!playerRef.current) {
      const overflowButtonName = "OverflowMenuButton";
      const pipButtonName = "PipToggleButton";
      if (!videojs.getComponent(overflowButtonName)) {
        const Button = videojs.getComponent("Button");
        const OverflowMenuButton = class extends (Button as any) {
          constructor(playerInstance: any, options: any) {
            super(playerInstance, options);
            this.controlText("More");
            this.addClass("vjs-overflow-button");
            this.addClass("vjs-menu-button");
          }

          handleClick() {
            const playerInstance = this.player();
            playerInstance?.trigger?.("overflowtoggle");
          }
        };
        videojs.registerComponent(overflowButtonName, OverflowMenuButton as any);
      }
      if (!videojs.getComponent(pipButtonName)) {
        const Button = videojs.getComponent("Button");
        const PipToggleButton = class extends (Button as any) {
          constructor(playerInstance: any, options: any) {
            super(playerInstance, options);
            this.controlText("Picture in Picture");
            this.addClass("vjs-pip-toggle");
          }

          handleClick() {
            const playerInstance = this.player();
            playerInstance?.trigger?.("piptoggle");
          }
        };
        videojs.registerComponent(pipButtonName, PipToggleButton as any);
      }

      playerRef.current = videojs(videoElement, {
        controls: true,
        autoplay: isCustomPlaylistAnnotation ? "any" : true,
        preload: "auto",
        playsinline: true,
        crossOrigin,
        nativeTextTracks: false,
        playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
        html5: {
          vhs: {
            withCredentials: useCredentials,
            overrideNative: true,
          },
          nativeTextTracks: false,
        },
        controlBar: {
          children: [
            "currentTimeDisplay",
            "progressControl",
            "durationDisplay",
            "volumePanel",
            "subsCapsButton",
            "fullscreenToggle",
            "PipToggleButton",
            "OverflowMenuButton",
          ],
        },
      });

      const player = playerRef.current as any;
      if (!player) return;
      const resolvedPlayerElement = (() => {
        const element = player?.el?.() as HTMLElement | undefined;
        if (!element) return null;
        if (element.tagName.toLowerCase() === "video") return element.parentElement;
        return element;
      })();
      setPlayerElement(resolvedPlayerElement ?? null);

      const Button = videojs.getComponent("Button");
      const MenuButton = videojs.getComponent("MenuButton");
      const MenuItem = videojs.getComponent("MenuItem");
      const controlBar = player.controlBar;
      if (controlBar && !controlBar.getChild("PipToggleButton")) {
        controlBar.addChild("PipToggleButton", {});
      }
      if (controlBar && !controlBar.getChild("OverflowMenuButton")) {
        controlBar.addChild("OverflowMenuButton", {});
      }

      let qualityButton: any = null;
      let qualityRetryId: ReturnType<typeof setTimeout> | null = null;
      const qualityButtonName = "QualityMenuButton";

      const ensureQualityMenu = () => {
        const representations = getVideoRepresentations(player);
        const hasRealQualityInfo = representations.some((rep) => {
          const height = typeof rep?.height === "number" ? rep.height : 0;
          const bandwidth =
            typeof rep?.bandwidth === "number" ? rep.bandwidth : typeof rep?.bitrate === "number" ? rep.bitrate : 0;
          return height > 0 || bandwidth > 0;
        });
        if (representations.length === 0 && isHls && !qualityRetryId) {
          qualityRetryId = setTimeout(() => {
            qualityRetryId = null;
            if (playerRef.current === player) ensureQualityMenu();
          }, 500);
        }
        if (!hasRealQualityInfo) {
          if (qualityButton && player.controlBar) {
            player.controlBar.removeChild(qualityButton);
            qualityButton = null;
          }
          return;
        }

        if (!videojs.getComponent(qualityButtonName)) {
          const QualityMenuItem = class extends (MenuItem as any) {
            rep?: any;
            isAuto: boolean;

            constructor(playerInstance: any, options: any) {
              super(playerInstance, options);
              this.rep = options?.rep;
              this.isAuto = Boolean(options?.isAuto);
              this.on("click", this.handleClick);
            }

            handleClick() {
              const playerInstance = this.player();
              const reps = getVideoRepresentations(playerInstance);
              if (!reps.length) return;
              if (this.isAuto) {
                reps.forEach((rep) => rep?.enabled?.(true));
              } else {
                reps.forEach((rep) => rep?.enabled?.(rep === this.rep));
              }
              playerInstance.trigger("qualitychange");
              const button = playerInstance?.controlBar?.getChild?.(qualityButtonName) as any;
              button?.update?.();
            }
          };

          const QualityMenuButton = class extends (MenuButton as any) {
            items: any[] = [];
            constructor(playerInstance: any, options: any) {
              super(playerInstance, options);
              this.controlText("Quality");
              this.addClass("vjs-quality-selector");
              this.addClass("vjs-icon-cog");
              this.addClass("vjs-menu-button-popup");
            }

            createItems() {
              const playerInstance = this.player();
              const reps = getVideoRepresentations(playerInstance);
              if (!reps.length) {
                return [
                  new QualityMenuItem(playerInstance, {
                    label: "Auto",
                    selectable: false,
                    selected: true,
                    isAuto: true,
                  }),
                ];
              }
              const { isAuto, activeRep } = getQualitySelection(reps);

              const sorted = reps
                .map((rep, index) => ({
                  rep,
                  height: rep?.height ?? 0,
                  bandwidth: rep?.bandwidth ?? rep?.bitrate ?? 0,
                  index,
                }))
                .sort((left, right) => {
                  if (left.height !== right.height) return right.height - left.height;
                  if (left.bandwidth !== right.bandwidth) return right.bandwidth - left.bandwidth;
                  return left.index - right.index;
                });

              const items = [
                new QualityMenuItem(playerInstance, {
                  label: "Auto",
                  selectable: true,
                  selected: isAuto,
                  isAuto: true,
                }),
              ];

              sorted.forEach(({ rep, height, bandwidth }) => {
                const label = height ? `${height}p` : bandwidth ? `${Math.round(bandwidth / 1000)} kbps` : "Source";
                items.push(
                  new QualityMenuItem(playerInstance, {
                    label,
                    selectable: true,
                    selected: !isAuto && activeRep === rep,
                    rep,
                    isAuto: false,
                  })
                );
              });

              this.items = items;
              return items;
            }

            update() {
              const reps = getVideoRepresentations(this.player());
              if (!reps.length) return;
              const { isAuto, activeRep } = getQualitySelection(reps);
              this.items?.forEach((item) => {
                if (item?.isAuto) {
                  item.selected?.(isAuto);
                } else if (item?.rep) {
                  item.selected?.(activeRep === item.rep);
                }
              });
            }
          };

          videojs.registerComponent(qualityButtonName, QualityMenuButton as any);
        }

        if (!qualityButton && player.controlBar) {
          qualityButton = player.controlBar.addChild(qualityButtonName, {});
          const fullscreenToggle = player.controlBar.getChild("FullscreenToggle");
          if (fullscreenToggle && qualityButton?.el && player.controlBar.el) {
            player.controlBar.el().insertBefore(qualityButton.el(), fullscreenToggle.el());
          }
        }

        qualityButton?.update?.();
      };

      player.ready(() => {
        ensureQualityMenu();
      });
      player.on("loadedmetadata", ensureQualityMenu);
      player.on("loadeddata", ensureQualityMenu);
      player.on("canplay", ensureQualityMenu);
      player.on("play", ensureQualityMenu);
      player.on("qualitychange", ensureQualityMenu);
      player.on("overflowtoggle", () => {
        setIsSettingsOpen((prev) => !prev);
      });
      player.on("piptoggle", () => {
        void handleTogglePip();
      });
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
      setPlayerElement(null);
      setIsVideoFrameReady(false);
    };
  }, [handleTogglePip, isCustomPlaylistAnnotation, isHls, isVideo]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handlePlayState = () => setIsPlaying(!player.paused());
    player.on("play", handlePlayState);
    player.on("pause", handlePlayState);
    player.on("ended", handlePlayState);
    player.on("loadedmetadata", handlePlayState);
    handlePlayState();
    return () => {
      player.off("play", handlePlayState);
      player.off("pause", handlePlayState);
      player.off("ended", handlePlayState);
      player.off("loadedmetadata", handlePlayState);
    };
  }, [isVideo, proxiedVideoSrc]);

  const recordPlaybackView = useCallback(async () => {
    if (
      !shouldRecordMediaPlaybackView({
        eventType: "playing",
        isVideo,
        packageId: item?.packageId,
        artifactId: item?.id,
        alreadyRecorded: viewRecordedRef.current,
      }) ||
      !item?.packageId ||
      !item?.id
    ) {
      return;
    }
    const storageKey = buildMediaViewStorageKey({
      workspaceSlug,
      projectId,
      packageId: item.packageId,
      artifactId: item.id,
    });
    if (typeof window !== "undefined") {
      try {
        if (window.sessionStorage.getItem(storageKey)) {
          viewRecordedRef.current = true;
          return;
        }
        window.sessionStorage.setItem(storageKey, "1");
      } catch {}
    }
    viewRecordedRef.current = true;
    try {
      const response = await mediaLibraryService.recordArtifactView(workspaceSlug, projectId, item.packageId, item.id, {
        session_id: getMediaViewerSessionId(),
      });
      if (typeof response.views === "number") {
        handleMediaItemUpdated({
          views: response.views,
          meta: {
            ...(item.meta ?? {}),
            views: response.views,
          },
        });
      }
    } catch {
      // View counting should never interrupt playback.
      console.error("Failed to record media playback view:", workspaceSlug, projectId, item?.packageId, item?.id);
    }
  }, [
    handleMediaItemUpdated,
    isVideo,
    item?.id,
    item?.meta,
    item?.packageId,
    mediaLibraryService,
    projectId,
    workspaceSlug,
  ]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !isVideo) return;
    const handlePlaybackStarted = () => {
      void recordPlaybackView();
    };
    player.on("playing", handlePlaybackStarted);
    return () => {
      player.off("playing", handlePlaybackStarted);
    };
  }, [isVideo, proxiedVideoSrc, recordPlaybackView]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !isVideo) return;

    const updateVideoTime = () => {
      const currentTime = Number(player.currentTime?.() ?? 0);
      const duration = Number(player.duration?.() ?? 0);
      const mediaSeconds = Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;

      setCurrentVideoSeconds(mediaSeconds);
      setCurrentVideoDurationSeconds(Number.isFinite(duration) && duration > 0 ? duration : null);
    };
    const playerEvents = [
      "durationchange",
      "ended",
      "loadedmetadata",
      "pause",
      "play",
      "ratechange",
      "seeked",
      "seeking",
      "timeupdate",
    ];

    playerEvents.forEach((eventName) => player.on(eventName, updateVideoTime));
    updateVideoTime();

    return () => {
      playerEvents.forEach((eventName) => player.off(eventName, updateVideoTime));
    };
  }, [effectiveVideoSrc, isVideo, item?.id]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handleChange = () => setPlayerTick((value) => value + 1);
    player.on("qualitychange", handleChange);
    player.on("ratechange", handleChange);
    return () => {
      player.off("qualitychange", handleChange);
      player.off("ratechange", handleChange);
    };
  }, [isVideo, proxiedVideoSrc]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handleReady = () => {
      setPlayerTick((value) => value + 1);
      const readyState = Number(player.readyState?.() ?? videoRef.current?.readyState ?? 0);
      if (readyState >= VIDEO_READY_STATE_HAVE_CURRENT_DATA) {
        setIsVideoFrameReady(true);
      }
    };
    const playerEvents = ["loadedmetadata", "loadeddata", "canplay", "playing", "play"];

    playerEvents.forEach((eventName) => player.on(eventName, handleReady));
    handleReady();

    return () => {
      playerEvents.forEach((eventName) => player.off(eventName, handleReady));
    };
  }, [effectiveVideoSrc, isVideo, item?.id]);

  useEffect(() => {
    const player = playerRef.current as any;
    if (!player) return;
    if (!isSettingsOpen) {
      if (inactivityTimeoutRef.current !== null && typeof player.inactivityTimeout === "function") {
        player.inactivityTimeout(inactivityTimeoutRef.current);
        inactivityTimeoutRef.current = null;
      }
      return;
    }

    if (typeof player.inactivityTimeout === "function") {
      if (inactivityTimeoutRef.current === null) {
        inactivityTimeoutRef.current = player.inactivityTimeout();
      }
      player.inactivityTimeout(0);
    }

    const keepControlsActive = () => {
      if (typeof player.userActive === "function") {
        player.userActive(true);
      }
      player.addClass?.("vjs-user-active");
      player.removeClass?.("vjs-user-inactive");
      player.controlBar?.show?.();
    };

    keepControlsActive();
    player.on?.("userinactive", keepControlsActive);
    return () => {
      player.off?.("userinactive", keepControlsActive);
    };
  }, [isSettingsOpen, isVideo, proxiedVideoSrc]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (settingsPanelRef.current?.contains(target)) return;
      if (target.closest(".vjs-overflow-button")) return;
      setIsSettingsOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsSettingsOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    const player = playerRef.current;
    setIsVideoFrameReady(false);
    if (!player || !effectiveVideoSrc) return;
    setCurrentVideoSeconds(0);
    const type = getVideoMimeType(resolvedVideoFormat);
    const source = type ? { src: effectiveVideoSrc, type } : { src: effectiveVideoSrc };
    player.autoplay(isCustomPlaylistAnnotation ? "any" : true);
    player.src(source);
    player.poster(item?.thumbnail ?? "");
  }, [item?.thumbnail, effectiveVideoSrc, isCustomPlaylistAnnotation, resolvedVideoFormat]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const tracks = getCaptionTracks(item?.meta);
    const existing = player.remoteTextTracks?.();
    const trackList = existing as { length?: number; item?: (index: number) => TextTrack | null } | undefined;
    const trackCount = typeof trackList?.length === "number" ? trackList.length : 0;
    if (trackCount && typeof trackList?.item === "function") {
      for (let i = trackCount - 1; i >= 0; i -= 1) {
        const track = trackList.item(i);
        if (track) player.removeRemoteTextTrack(track);
      }
    }
    if (!tracks.length) return;
    tracks.forEach((track) => {
      player.addRemoteTextTrack(
        {
          kind: track.kind ?? "captions",
          src: track.src,
          srclang: track.srclang,
          label: track.label ?? "CC",
          default: track.default ?? false,
        },
        false
      );
    });
  }, [item?.meta]);

  useEffect(() => {
    if (!isVideo) return;
    const video = videoRef.current;
    if (!video) return;

    const handleEnterPip = () => {
      const tracks = video.textTracks;
      if (!tracks || tracks.length === 0) return;
      const previousModes: Array<{ track: TextTrack; mode: TPipCaptionMode }> = [];
      for (let i = 0; i < tracks.length; i += 1) {
        const track = tracks[i];
        if (track && (track.kind === "captions" || track.kind === "subtitles")) {
          previousModes.push({ track, mode: track.mode });
          track.mode = "showing";
        }
      }
      pipCaptionModesRef.current = previousModes;
    };

    const handleLeavePip = () => {
      pipCaptionModesRef.current.forEach(({ track, mode }) => {
        try {
          track.mode = mode;
        } catch {}
      });
      pipCaptionModesRef.current = [];
    };

    video.addEventListener("enterpictureinpicture", handleEnterPip);
    video.addEventListener("leavepictureinpicture", handleLeavePip);
    return () => {
      video.removeEventListener("enterpictureinpicture", handleEnterPip);
      video.removeEventListener("leavepictureinpicture", handleLeavePip);
    };
  }, [isVideo]);

  const handleOverlayToggle = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused()) {
      Promise.resolve(player.play?.()).catch(() => undefined);
    } else {
      player.pause?.();
    }
  }, []);

  const handleOverlaySeek = useCallback((delta: number) => {
    const player = playerRef.current;
    if (!player) return;
    const current = player.currentTime() ?? 0;
    const seekable = player.seekable && player.seekable();
    let target = current + delta;
    const duration = player.duration?.();
    if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
      target = Math.min(duration, Math.max(0, target));
    } else if (seekable && seekable.length) {
      const start = seekable.start(0);
      const end = seekable.end(0);
      target = Math.min(end, Math.max(start, target));
    } else {
      target = Math.max(0, target);
    }
    player.currentTime(target);
  }, []);

  const qualityOptions = useMemo(() => {
    const player = playerRef.current as any;
    if (!player) {
      return [{ key: "auto", label: "Auto", isAuto: true, selected: true, rep: null }];
    }
    const reps = getVideoRepresentations(player);
    if (!reps.length) {
      return [{ key: "auto", label: "Auto", isAuto: true, selected: true, rep: null, disabled: true }];
    }
    const { isAuto, activeRep } = getQualitySelection(reps);
    const sorted = reps
      .map((rep, index) => ({
        rep,
        height: rep?.height ?? 0,
        bandwidth: rep?.bandwidth ?? rep?.bitrate ?? 0,
        index,
      }))
      .sort((left, right) => {
        if (left.height !== right.height) return right.height - left.height;
        if (left.bandwidth !== right.bandwidth) return right.bandwidth - left.bandwidth;
        return left.index - right.index;
      });
    const items: Array<{
      key: string;
      label: string;
      isAuto: boolean;
      selected: boolean;
      rep: any;
      disabled?: boolean;
    }> = [];
    const fallbackSelected = qualitySelection === null ? (isAuto ? "auto" : null) : qualitySelection;
    if (sorted.length > 1) {
      items.push({
        key: "auto",
        label: "Auto",
        isAuto: true,
        selected: fallbackSelected === "auto" || (qualitySelection === null && isAuto),
        rep: null,
      });
    }
    sorted.forEach(({ rep, height, bandwidth }) => {
      const label = height ? `${height}p` : bandwidth ? `${Math.round(bandwidth / 1000)} kbps` : "Source";
      const key = `${label}-${bandwidth}-${height}-${rep?.id ?? ""}`;
      const isSelected = qualitySelection === key || (qualitySelection === null && !isAuto && activeRep === rep);
      items.push({
        key,
        label,
        isAuto: false,
        selected: isSelected,
        rep,
      });
    });
    if (sorted.length === 1 && !items.some((item) => item.selected)) {
      items[0].selected = true;
    }
    return items;
  }, [playerTick, qualitySelection]);

  const playbackRates = useMemo(() => {
    const player = playerRef.current as any;
    const rates = player?.playbackRates?.();
    return Array.isArray(rates) && rates.length ? rates : [0.5, 0.75, 1, 1.25, 1.5, 2];
  }, [playerTick]);

  const currentPlaybackRate = useMemo(() => {
    const player = playerRef.current as any;
    const rate = player?.playbackRate?.();
    return typeof rate === "number" ? rate : 1;
  }, [playerTick]);

  const handleQualitySelect = useCallback((option: { isAuto: boolean; rep: any; key?: string }) => {
    const player = playerRef.current as any;
    if (!player) return;
    const reps = getVideoRepresentations(player);
    if (!reps.length) return;
    if (option.isAuto) {
      reps.forEach((rep) => rep?.enabled?.(true));
      setQualitySelection("auto");
    } else {
      reps.forEach((rep) => rep?.enabled?.(rep === option.rep));
      if (option.key) setQualitySelection(option.key);
    }
    player.trigger("qualitychange");
    setPlayerTick((value) => value + 1);
  }, []);

  const handlePlaybackRate = useCallback((rate: number) => {
    const player = playerRef.current as any;
    if (!player) return;
    player.playbackRate(rate);
    setPlayerTick((value) => value + 1);
  }, []);
  const handleVideoTimelineSeek = useCallback((seconds: number) => {
    const player = playerRef.current;
    if (!player || !Number.isFinite(seconds)) return;

    const duration = Number(player.duration?.() ?? 0);
    const targetSeconds =
      Number.isFinite(duration) && duration > 0 ? Math.min(duration, Math.max(0, seconds)) : Math.max(0, seconds);

    player.currentTime(targetSeconds);
    setCurrentVideoSeconds(targetSeconds);
  }, []);
  const handleAnnotationPause = useCallback(() => {
    const player = playerRef.current;
    player?.pause?.();
  }, []);
  const handleOpenVideoAnnotationWorkspace = useCallback(() => {
    const player = playerRef.current;

    if (!isCustomPlaylistAnnotation) player?.pause?.();
    setHasUnsavedVideoAnnotationChanges(false);
    setIsVideoAnnotationWorkspaceOpen(true);
    setVideoAnnotationWorkspaceActivationKey((currentValue) => currentValue + 1);
  }, [isCustomPlaylistAnnotation]);
  const handleRegisterVideoAnnotationSaveHandler = useCallback((saveAnnotations: (() => Promise<boolean>) | null) => {
    videoAnnotationSaveBeforeCloseRef.current = saveAnnotations;
  }, []);
  const handleCloseVideoAnnotationWorkspace = useCallback(async () => {
    const saveAnnotations = videoAnnotationSaveBeforeCloseRef.current;
    if (saveAnnotations) {
      const canClose = await saveAnnotations();
      if (!canClose) return false;
    }

    const player = playerRef.current;

    setIsVideoAnnotationMode(false);
    setHasUnsavedVideoAnnotationChanges(false);
    player?.controls?.(true);
    if (shouldOpenVideoAnnotationWorkspaceFromQuery) {
      router.push(backHref);
      return true;
    }

    setIsVideoAnnotationWorkspaceOpen(false);
    return true;
  }, [backHref, router, shouldOpenVideoAnnotationWorkspaceFromQuery]);
  const handleDiscardVideoAnnotationWorkspace = useCallback(() => {
    const player = playerRef.current;

    setIsVideoAnnotationMode(false);
    setHasUnsavedVideoAnnotationChanges(false);
    player?.controls?.(true);
    if (shouldOpenVideoAnnotationWorkspaceFromQuery) {
      router.push(backHref);
      return;
    }

    setIsVideoAnnotationWorkspaceOpen(false);
  }, [backHref, router, shouldOpenVideoAnnotationWorkspaceFromQuery]);
  const handleAnnotationModeChange = useCallback((enabled: boolean) => {
    setIsVideoAnnotationMode(enabled);

    const player = playerRef.current;
    player?.controls?.(true);
  }, []);
  const handleSaveVideoAnnotations = useCallback(
    async (annotations: TCustomPlaylistAnnotation[]) => {
      if (!item?.packageId || !item.id) {
        throw new Error("Uploaded video annotations can only be saved on media library videos.");
      }

      const annotationViewKey = buildSgEventAnnotationViewKey({
        deviceId: annotationDeviceIdParam,
        streamId: annotationStreamIdParam,
        streamName: annotationStreamParam,
        viewKey: annotationViewKeyParam,
        videoSrc: annotationVideoSrcParam,
      });
      if (shouldOpenVideoAnnotationWorkspaceFromQuery && annotationViewKey) {
        const updatedEvent = await mediaLibraryService.updateEventVideoAnnotations(
          workspaceSlug,
          projectId,
          item.packageId,
          item.id,
          {
            annotations,
            device_id: annotationDeviceIdParam,
            stream_id: annotationStreamIdParam,
            stream_name: annotationStreamParam,
            view_key: annotationViewKey,
          }
        );
        const updatedAnnotations = getSgEventMediaReferenceAnnotations(item.meta ?? {}, {
          deviceId: annotationDeviceIdParam,
          eventPayload: updatedEvent.eventPayload,
          streamId: annotationStreamIdParam,
          streamName: annotationStreamParam,
          title: annotationViewParam,
          viewKey: annotationViewKey,
          videoSrc: annotationVideoSrcParam,
        });
        const nextAnnotations = updatedAnnotations.length > 0 ? updatedAnnotations : annotations;
        const annotationCount = nextAnnotations.length;
        handleMediaItemUpdated({
          isAnnotated: annotationCount > 0,
          meta: {
            ...(item.meta ?? {}),
            annotations: nextAnnotations,
            annotation_count: annotationCount,
            annotationViewKey,
            has_annotations: annotationCount > 0,
          },
        });

        return nextAnnotations;
      }

      const nextMeta = {
        ...(item.meta ?? {}),
        annotations,
        annotation_count: annotations.length,
        has_annotations: annotations.length > 0,
      };

      await mediaLibraryService.updateManifestArtifacts(workspaceSlug, projectId, item.packageId, {
        artifact_id: item.id,
        artifact: {
          meta: nextMeta,
        },
      });
      handleMediaItemUpdated({ isAnnotated: annotations.length > 0, meta: nextMeta });

      return annotations;
    },
    [
      annotationDeviceIdParam,
      annotationStreamIdParam,
      annotationStreamParam,
      annotationVideoSrcParam,
      annotationViewKeyParam,
      annotationViewParam,
      handleMediaItemUpdated,
      item?.id,
      item?.meta,
      item?.packageId,
      mediaLibraryService,
      projectId,
      shouldOpenVideoAnnotationWorkspaceFromQuery,
      workspaceSlug,
    ]
  );
  const canAnnotateCurrentVideo = isVideo && Boolean(item?.packageId && item.id);
  const isFocusedVideoAnnotationWorkspace = isVideo && isVideoAnnotationWorkspaceOpen;

  useEffect(() => {
    if (!shouldOpenVideoAnnotationWorkspaceFromQuery || !canAnnotateCurrentVideo) return;

    handleOpenVideoAnnotationWorkspace();
  }, [canAnnotateCurrentVideo, handleOpenVideoAnnotationWorkspace, shouldOpenVideoAnnotationWorkspaceFromQuery]);

  useEffect(() => {
    if (!isFocusedVideoAnnotationWorkspace || typeof window === "undefined") return;

    const guardStateKey = "planeVideoAnnotationBackGuard";
    const getHistoryState = () => {
      const state = window.history.state;
      return state && typeof state === "object" ? (state as Record<string, unknown>) : {};
    };
    const pushGuardState = () => {
      const state = getHistoryState();
      if (state[guardStateKey] === true) return;

      window.history.pushState({ ...state, [guardStateKey]: true }, "", window.location.href);
    };

    pushGuardState();

    const handleBrowserBack = (event: PopStateEvent) => {
      const state = event.state;
      const isGuardState = Boolean(state && typeof state === "object" && guardStateKey in state);
      if (isGuardState) return;

      if (hasUnsavedVideoAnnotationChanges) {
        setVideoAnnotationBackPromptKey((currentValue) => currentValue + 1);
        pushGuardState();
        return;
      }

      handleDiscardVideoAnnotationWorkspace();
    };

    window.addEventListener("popstate", handleBrowserBack);
    return () => {
      window.removeEventListener("popstate", handleBrowserBack);
    };
  }, [handleDiscardVideoAnnotationWorkspace, hasUnsavedVideoAnnotationChanges, isFocusedVideoAnnotationWorkspace]);

  if (!item && isLoading) {
    return (
      <div className="rounded-lg border border-custom-border-200 bg-custom-background-100 p-6 text-center text-sm text-custom-text-300">
        <div className="flex flex-col items-center gap-2">
          <LogoSpinner />
          <span>Loading media...</span>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="rounded-lg border border-dashed border-custom-border-200 bg-custom-background-100 p-6 text-center text-sm text-custom-text-300">
        Media not found.
      </div>
    );
  }
  const createdBy = getMetaString(meta, ["created_by", "createdBy"], "");
  const createdByLabel = (createdBy ? (getUserDetails(createdBy)?.display_name ?? createdBy) : "") || item.author;
  const canAnnotateUploadedVideo = canAnnotateCurrentVideo;

  if (isSgEventAsset && !(shouldOpenVideoAnnotationWorkspaceFromQuery && isVideo)) {
    return (
      <SgEventDetailPage
        enableMatrixView
        defaultTagViewMode="list"
        showTagListActions={false}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        mediaItem={item}
        fallbackBackHref={backHref}
        onBack={() => router.push(backHref)}
      />
    );
  }

  return (
    <div className="vertical-scrollbar scrollbar-md relative h-full w-full overflow-x-hidden overflow-y-auto lg:overflow-hidden">
      <div
        className={[
          "flex min-h-full flex-col lg:h-full lg:min-h-0",
          isFocusedVideoAnnotationWorkspace ? "gap-2 px-2 py-2" : "gap-6 px-3 py-3 lg:gap-4",
        ].join(" ")}
      >
        {!isFocusedVideoAnnotationWorkspace ? (
          <div className="flex items-center justify-between gap-4">
            <Link
              href={backHref}
              className="inline-flex items-center gap-2 rounded-full px-4 py-1 text-xs text-custom-text-300 hover:text-custom-text-100"
            >
              <ArrowLeft className="size-md h-3.2 w-3.2" />
            </Link>

            {/* Currently not using this section */}

            {/* <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-custom-border-200 bg-custom-background-100 px-1 py-1 text-[11px] text-custom-text-300">
            <button
              type="button"
              className="rounded-full border border-custom-border-200 px-3 py-1 hover:text-custom-text-100"
            >
              View 1
            </button>
            <button
              type="button"
              className="rounded-full border border-custom-border-200 px-3 py-1 hover:text-custom-text-100"
            >
              View 2
            </button>
            <button
              type="button"
              className="rounded-full border border-custom-border-200 px-3 py-1 hover:text-custom-text-100"
            >
              View 3
            </button>
          </div>
        </div> */}
          </div>
        ) : null}

        <div
          className={[
            "grid",
            isFocusedVideoAnnotationWorkspace
              ? "min-h-0 flex-1 gap-0"
              : "gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[2fr_1fr] lg:gap-0",
          ].join(" ")}
        >
          <div
            className={[
              "flex flex-col",
              isFocusedVideoAnnotationWorkspace ? "h-full min-h-0 w-full gap-2" : "gap-6 lg:min-h-0",
            ].join(" ")}
          >
            <MediaDetailPreview
              item={item}
              isVideo={isVideo}
              isImageZoomOpen={isImageZoomOpen}
              setIsImageZoomOpen={setIsImageZoomOpen}
              videoRef={videoRef}
              isPlaying={isPlaying}
              canAnnotateVideo={canAnnotateUploadedVideo}
              isVideoAnnotationMode={isVideoAnnotationMode}
              isVideoAnnotationWorkspaceOpen={isFocusedVideoAnnotationWorkspace}
              hasUnsavedVideoAnnotationChanges={hasUnsavedVideoAnnotationChanges}
              onOverlayToggle={handleOverlayToggle}
              onOverlaySeek={handleOverlaySeek}
              onOpenVideoAnnotationWorkspace={handleOpenVideoAnnotationWorkspace}
              onCloseVideoAnnotationWorkspace={handleCloseVideoAnnotationWorkspace}
              onDiscardVideoAnnotationWorkspace={handleDiscardVideoAnnotationWorkspace}
              videoAnnotationBackPromptKey={videoAnnotationBackPromptKey}
              isSettingsOpen={isSettingsOpen}
              onCloseSettings={() => setIsSettingsOpen(false)}
              qualityOptions={qualityOptions}
              playbackRates={playbackRates}
              currentPlaybackRate={currentPlaybackRate}
              onSelectQuality={handleQualitySelect}
              onSelectRate={handlePlaybackRate}
              settingsPanelRef={settingsPanelRef}
              playerElement={playerElement}
              crossOrigin={crossOrigin}
              onVideoAnnotationPropertiesElementChange={setVideoAnnotationPropertiesElement}
              onVideoAnnotationToolbarElementChange={setVideoAnnotationToolbarElement}
              onVideoTimelineElementChange={setVideoTimelineElement}
              showVideoTimeline={isFocusedVideoAnnotationWorkspace}
              videoAnnotationContent={
                isVideo && isVideoFrameReady ? (
                  <VideoAnnotationEditor
                    annotationKey={`${item.packageId ?? ""}:${item.id}`}
                    annotations={item.meta?.annotations}
                    autoEnableAnnotationModeKey={
                      isFocusedVideoAnnotationWorkspace ? videoAnnotationWorkspaceActivationKey : undefined
                    }
                    canEdit={isFocusedVideoAnnotationWorkspace && Boolean(item.packageId && item.id)}
                    currentTime={currentVideoSeconds}
                    durationSeconds={currentVideoDurationSeconds}
                    enableAnnotationTransforms
                    enableTextTool
                    fitToVideoBounds
                    isPlaying={isPlaying}
                    modeResetKey={`${item.id}:${isFocusedVideoAnnotationWorkspace ? "open" : "closed"}`}
                    onModeChange={handleAnnotationModeChange}
                    onRegisterSaveHandler={handleRegisterVideoAnnotationSaveHandler}
                    onUnsavedChangesChange={setHasUnsavedVideoAnnotationChanges}
                    onRequestPause={handleAnnotationPause}
                    onSave={handleSaveVideoAnnotations}
                    onSeek={handleVideoTimelineSeek}
                    playbackRate={currentPlaybackRate}
                    propertyHostElement={isFocusedVideoAnnotationWorkspace ? videoAnnotationPropertiesElement : null}
                    toolbarHostElement={isFocusedVideoAnnotationWorkspace ? videoAnnotationToolbarElement : null}
                    showTimeline={isFocusedVideoAnnotationWorkspace}
                    thumbnailUrl={item.thumbnail}
                    timelineHostElement={isFocusedVideoAnnotationWorkspace ? videoTimelineElement : null}
                  />
                ) : null
              }
              effectiveImageSrc={effectiveImageSrc}
              isUnsupportedDocument={isUnsupportedDocument}
              isBinaryDocument={isBinaryDocument}
              isDocumentPreviewLoading={isDocumentPreviewLoading}
              documentPreviewError={documentPreviewError}
              documentPreviewHtml={documentPreviewHtml}
              sanitizedDocumentPreviewHtml={sanitizedDocumentPreviewHtml}
              documentPreviewUrl={documentPreviewUrl}
              isTextDocument={isTextDocument}
              isTextPreviewLoading={isTextPreviewLoading}
              textPreviewError={textPreviewError}
              textPreview={textPreview}
              effectiveDocumentSrc={effectiveDocumentSrc}
              description={item.description ?? null}
              createdByLabel={createdByLabel}
              createdAt={item.createdAt}
            />
          </div>
          {isVideo ? (
            <style jsx global>
              {PLAYER_STYLE}
            </style>
          ) : null}

          {!isFocusedVideoAnnotationWorkspace ? (
            <MediaDetailSidebar
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              item={item}
              onMediaItemUpdated={handleMediaItemUpdated}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default MediaDetailPage;
