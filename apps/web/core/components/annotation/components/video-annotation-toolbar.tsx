"use client";

import type { ReactNode } from "react";
import { Mic, PaintBucket, Save, Square, Trash2, Undo2 } from "lucide-react";
import type { TCustomPlaylistAnnotationStrokeStyle, TCustomPlaylistAnnotationTool } from "../types/annotation.types";
import type { VIDEO_ANNOTATION_TOOLS } from "../utils/video-annotation-editor-config";
import {
  VIDEO_ANNOTATION_DURATIONS,
  VIDEO_ANNOTATION_STROKE_STYLES,
  VIDEO_ANNOTATION_STROKE_WIDTHS,
  VIDEO_ANNOTATION_TOOL_BUTTON_CLASS,
} from "../utils/video-annotation-editor-config";

type VideoAnnotationToolOption = (typeof VIDEO_ANNOTATION_TOOLS)[number];

type VideoAnnotationToolbarProps = {
  annotationColorPicker: ReactNode;
  annotationDurationSeconds: number;
  annotationShapeBackgroundEnabled: boolean;
  annotationStrokeStyle: TCustomPlaylistAnnotationStrokeStyle;
  annotationStrokeWidth: number;
  annotationTool: TCustomPlaylistAnnotationTool | null;
  availableAnnotationTools: VideoAnnotationToolOption[];
  hasActiveAnnotations: boolean;
  hasAnnotationChanges: boolean;
  isAnnotationMode: boolean;
  isSavingAnnotations: boolean;
  isVoiceNarrationRecording: boolean;
  isVoiceNarrationSupported: boolean;
  onClearVisibleAnnotations: () => void;
  onDurationChange: (durationSeconds: number) => void;
  onSaveAnnotations: () => void;
  onSelectAnnotationTool: (tool: TCustomPlaylistAnnotationTool) => void;
  onShapeBackgroundToggle: (enabled: boolean) => void;
  onStartVoiceNarration: () => void;
  onStrokeStyleChange: (strokeStyle: TCustomPlaylistAnnotationStrokeStyle) => void;
  onStrokeWidthChange: (strokeWidth: number) => void;
  onStopVoiceNarration: () => void;
  onUndoVisibleAnnotation: () => void;
  recordingElapsedSeconds: number;
  shouldRenderSeparateAnnotationProperties: boolean;
};

