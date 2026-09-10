import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isNarrationTimeDiscontinuous } from "../utils/voice-narration";
import { VoiceRecorder, isNarrationLocked } from "../utils/voice-recorder";

type Params = {
  currentTime: number;
  durationSeconds?: number | null;
  getCurrentTime?: () => number;
  videoElement?: HTMLVideoElement | null;
  onRequestPause?: () => void;
  onRequestPlay?: () => void | Promise<void>;
  onSeek?: (seconds: number) => void;
  playbackRate: number;
};
export const useVideoAnnotationVoiceNarration = (params: Params) => {
  const [recorder] = useState(() => new VoiceRecorder());
  const state = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot, recorder.getSnapshot);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [playVideo, setPlayVideo] = useState(true);
  const [countdown, setCountdown] = useState(true);
  const [ducking, setDucking] = useState<number | null>(0.35);
  const [supported, setSupported] = useState(false);
  const [replacement, setReplacement] = useState<{ id: string; startTime: number } | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const locked = isNarrationLocked(state.stage);
  const readTime = useCallback(() => paramsRef.current.getCurrentTime?.() ?? paramsRef.current.currentTime, []);
  const refreshDevices = useCallback(async () => {
    try {
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput"));
    } catch {
      /* prepare() reports actionable device errors. */
    }
  }, []);
  useEffect(() => {
    setSupported(
      window.isSecureContext &&
        typeof MediaRecorder !== "undefined" &&
        typeof AudioContext !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia)
    );
    return () => recorder.dispose();
  }, [recorder]);
  useEffect(() => {
    if (!supported) return;
    void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices, supported]);
  const prepare = useCallback(
    async (selectedId = deviceId) => {
      if (!supported) {
        recorder.fail("Recording requires HTTPS or localhost and a browser with microphone support.");
        return;
      }
      await recorder.prepare(selectedId);
      setDeviceId(recorder.deviceId);
      await refreshDevices();
    },
    [deviceId, recorder, refreshDevices, supported]
  );
  const start = useCallback(() => {
    const p = paramsRef.current;
    if (!p.durationSeconds || !Number.isFinite(p.durationSeconds)) {
      recorder.fail("Wait for the video duration to load before recording narration.");
      return;
    }
    if (Math.abs(p.playbackRate - 1) > 0.001) {
      recorder.fail("Set the video speed to 1x before recording narration.");
      return;
    }
    const startTime = replacement?.startTime ?? readTime();
    if (p.durationSeconds && startTime >= p.durationSeconds - 0.1) {
      recorder.fail("Move the playhead before the end of the video to record narration.");
      return;
    }
    p.onRequestPause?.();
    if (Math.abs(readTime() - startTime) > 0.005) p.onSeek?.(startTime);
    recorder.start({
      countdown,
      playVideo,
      startTime,
      getTime: readTime,
      pause: () => paramsRef.current.onRequestPause?.(),
      play: () => paramsRef.current.onRequestPlay?.(),
    });
  }, [countdown, playVideo, readTime, recorder, replacement]);
  useEffect(() => {
    const video = params.videoElement;
    if (!locked || !video) return;
    const pause = () => {
      if (recorder.getSnapshot().stage === "recording" && playVideo) recorder.pause();
    };
    const ended = () => recorder.stop();
    const rateChanged = () => {
      if (Math.abs(video.playbackRate - 1) > 0.001) {
        recorder.pause();
        video.playbackRate = 1;
      }
    };
    const seeking = () => {
      const snapshot = recorder.getSnapshot();
      if (
        ["countdown", "recording", "paused"].includes(snapshot.stage) &&
        isNarrationTimeDiscontinuous(snapshot.startTime ?? readTime(), recorder.getElapsed(), readTime(), playVideo)
      )
        recorder.fail(
          "Recording was interrupted by a seek. Your previous narration is unchanged. Move the playhead and record again."
        );
    };
    video.addEventListener("pause", pause);
    video.addEventListener("waiting", pause);
    video.addEventListener("ended", ended);
    video.addEventListener("seeking", seeking);
    video.addEventListener("ratechange", rateChanged);
    return () => {
      video.removeEventListener("pause", pause);
      video.removeEventListener("waiting", pause);
      video.removeEventListener("ended", ended);
      video.removeEventListener("seeking", seeking);
      video.removeEventListener("ratechange", rateChanged);
    };
  }, [locked, params.videoElement, playVideo, readTime, recorder]);
  useEffect(() => {
    if (!locked || !params.durationSeconds) return;
    if (params.currentTime >= params.durationSeconds - 0.05) recorder.stop();
  }, [locked, params.currentTime, params.durationSeconds, recorder]);
  return {
    recorder,
    state,
    locked,
    devices,
    deviceId,
    setDeviceId,
    supported,
    prepare,
    start,
    replacement,
    setReplacement,
    playVideo,
    setPlayVideo,
    countdown,
    setCountdown,
    ducking,
    setDucking,
    readTime,
  };
};
export type VoiceNarrationControls = ReturnType<typeof useVideoAnnotationVoiceNarration>;
