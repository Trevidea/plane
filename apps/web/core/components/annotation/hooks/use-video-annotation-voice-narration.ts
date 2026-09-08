import { useCallback, useEffect, useRef, useState } from "react";
import type { TCustomPlaylistAnnotation } from "../types/annotation.types";
import { createPlaylistAnnotationId } from "../utils/playlist-annotation-model";

const VOICE_NARRATION_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
] as const;

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read the voice recording."));
    reader.readAsDataURL(blob);
  });

const getSupportedMimeType = () =>
  VOICE_NARRATION_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";

type UseVideoAnnotationVoiceNarrationParams = {
  currentTime: number;
  durationSeconds?: number | null;
  onCreateAnnotation: (annotation: TCustomPlaylistAnnotation) => void;
  onError: (message: string) => void;
  onRequestPause?: () => void;
  onRequestPlay?: () => void | Promise<void>;
  playbackRate: number;
};

export const useVideoAnnotationVoiceNarration = ({
  currentTime,
  durationSeconds,
  onCreateAnnotation,
  onError,
  onRequestPause,
  onRequestPlay,
  playbackRate,
}: UseVideoAnnotationVoiceNarrationParams) => {
  const [isSupported, setIsSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const chunksRef = useRef<Blob[]>([]);
  const currentTimeRef = useRef(currentTime);
  const isMountedRef = useRef(true);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingRef = useRef<{ startedAtMs: number; startTime: number } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    setIsSupported(
      typeof window !== "undefined" &&
        window.isSecureContext &&
        typeof MediaRecorder !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia)
    );
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopVoiceNarration = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    onRequestPause?.();
    recorder.stop();
  }, [onRequestPause]);

  const startVoiceNarration = useCallback(async () => {
    if (mediaRecorderRef.current?.state === "recording") return;
    if (!isSupported) {
      onError("Voice narration recording is not supported by this browser.");
      return;
    }
    if (Math.abs(playbackRate - 1) > 0.001) {
      onError("Set video playback speed to 1x before recording narration.");
      return;
    }

    onRequestPause?.();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (!isMountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = getSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const startTime = Math.max(0, currentTimeRef.current);

      chunksRef.current = [];
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingRef.current = {
        startedAtMs: performance.now(),
        startTime,
      };

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("error", () => {
        onError("The microphone recording failed. Please try again.");
      });
      recorder.addEventListener("stop", () => {
        const recording = recordingRef.current;
        const chunks = chunksRef.current;
        const recordedMimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
        const elapsedSeconds = recording ? Math.max(0.1, (performance.now() - recording.startedAtMs) / 1000) : 0;

        mediaRecorderRef.current = null;
        recordingRef.current = null;
        chunksRef.current = [];
        releaseStream();
        if (isMountedRef.current) {
          setRecordingElapsedSeconds(0);
        }
        if (!recording || chunks.length === 0 || !isMountedRef.current) {
          if (isMountedRef.current) setIsRecording(false);
          return;
        }

        const blob = new Blob(chunks, { type: recordedMimeType });
        void blobToDataUrl(blob)
          .then((content) => {
            if (!isMountedRef.current || !content) return;

            const mediaEndTime = Math.max(currentTimeRef.current, recording.startTime + elapsedSeconds);
            const boundedEndTime =
              Number.isFinite(durationSeconds) && Number(durationSeconds) > 0
                ? Math.min(Number(durationSeconds), mediaEndTime)
                : mediaEndTime;

            onCreateAnnotation({
              content,
              createdAt: new Date().toISOString(),
              endTime: Math.max(recording.startTime + 0.1, boundedEndTime),
              fileSize: blob.size,
              id: createPlaylistAnnotationId(),
              mimeType: recordedMimeType,
              startTime: recording.startTime,
              title: "Voice narration",
              type: "audio",
              x: 0,
              y: 0,
            });
          })
          .catch(() => onError("Unable to prepare the voice recording for saving."))
          .finally(() => {
            if (isMountedRef.current) setIsRecording(false);
          });
      });

      recorder.start(250);
      setIsRecording(true);
      setRecordingElapsedSeconds(0);
      try {
        void Promise.resolve(onRequestPlay?.()).catch(() => {
          if (recorder.state !== "inactive") recorder.stop();
          onError("The video could not start. Narration recording was stopped.");
        });
      } catch {
        if (recorder.state !== "inactive") recorder.stop();
        onError("The video could not start. Narration recording was stopped.");
      }
    } catch (error) {
      releaseStream();
      const permissionDenied =
        error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      onError(
        permissionDenied
          ? "Microphone permission was denied. Allow microphone access and try again."
          : "Unable to access the microphone. Check the selected input device and try again."
      );
    }
  }, [
    durationSeconds,
    isSupported,
    onCreateAnnotation,
    onError,
    onRequestPause,
    onRequestPlay,
    playbackRate,
    releaseStream,
  ]);

  useEffect(() => {
    if (!isRecording) return;

    const intervalId = window.setInterval(() => {
      const recording = recordingRef.current;
      if (!recording) return;
      setRecordingElapsedSeconds(Math.max(0, (performance.now() - recording.startedAtMs) / 1000));
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording || !Number.isFinite(durationSeconds) || Number(durationSeconds) <= 0) return;
    if (currentTime < Number(durationSeconds) - 0.05) return;

    stopVoiceNarration();
  }, [currentTime, durationSeconds, isRecording, stopVoiceNarration]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseStream();
    };
  }, [releaseStream]);

  return {
    isVoiceNarrationRecording: isRecording,
    isVoiceNarrationSupported: isSupported,
    recordingElapsedSeconds,
    startVoiceNarration,
    stopVoiceNarration,
  };
};
