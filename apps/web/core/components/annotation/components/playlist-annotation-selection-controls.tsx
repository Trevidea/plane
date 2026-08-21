"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { Eraser, RotateCw } from "lucide-react";
import { Tooltip } from "@plane/propel/tooltip";
import type {
  TCustomPlaylistAnnotation,
  TCustomPlaylistAnnotationPoint,
  TCustomPlaylistAnnotationTool,
} from "../types/annotation.types";
import type {
  AnnotationBounds,
  AnnotationResizeHandle,
  AnnotationTransformMode,
} from "../types/playlist-annotation-overlay.types";
import { CANVAS_SIZE } from "../utils/playlist-annotation-model";
import { ANNOTATION_RESIZE_HANDLES } from "../utils/playlist-annotation-transform";

type PlaylistAnnotationSelectionControlsProps = {
  canTransformAnnotations: boolean;
  onCancelAnnotationTransform: (event: ReactPointerEvent<HTMLElement>) => boolean;
  onFinishAnnotationTransform: (event: ReactPointerEvent<HTMLElement>) => boolean;
  onDeleteAnnotation?: (annotationId: string) => void;
  onStartAnnotationTransform: (
    event: ReactPointerEvent<HTMLElement>,
    annotation: TCustomPlaylistAnnotation,
    mode: AnnotationTransformMode,
    resizeHandle?: AnnotationResizeHandle
  ) => boolean;
  onTransformPointerMove: (event: ReactPointerEvent<HTMLElement>) => boolean;
  selectedAnnotation: TCustomPlaylistAnnotation | null;
  selectedAnnotationBounds: AnnotationBounds | null;
  selectedAnnotationCanResize: boolean;
  selectedAnnotationRotation: number;
  selectedLinearAnnotationEndpoints: {
    end: TCustomPlaylistAnnotationPoint;
    start: TCustomPlaylistAnnotationPoint;
  } | null;
  selectedLinearAnnotationMidpoint: TCustomPlaylistAnnotationPoint | null;
  tool: TCustomPlaylistAnnotationTool;
};

