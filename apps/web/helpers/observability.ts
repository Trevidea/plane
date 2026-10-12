export function getObservabilityUrl(workspace: string) {
  const base =
    process.env.NEXT_PUBLIC_OBSERVABILITY_URL?.trim() ||
    (process.env.NODE_ENV === "development" ? "http://localhost:3006" : "");
  if (!base) return null;
  try {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.searchParams.set("workspace", workspace);
    return url.toString();
  } catch {
    return null;
  }
}
