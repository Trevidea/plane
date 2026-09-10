"use client";
import { useEffect, useRef } from "react";
import { Pause, Play, Square, X, Loader2 } from "lucide-react";
import { Button } from "@plane/propel/button";
import { narrationTime } from "../utils/voice-narration";
import type { VoiceRecorder, RecorderSnapshot } from "../utils/voice-recorder";
import { MicrophoneInputMeter } from "./microphone-input-meter";

export const VideoAnnotationRecordingIndicator = ({
  recorder,
  state,
}: {
  recorder: VoiceRecorder;
  state: RecorderSnapshot;
}) => {
  const timerRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (timerRef.current) timerRef.current.textContent = narrationTime(recorder.getElapsed(), false);
    };
    tick();
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, [recorder]);
  const active = state.stage === "recording" || state.stage === "paused";
  return (
    <div
      data-narration-controls
      className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex justify-center px-3 lg:absolute lg:bottom-auto lg:top-3 lg:z-30"
    >
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-md border border-custom-border-300 bg-custom-background-100/95 p-2 text-custom-text-100 shadow-lg backdrop-blur">
        <span role="status" className="flex items-center gap-2 px-1 text-xs font-semibold">
          {state.stage === "recording" ? (
            <span
              aria-hidden="true"
              className="size-2 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none"
            />
          ) : state.stage === "processing" || state.stage === "starting" ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          ) : null}
          {state.stage === "countdown"
            ? `Get ready... ${state.countdown}`
            : state.stage === "processing"
              ? "Preparing narration..."
              : state.stage === "starting"
                ? "Starting narration..."
                : state.stage === "paused"
                  ? "Narration paused"
                  : "Recording narration"}
        </span>
        {active ? (
          <>
            <span
              ref={timerRef}
              role="timer"
              aria-live="off"
              className="w-16 text-center font-mono text-sm tabular-nums"
            >
              00:00
            </span>
            <MicrophoneInputMeter analyser={recorder.analyser} compact />
            <Button
              variant="neutral-primary"
              size="sm"
              onClick={state.stage === "paused" ? () => void recorder.resume() : recorder.pause}
              prependIcon={state.stage === "paused" ? <Play /> : <Pause />}
            >
              {state.stage === "paused" ? "Resume" : "Pause"}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={recorder.stop}
              prependIcon={<Square />}
              aria-label="Stop voice narration recording"
            >
              Stop
            </Button>
          </>
        ) : null}
        <button
          type="button"
          onClick={recorder.cancel}
          title="Discard current recording"
          aria-label="Cancel recording"
          className="grid size-8 place-items-center rounded text-custom-text-300 hover:bg-custom-background-80 focus-visible:ring-2 focus-visible:ring-custom-primary-100"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
};