export const PlaylistAnnotationSelectionControls = ({
  canTransformAnnotations,
  onCancelAnnotationTransform,
  onDeleteAnnotation,
  onFinishAnnotationTransform,
  onStartAnnotationTransform,
  onTransformPointerMove,
  selectedAnnotation,
  selectedAnnotationBounds,
  selectedAnnotationCanResize,
  selectedAnnotationRotation,
  selectedLinearAnnotationEndpoints,
  selectedLinearAnnotationMidpoint,
  tool,
}: PlaylistAnnotationSelectionControlsProps) => {
  const handleDeleteAnnotationPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, annotationId: string) => {
    if (!onDeleteAnnotation) return;

    event.preventDefault();
    event.stopPropagation();
    onDeleteAnnotation(annotationId);
  };

  if (
    canTransformAnnotations &&
    selectedAnnotation &&
    selectedLinearAnnotationEndpoints &&
    selectedLinearAnnotationMidpoint
  ) {
    return (
      <div className="pointer-events-none absolute inset-0 z-10">
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full overflow-visible"
          preserveAspectRatio="none"
          viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
        >
          <line
            x1={selectedLinearAnnotationEndpoints.start.x}
            y1={selectedLinearAnnotationEndpoints.start.y}
            x2={selectedLinearAnnotationEndpoints.end.x}
            y2={selectedLinearAnnotationEndpoints.end.y}
            stroke="#facc15"
            strokeDasharray="8 6"
            strokeLinecap="round"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {(
          [
            { handle: "start", label: "start", point: selectedLinearAnnotationEndpoints.start },
            { handle: "end", label: "end", point: selectedLinearAnnotationEndpoints.end },
          ] as const
        ).map(({ handle, label, point }) => (
          <span
            key={handle}
            className="pointer-events-none absolute flex h-5 w-5 items-center justify-center"
            style={{
              left: `${point.x / 10}%`,
              top: `${point.y / 10}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <button
              type="button"
              onPointerCancel={onCancelAnnotationTransform}
              onPointerDown={(event) => onStartAnnotationTransform(event, selectedAnnotation, "resize", handle)}
              onPointerMove={onTransformPointerMove}
              onPointerUp={onFinishAnnotationTransform}
              className="pointer-events-auto flex h-5 w-5 cursor-move items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#facc15]/50"
              aria-label={`Resize annotation ${label}`}
            >
              <span className="block h-3 w-3 rounded-full border-2 border-[#facc15] bg-transparent shadow-[0_2px_8px_rgba(0,0,0,0.35)]" />
            </button>
          </span>
        ))}
        <span
          className="pointer-events-none absolute flex items-center justify-center gap-1"
          style={{
            left: `${selectedLinearAnnotationMidpoint.x / 10}%`,
            top: `${selectedLinearAnnotationMidpoint.y / 10}%`,
            transform: "translate(-50%, calc(-50% - 2rem))",
          }}
        >
          <Tooltip tooltipContent="Rotate annotation" position="top" sideOffset={8}>
            <button
              type="button"
              onPointerCancel={onCancelAnnotationTransform}
              onPointerDown={(event) => onStartAnnotationTransform(event, selectedAnnotation, "rotate")}
              onPointerMove={onTransformPointerMove}
              onPointerUp={onFinishAnnotationTransform}
              className="pointer-events-auto relative flex h-6 w-6 cursor-grab items-center justify-center rounded-full border border-[#facc15] bg-custom-background-100 text-[13px] font-semibold leading-none text-[#facc15] shadow-[0_8px_20px_rgba(0,0,0,0.32)] outline-none transition-colors hover:bg-custom-background-90 focus-visible:ring-2 focus-visible:ring-[#facc15]/50 active:cursor-grabbing"
              aria-label="Rotate annotation"
            >
              <RotateCw className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2" />
            </button>
          </Tooltip>
          {onDeleteAnnotation ? (
            <Tooltip tooltipContent="Delete annotation" position="top" sideOffset={8}>
              <button
                type="button"
                onPointerDown={(event) => handleDeleteAnnotationPointerDown(event, selectedAnnotation.id)}
                className="pointer-events-auto relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-red-500/70 bg-custom-background-100 text-red-500 shadow-[0_8px_20px_rgba(0,0,0,0.32)] outline-none transition-colors hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-500/45"
                aria-label="Delete selected annotation"
              >
                <Eraser className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2" />
              </button>
            </Tooltip>
          ) : null}
        </span>
      </div>
    );
  }

  if (!canTransformAnnotations || !selectedAnnotation || !selectedAnnotationBounds) return null;

  const selectionBoundsStyle = {
    height:
      selectedAnnotation.type === "text"
        ? `${selectedAnnotationBounds.height / 10}%`
        : `max(24px, ${selectedAnnotationBounds.height / 10}%)`,
    left: `${selectedAnnotationBounds.x / 10}%`,
    top: `${selectedAnnotationBounds.y / 10}%`,
    transform: `rotate(${selectedAnnotationRotation}deg)`,
    transformOrigin: "center",
    width:
      selectedAnnotation.type === "text"
        ? `${selectedAnnotationBounds.width / 10}%`
        : `max(28px, ${selectedAnnotationBounds.width / 10}%)`,
  };
  const shouldRenderMoveSurface =
    selectedAnnotation.type === tool && (selectedAnnotation.type === "text" || selectedAnnotation.type === "image");

  return (
    <div
      className="pointer-events-none absolute z-10 rounded-[4px] border border-dashed border-[#facc15] shadow-[0_0_0_1px_rgba(0,0,0,0.36),0_0_18px_rgba(250,204,21,0.28)]"
      style={selectionBoundsStyle}
    >
      {shouldRenderMoveSurface ? (
        <button
          type="button"
          onPointerCancel={onCancelAnnotationTransform}
          onPointerDown={(event) => onStartAnnotationTransform(event, selectedAnnotation, "move")}
          onPointerMove={onTransformPointerMove}
          onPointerUp={onFinishAnnotationTransform}
          className="pointer-events-auto absolute inset-0 touch-none cursor-move rounded-[4px] bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[#facc15]/50"
          aria-label={`Move selected ${selectedAnnotation.type} annotation`}
        />
      ) : null}
      {selectedAnnotationCanResize
        ? ANNOTATION_RESIZE_HANDLES.map(({ className: handleClassName, cursorClassName, handle, label }) => (
            <span
              key={handle}
              className={`pointer-events-none absolute flex h-4 w-4 items-center justify-center ${handleClassName}`}
            >
              <button
                type="button"
                onPointerCancel={onCancelAnnotationTransform}
                onPointerDown={(event) => onStartAnnotationTransform(event, selectedAnnotation, "resize", handle)}
                onPointerMove={onTransformPointerMove}
                onPointerUp={onFinishAnnotationTransform}
                className={`pointer-events-auto flex h-4 w-4 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[#facc15]/50 ${cursorClassName}`}
                style={{
                  transform: `rotate(${-selectedAnnotationRotation}deg)`,
                }}
                aria-label={`Resize annotation ${label}`}
              >
                <span className="block h-2.5 w-2.5 rounded-[2px] border border-[#facc15] bg-custom-background-100 shadow-[0_2px_8px_rgba(0,0,0,0.35)]" />
              </button>
            </span>
          ))
        : null}
      <span className="absolute left-1/2 top-0 h-6 w-px -translate-x-1/2 -translate-y-full bg-[#facc15]" />
      <span className="pointer-events-none absolute left-1/2 top-0 flex -translate-x-1/2 -translate-y-[calc(100%+1.5rem)] items-center justify-center gap-1">
        <Tooltip tooltipContent="Rotate annotation" position="top" sideOffset={8}>
          <button
            type="button"
            onPointerCancel={onCancelAnnotationTransform}
            onPointerDown={(event) => onStartAnnotationTransform(event, selectedAnnotation, "rotate")}
            onPointerMove={onTransformPointerMove}
            onPointerUp={onFinishAnnotationTransform}
            className="pointer-events-auto relative flex h-6 w-6 cursor-grab items-center justify-center rounded-full border border-[#facc15] bg-custom-background-100 text-[13px] font-semibold leading-none text-[#facc15] shadow-[0_8px_20px_rgba(0,0,0,0.32)] outline-none transition-colors hover:bg-custom-background-90 focus-visible:ring-2 focus-visible:ring-[#facc15]/50 active:cursor-grabbing"
            style={{
              transform: `rotate(${-selectedAnnotationRotation}deg)`,
            }}
            aria-label="Rotate annotation"
          >
            <RotateCw className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2" />
          </button>
        </Tooltip>
        {onDeleteAnnotation ? (
          <Tooltip tooltipContent="Delete annotation" position="top" sideOffset={8}>
            <button
              type="button"
              onPointerDown={(event) => handleDeleteAnnotationPointerDown(event, selectedAnnotation.id)}
              className="pointer-events-auto relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-red-500/70 bg-custom-background-100 text-red-500 shadow-[0_8px_20px_rgba(0,0,0,0.32)] outline-none transition-colors hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-500/45"
              style={{
                transform: `rotate(${-selectedAnnotationRotation}deg)`,
              }}
              aria-label="Delete selected annotation"
            >
              <Eraser className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2" />
            </button>
          </Tooltip>
        ) : null}
      </span>
    </div>
  );
};
