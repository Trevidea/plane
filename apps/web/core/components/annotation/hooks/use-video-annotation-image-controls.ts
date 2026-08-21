import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCustomPlaylistAnnotationTool } from "../types/annotation.types";
import {
  MAX_VIDEO_ANNOTATION_IMAGE_BYTES,
  VIDEO_ANNOTATION_IMAGE_SIZE_LIMITS,
} from "../utils/video-annotation-editor-config";
import { clampTimelineValue } from "../utils/video-annotation-timeline";

type UseVideoAnnotationImageControlsParams = {
  onModeChange?: (enabled: boolean) => void;
  onRequestPause?: () => void;
  setAnnotationTool: Dispatch<SetStateAction<TCustomPlaylistAnnotationTool>>;
  setIsAnnotationMode: Dispatch<SetStateAction<boolean>>;
};

const DEFAULT_IMAGE_ANNOTATION_WIDTH = 380;
const FALLBACK_IMAGE_ANNOTATION_ASPECT_RATIO = 16 / 9;
const FALLBACK_IMAGE_ANNOTATION_HEIGHT = Math.round(
  DEFAULT_IMAGE_ANNOTATION_WIDTH / FALLBACK_IMAGE_ANNOTATION_ASPECT_RATIO
);

const getImageAnnotationDefaultSize = (naturalWidth: number, naturalHeight: number) => {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return {
      height: FALLBACK_IMAGE_ANNOTATION_HEIGHT,
      width: DEFAULT_IMAGE_ANNOTATION_WIDTH,
    };
  }

  return {
    height: Math.round(DEFAULT_IMAGE_ANNOTATION_WIDTH * (naturalHeight / naturalWidth)),
    width: DEFAULT_IMAGE_ANNOTATION_WIDTH,
  };
};

const getImageAnnotationAspectRatio = (width: number, height: number) =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : FALLBACK_IMAGE_ANNOTATION_ASPECT_RATIO;

const getAspectLockedImageAnnotationSize = ({
  currentHeight,
  currentWidth,
  dimension,
  value,
}: {
  currentHeight: number;
  currentWidth: number;
  dimension: "height" | "width";
  value: string;
}) => {
  const nextValue = Math.round(
    clampTimelineValue(Number(value), VIDEO_ANNOTATION_IMAGE_SIZE_LIMITS.min, VIDEO_ANNOTATION_IMAGE_SIZE_LIMITS.max)
  );
  if (!Number.isFinite(nextValue)) return null;

  const aspectRatio = getImageAnnotationAspectRatio(currentWidth, currentHeight);

  if (dimension === "height") {
    return {
      height: nextValue,
      width: Math.round(nextValue * aspectRatio),
    };
  }

  return {
    height: Math.round(nextValue / aspectRatio),
    width: nextValue,
  };
};

export const useVideoAnnotationImageControls = ({
  onModeChange,
  onRequestPause,
  setAnnotationTool,
  setIsAnnotationMode,
}: UseVideoAnnotationImageControlsParams) => {
  const [annotationImageContent, setAnnotationImageContent] = useState<string | null>(null);
  const [annotationImageHeight, setAnnotationImageHeight] = useState(FALLBACK_IMAGE_ANNOTATION_HEIGHT);
  const [annotationImageName, setAnnotationImageName] = useState("");
  const [annotationImageOpacity, setAnnotationImageOpacity] = useState(1);
  const [annotationImagePlacementKey, setAnnotationImagePlacementKey] = useState(0);
  const [annotationImageWidth, setAnnotationImageWidth] = useState(DEFAULT_IMAGE_ANNOTATION_WIDTH);
  const annotationImageInputRef = useRef<HTMLInputElement | null>(null);

  const handleAnnotationImageChange = useCallback(
    (fileList: FileList | null) => {
      const selectedFile = fileList?.[0];
      if (!selectedFile) return;

      if (!selectedFile.type.startsWith("image/")) {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Image annotation failed",
          message: "Choose a valid image file.",
        });
        return;
      }

      if (selectedFile.size > MAX_VIDEO_ANNOTATION_IMAGE_BYTES) {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Image annotation failed",
          message: "Use an image smaller than 2 MB.",
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") return;

        const imageContent = reader.result;
        const image = new Image();
        image.onload = () => {
          const nextSize = getImageAnnotationDefaultSize(image.naturalWidth, image.naturalHeight);

          onRequestPause?.();
          setAnnotationImageContent(imageContent);
          setAnnotationImageHeight(nextSize.height);
          setAnnotationImageName(selectedFile.name);
          setAnnotationImagePlacementKey((currentValue) => currentValue + 1);
          setAnnotationImageWidth(nextSize.width);
          setAnnotationTool("image");
          setIsAnnotationMode(true);
          onModeChange?.(true);
        };
        image.onerror = () => {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: "Image annotation failed",
            message: "Unable to load this image file.",
          });
        };
        image.src = imageContent;
      };
      reader.onerror = () => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Image annotation failed",
          message: "Unable to read this image file.",
        });
      };
      reader.readAsDataURL(selectedFile);
    },
    [onModeChange, onRequestPause, setAnnotationTool, setIsAnnotationMode]
  );

  const handleAnnotationImageSizeChange = useCallback(
    (dimension: "height" | "width", value: string) => {
      const nextSize = getAspectLockedImageAnnotationSize({
        currentHeight: annotationImageHeight,
        currentWidth: annotationImageWidth,
        dimension,
        value,
      });
      if (!nextSize) return;

      setAnnotationImageHeight(nextSize.height);
      setAnnotationImageWidth(nextSize.width);
    },
    [annotationImageHeight, annotationImageWidth]
  );

  const handleAnnotationImageOpacityChange = useCallback((value: string) => {
    setAnnotationImageOpacity(clampTimelineValue(Number(value), 20, 100) / 100);
  }, []);

  return {
    annotationImageContent,
    annotationImageHeight,
    annotationImageInputRef,
    annotationImageName,
    annotationImageOpacity,
    annotationImagePlacementKey,
    annotationImageWidth,
    handleAnnotationImageChange,
    handleAnnotationImageOpacityChange,
    handleAnnotationImageSizeChange,
  };
};
