import { API_BASE_URL } from "@plane/constants";
import type { TMediaArtifact } from "@/services/media-library.service";

type TArtifactUrlContext = {
  workspaceSlug: string;
  projectId: string;
  packageId?: string;
};

export const resolveArtifactPath = (path: string) => {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `/${path.replace(/^\/+/, "")}`;
};

export const buildArtifactFileUrl = (context: TArtifactUrlContext, artifactName: string) => {
  if (!context.workspaceSlug || !context.projectId || !context.packageId || !artifactName) return "";
  return `${API_BASE_URL.replace(/\/$/, "")}/api/workspaces/${context.workspaceSlug}/projects/${context.projectId}/media-library/packages/${context.packageId}/artifacts/${encodeURIComponent(artifactName)}/file/`;
};

export const resolveArtifactSource = (artifact: TMediaArtifact, context?: TArtifactUrlContext) => {
  const rawPath = artifact.path ?? "";
  // Transcoder blob URLs are served media, not paths inside Plane's media-library volume.
  if (/^https?:\/\//i.test(rawPath) || /^\/(?:(?:sports\/)?api\/)?blobs\/media\//.test(rawPath)) return rawPath;
  if (rawPath && (artifact.action ?? "").toLowerCase() === "play_hls") return resolveArtifactPath(rawPath);
  return (context && buildArtifactFileUrl(context, artifact.name)) || resolveArtifactPath(rawPath);
};
