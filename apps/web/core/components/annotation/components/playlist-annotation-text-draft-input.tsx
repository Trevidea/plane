"use client";

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, Ref } from "react";
import type { TCustomPlaylistAnnotationPoint } from "../types/annotation.types";
import { clamp } from "../utils/playlist-annotation-model";

export type PlaylistAnnotationTextDraft = {
  annotationId: string;
  isCommitted: boolean;
  point: TCustomPlaylistAnnotationPoint;
  value: string;
};

const TEXT_INPUT_HORIZONTAL_PADDING_PX = 18;

const getTextDraftInputWidth = (value: string, fontSize: number) => {
  const content = value.trim() || "Text";

  return Math.ceil(Math.max(fontSize * 1.6, content.length * fontSize * 0.62 + TEXT_INPUT_HORIZONTAL_PADDING_PX));
};

type PlaylistAnnotationTextDraftInputProps = {
  color: string;
  enabled: boolean;
  inputRef: Ref<HTMLInputElement>;
  onBlur: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onTextDraftChange: (value: string) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLInputElement>) => void;
  textDraft: PlaylistAnnotationTextDraft | null;
  textFontFamily: string;
  textFontSize: number;
  textFontWeight: number;
};

export const PlaylistAnnotationTextDraftInput = ({
  color,
  enabled,
  inputRef,
  onBlur,
  onKeyDown,
  onPointerDown,
  onTextDraftChange,
  textDraft,
  textFontFamily,
  textFontSize,
  textFontWeight,
}: PlaylistAnnotationTextDraftInputProps) => {
  if (!enabled || !textDraft) return null;

  const resolvedFontSize = clamp(textFontSize, 12, 32);

  return (
    <input
      ref={inputRef}
      type="text"
      value={textDraft.value}
      onBlur={onBlur}
      onChange={(event) => onTextDraftChange(event.target.value)}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      className="absolute z-20 h-8 rounded-[4px] border border-custom-border-200 bg-custom-background-100 px-2 text-[14px] font-semibold shadow-lg outline-none ring-2 ring-custom-primary-100/35 placeholder:text-custom-text-400"
      placeholder="Text"
      style={{
        boxSizing: "border-box",
        color,
        fontFamily: textFontFamily,
        fontSize: `${resolvedFontSize}px`,
        fontWeight: textFontWeight,
        left: `${textDraft.point.x / 10}%`,
        top: `${textDraft.point.y / 10}%`,
        transform: "translateY(-50%)",
        width: `${getTextDraftInputWidth(textDraft.value, resolvedFontSize)}px`,
      }}
    />
  );
};
