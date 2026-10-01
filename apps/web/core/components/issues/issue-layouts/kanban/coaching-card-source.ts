import type { TCoachingCardData } from "@plane/types";

export const getCoachingCardSource = (
  card: Pick<TCoachingCardData, "source_issue" | "source_media">,
  workspaceSlug: string,
  projectId: string | null,
  projectIdentifier?: string
): { label: string; title: string; href: string | null } => {
  if (card.source_media)
    return {
      label: "Uploaded video",
      title: card.source_media.title,
      href: projectId
        ? `/${workspaceSlug}/projects/${projectId}/media-library/${encodeURIComponent(card.source_media.artifact_id)}`
        : null,
    };
  if (card.source_issue)
    return {
      label: `Source ${projectIdentifier ? `${projectIdentifier}-` : "#"}${card.source_issue.sequence_id}`,
      title: card.source_issue.name,
      href: null,
    };
  return { label: "Source unavailable", title: "", href: null };
};
