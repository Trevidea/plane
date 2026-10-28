export const resolveHlsPlaybackSource = (source: string, origin: string) => {
  try {
    const url = new URL(source, origin);
    if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
      return `/api/hls?url=${encodeURIComponent(url.toString())}`;
    }
  } catch (error) {
    console.error("Failed to resolve HLS playback source:", error);
  }
  return source;
};
