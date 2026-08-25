export const formatMediaDurationLabel = (value: number | string | null | undefined) => {
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) return "";

  const rawValue = typeof value === "number" ? String(value) : (value ?? "").trim();
  if (!rawValue || rawValue === "-") return "";

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(rawValue)) {
    const parts = rawValue.split(":").map((part) => part.padStart(2, "0"));
    return parts.length === 2 ? `00:${parts[0]}:${parts[1]}` : parts.join(":");
  }

  const seconds = Number(rawValue);
  if (Number.isFinite(seconds) && seconds < 0) return "";
  if (!Number.isFinite(seconds)) return rawValue;

  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  return [hours, minutes, remainingSeconds].map((part) => String(part).padStart(2, "0")).join(":");
};
