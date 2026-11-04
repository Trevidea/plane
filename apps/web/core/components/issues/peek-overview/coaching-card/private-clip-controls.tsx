import { useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";
import { API_BASE_URL } from "@plane/constants";
import { Button } from "@plane/ui";
import type { APIService } from "@/services/api.service";
import { privateClip, privateClipBounds, privateClipGrant, MAX_PRIVATE_VIDEO_BYTES } from "./private-thread-model";

import type { ClipSelection, PrivateClip } from "./private-thread-model";

type Context = {
  service: APIService;
  path: string;
};
export function PrivateClipControls({
  service,
  path,
  disabled,
  onSelect,
  onBusy,
}: Context & {
  disabled: boolean;
  onSelect: (clip: ClipSelection | undefined) => void;
  onBusy: (value: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  const upload = async (video: File) => {
    if (controller.current) return;
    if (!video.size || video.size > MAX_PRIVATE_VIDEO_BYTES || !/\.(mp4|mov)$/i.test(video.name)) {
      setError("Choose an MP4/MOV video up to 1 GB.");
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setProgress(0);
    onBusy(true);
    onSelect(undefined);
    try {
      const result = await service.post(path + "attachments/", video, {
        signal: abort.signal,
        timeout: 30 * 60 * 1000,
        headers: {
          "Content-Type": /\.mov$/i.test(video.name) ? "video/quicktime" : "video/mp4",
          "X-Video-Size": String(video.size),
          "X-Video-Name": encodeURIComponent(video.name),
        },
        onUploadProgress: (event) => {
          if (active.current && !abort.signal.aborted)
            setProgress(Math.min(99, Math.floor((100 * event.loaded) / video.size)));
        },
      });
      const clip = privateClip(result.data);
      if (active.current && !abort.signal.aborted) {
        onSelect({ kind: "upload", id: clip.id });
        setName(clip.name);
        setFile(null);
      }
    } catch {
      if (active.current && !abort.signal.aborted)
        setError("Upload failed. Use H.264 MP4/MOV with AAC audio and retry.");
    } finally {
      controller.current = null;
      if (active.current) {
        setProgress(null);
        onBusy(false);
      }
    }
  };
  return (
    <div className="space-y-2 text-sm">
      <Button
        size="sm"
        variant="neutral-primary"
        disabled={disabled || progress !== null}
        onClick={() => input.current?.click()}
      >
        Upload clip from device
      </Button>
      <input
        ref={input}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        className="hidden"
        aria-label="Choose private video"
        disabled={disabled || progress !== null}
        onChange={(event) => {
          const video = event.target.files?.[0];
          event.target.value = "";
          if (video) {
            setFile(video);
            setName(video.name);
            void upload(video);
          }
        }}
      />
      {name && (
        <div className="space-y-2 rounded-md border border-custom-border-200 bg-custom-background-90 p-3">
          <p className="flex items-center gap-2 break-all font-medium">
            <Video className="h-4 w-4 shrink-0 text-custom-primary-100" aria-hidden="true" />
            {name}
          </p>
          {progress !== null ? (
            <>
              <progress aria-label="Video upload progress" value={progress} max={100} />
              <p>{progress}% · Uploading and checking video…</p>
              <Button
                size="sm"
                variant="neutral-primary"
                onClick={() => {
                  controller.current?.abort();
                  setName("");
                  setFile(null);
                  onSelect(undefined);
                }}
              >
                Cancel upload
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="neutral-primary"
              disabled={disabled}
              onClick={() => {
                setName("");
                setFile(null);
                setError("");
                onSelect(undefined);
              }}
            >
              Remove clip
            </Button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {file && error && progress === null && (
        <Button size="sm" variant="neutral-primary" disabled={disabled} onClick={() => void upload(file)}>
          Retry upload
        </Button>
      )}
    </div>
  );
}

export function PrivateClipPlayer({
  service,
  path,
  clip,
  onClose,
}: {
  service: APIService;
  path: string;
  clip: PrivateClip;
  onClose: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let destroy: (() => void) | undefined;
    const video = ref.current;
    if (!video) return;
    const visibility = () => {
      if (document.hidden) video.pause();
    };
    document.addEventListener("visibilitychange", visibility);
    void service
      .get(path + "attachments/" + encodeURIComponent(clip.id) + "/playback/", {}, { signal: abort.signal })
      .then(async (response) => {
        const grant = privateClipGrant(response.data);
        if (abort.signal.aborted) return;
        let bounds = { start: grant.start, end: grant.end };
        const loaded = () => {
          try {
            if (grant.clock) bounds = privateClipBounds(grant.clock, video.duration);
            video.currentTime = bounds.start;
          } catch {
            video.pause();
            setError("Clip is outside the available video.");
          }
        };
        const tick = () => {
          if (video.currentTime < bounds.start) video.currentTime = bounds.start;
          if (bounds.end !== null && video.currentTime >= bounds.end) {
            video.pause();
            video.currentTime = bounds.start;
          }
        };
        video.addEventListener("loadedmetadata", loaded);
        video.addEventListener("timeupdate", tick);
        destroy = () => {
          video.removeEventListener("loadedmetadata", loaded);
          video.removeEventListener("timeupdate", tick);
        };
        const url = API_BASE_URL + grant.path;
        if (grant.contentType === "hls") {
          const { default: Hls } = await import("hls.js");
          if (abort.signal.aborted) return;
          if (Hls.isSupported()) {
            const hls = new Hls();
            const clear = destroy;
            destroy = () => {
              clear?.();
              hls.destroy();
            };
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal && !abort.signal.aborted) setError("Video unavailable. Retry playback.");
            });
            hls.loadSource(url);
            hls.attachMedia(video);
          } else video.src = url;
        } else video.src = url;
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("This clip is unavailable or changed. Retry playback.");
      });
    return () => {
      abort.abort();
      video.pause();
      destroy?.();
      video.removeAttribute("src");
      video.load();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [service, path, clip.id, attempt]);
  return (
    <div
      aria-label={clip.name}
      className="w-full max-w-md space-y-2 overflow-hidden rounded-md border border-custom-border-200 bg-custom-background-100 p-2"
    >
      <div className="flex items-center justify-between">
        <p className="min-w-0 break-all text-xs font-medium">{clip.name}</p>
        <Button size="sm" variant="neutral-primary" onClick={onClose}>
          Close video
        </Button>
      </div>
      <video
        ref={ref}
        controls
        preload="metadata"
        playsInline
        crossOrigin="anonymous"
        className="aspect-video max-h-80 w-full rounded bg-black object-contain"
        onError={() => setError("Video unavailable. Retry playback.")}
      />
      {error && (
        <>
          <p role="alert">{error}</p>
          <Button
            size="sm"
            variant="neutral-primary"
            onClick={() => {
              setError("");
              setAttempt((v) => v + 1);
            }}
          >
            Retry video
          </Button>
        </>
      )}
    </div>
  );
}