export const VideoAnnotationToolbar = ({
  annotationColorPicker,
  annotationDurationSeconds,
  annotationShapeBackgroundEnabled,
  annotationStrokeStyle,
  annotationStrokeWidth,
  annotationTool,
  availableAnnotationTools,
  hasActiveAnnotations,
  hasAnnotationChanges,
  isAnnotationMode,
  isSavingAnnotations,
  isVoiceNarrationRecording,
  isVoiceNarrationSupported,
  onClearVisibleAnnotations,
  onDurationChange,
  onSaveAnnotations,
  onSelectAnnotationTool,
  onShapeBackgroundToggle,
  onStartVoiceNarration,
  onStrokeStyleChange,
  onStrokeWidthChange,
  onStopVoiceNarration,
  onUndoVisibleAnnotation,
  recordingElapsedSeconds,
  shouldRenderSeparateAnnotationProperties,
}: VideoAnnotationToolbarProps) => {
  const annotationButtonClass = VIDEO_ANNOTATION_TOOL_BUTTON_CLASS;
  const shouldShowShapeBackgroundControl = annotationTool === "rectangle" || annotationTool === "ellipse";

  return (
    <div className="flex flex-col items-center gap-1 rounded-[7px] border border-custom-border-200 bg-custom-background-100 p-1 shadow-sm">
      {isAnnotationMode ? (
        <>
          {availableAnnotationTools.map((toolOption) => {
            const ToolIcon = toolOption.icon;
            const isSelected = annotationTool === toolOption.type;

            return (
              <button
                key={toolOption.type}
                type="button"
                onClick={() => onSelectAnnotationTool(toolOption.type)}
                className={[
                  annotationButtonClass,
                  isSelected ? "border-custom-primary-100 bg-custom-primary-100/15 text-custom-primary-100" : "",
                ].join(" ")}
                aria-label={toolOption.label}
                aria-pressed={isSelected}
                title={toolOption.label}
              >
                <ToolIcon className="h-4 w-4" />
              </button>
            );
          })}

          {!shouldRenderSeparateAnnotationProperties ? (
            <>
              <span className="my-0.5 h-px w-6 bg-custom-border-200" />
              {annotationColorPicker}

              {shouldShowShapeBackgroundControl ? (
                <button
                  type="button"
                  onClick={() => onShapeBackgroundToggle(!annotationShapeBackgroundEnabled)}
                  className={[
                    annotationButtonClass,
                    annotationShapeBackgroundEnabled
                      ? "border-custom-primary-100 bg-custom-primary-100/15 text-custom-primary-100"
                      : "",
                  ].join(" ")}
                  aria-label="Toggle shape background fill"
                  aria-pressed={annotationShapeBackgroundEnabled}
                  title="Fill"
                >
                  <PaintBucket className="h-4 w-4" />
                </button>
              ) : null}

              <span className="my-0.5 h-px w-6 bg-custom-border-200" />
              {VIDEO_ANNOTATION_DURATIONS.map((durationSeconds) => {
                const isSelected = annotationDurationSeconds === durationSeconds;

                return (
                  <button
                    key={durationSeconds}
                    type="button"
                    onClick={() => onDurationChange(durationSeconds)}
                    className={[
                      "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] border border-custom-border-200 bg-custom-background-90 text-[10px] font-semibold text-custom-text-200 transition-colors hover:bg-custom-background-80 hover:text-custom-text-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100/40",
                      isSelected ? "border-custom-primary-100 bg-custom-primary-100/15 text-custom-primary-100" : "",
                    ].join(" ")}
                    aria-label={`Show annotation for ${durationSeconds} seconds`}
                    aria-pressed={isSelected}
                    title={`${durationSeconds}s duration`}
                  >
                    {durationSeconds}s
                  </button>
                );
              })}

              <span className="my-0.5 h-px w-6 bg-custom-border-200" />
              {VIDEO_ANNOTATION_STROKE_WIDTHS.map((strokeWidth) => {
                const isSelected = annotationStrokeWidth === strokeWidth;

                return (
                  <button
                    key={strokeWidth}
                    type="button"
                    onClick={() => onStrokeWidthChange(strokeWidth)}
                    className={[
                      annotationButtonClass,
                      isSelected ? "border-custom-primary-100 bg-custom-primary-100/15 text-custom-primary-100" : "",
                    ].join(" ")}
                    aria-label={`${strokeWidth}px annotation stroke`}
                    aria-pressed={isSelected}
                    title={`${strokeWidth}px`}
                  >
                    <span className="w-4 rounded-full bg-current" style={{ height: Math.max(2, strokeWidth / 1.5) }} />
                  </button>
                );
              })}

              {VIDEO_ANNOTATION_STROKE_STYLES.map((strokeStyleOption) => {
                const isSelected = annotationStrokeStyle === strokeStyleOption.value;

                return (
                  <button
                    key={strokeStyleOption.value}
                    type="button"
                    onClick={() => onStrokeStyleChange(strokeStyleOption.value)}
                    className={[
                      annotationButtonClass,
                      isSelected ? "border-custom-primary-100 bg-custom-primary-100/15 text-custom-primary-100" : "",
                    ].join(" ")}
                    aria-label={`${strokeStyleOption.label} annotation stroke`}
                    aria-pressed={isSelected}
                    title={`${strokeStyleOption.label} stroke`}
                  >
                    <span
                      className={[
                        "w-4 border-t-2 border-current",
                        strokeStyleOption.value === "dotted" ? "border-dotted" : "border-solid",
                      ].join(" ")}
                    />
                  </button>
                );
              })}
            </>
          ) : null}

          <span className="my-0.5 h-px w-6 bg-custom-border-200" />
          <button
            type="button"
            onClick={isVoiceNarrationRecording ? onStopVoiceNarration : onStartVoiceNarration}
            className={[
              annotationButtonClass,
              isVoiceNarrationRecording ? "border-red-500/60 bg-red-500/15 text-red-500" : "",
            ].join(" ")}
            disabled={!isVoiceNarrationSupported || isSavingAnnotations}
            aria-label={isVoiceNarrationRecording ? "Stop voice narration" : "Record voice narration"}
            aria-pressed={isVoiceNarrationRecording}
            title={
              isVoiceNarrationRecording
                ? "Stop narration"
                : isVoiceNarrationSupported
                  ? "Record narration"
                  : "Voice narration requires HTTPS or localhost and microphone access"
            }
          >
            {isVoiceNarrationRecording ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
          </button>
          {isVoiceNarrationRecording ? (
            <span className="font-mono text-[9px] font-semibold tabular-nums text-red-500">
              {Math.floor(recordingElapsedSeconds / 60)}:
              {String(Math.floor(recordingElapsedSeconds % 60)).padStart(2, "0")}
            </span>
          ) : null}

          <span className="my-0.5 h-px w-6 bg-custom-border-200" />
          <button
            type="button"
            onClick={onUndoVisibleAnnotation}
            className={annotationButtonClass}
            disabled={!hasActiveAnnotations || isSavingAnnotations}
            aria-label="Undo last annotation at this timestamp"
            title="Undo timestamp"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClearVisibleAnnotations}
            className={annotationButtonClass}
            disabled={!hasActiveAnnotations || isSavingAnnotations}
            aria-label="Clear annotations at this timestamp"
            title="Clear timestamp"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void onSaveAnnotations()}
            className={[
              annotationButtonClass,
              hasAnnotationChanges ? "border-green-500/45 bg-green-500/10 text-green-600" : "",
            ].join(" ")}
            disabled={!hasAnnotationChanges || isSavingAnnotations || isVoiceNarrationRecording}
            aria-label="Save annotations"
            title="Save"
          >
            <Save className="h-4 w-4" />
          </button>
        </>
      ) : null}
    </div>
  );
};
