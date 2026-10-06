import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { Play, Video } from "lucide-react";
import type { TCoachingCardStageConfig, TIssue } from "@plane/types";
import { Button } from "@plane/ui";
import { cn } from "@plane/utils";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useAppRouter } from "@/hooks/use-app-router";
import { getCoachingCardSource } from "./coaching-card-source";

const formatClipDuration = (durationSeconds?: number | null) => {
  if (durationSeconds === null || durationSeconds === undefined || !Number.isFinite(durationSeconds)) return "";
  const seconds = Math.max(0, Math.round(durationSeconds));
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
};

export const CoachingCardFooter = ({
  issue,
  projectIdentifier,
  config,
  children,
}: {
  issue: TIssue;
  projectIdentifier?: string;
  config?: TCoachingCardStageConfig;
  children?: ReactNode;
}) => {
  const { workspaceSlug } = useParams() as { workspaceSlug: string };
  const router = useAppRouter();
  const { getStateById } = useProjectState();
  const card = issue.coaching_card_data;
  if (!card) return null;

  const clips = card.playlists.flatMap((playlist) => playlist.clips);
  const firstClip = clips[0];
  const clipTitle = firstClip?.title || card.summary.primary_clip_title || "Video clip";
  const clipMeta = clips.length > 1 ? `${clips.length} clips` : formatClipDuration(firstClip?.duration_seconds);
  const source = getCoachingCardSource(card, workspaceSlug, issue.project_id, projectIdentifier);
  const evidenceUrl = card.primary_clip?.source_url || firstClip?.source_url || "";
  const hasDirectEvidence = /^(https?:\/\/|\/)/i.test(evidenceUrl);
  const canOpenEvidence = hasDirectEvidence || Boolean(source.href);
  const recipients = card.recipients ?? (card.player ? [card.player] : []);
  const viewedCount = recipients.filter((recipient) => Boolean(card.review?.viewed_by?.[recipient.id])).length;
  const stageName = (
    config?.stages.find((stage) => stage.id === issue.state_id)?.name ||
    getStateById(issue.state_id)?.name ||
    ""
  ).toLowerCase();
  const isResolved = stageName === "resolved" || stageName === "verified on film";
  const statusLabel =
    recipients.length === 0
      ? children
        ? ""
        : "Awaiting assignee"
      : stageName === "assigned"
        ? viewedCount === 0
          ? "Unopened"
          : `${viewedCount} of ${recipients.length} viewed`
        : stageName === "player reviewed" || card.review?.completion_reason === "all_viewed"
          ? "Reviewed"
          : "";
  const createdAt = new Date(issue.created_at).getTime();
  const ageDays = Number.isFinite(createdAt) ? Math.max(0, Math.floor((Date.now() - createdAt) / 86_400_000)) : 0;

  const clipContent = (
    <>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-custom-background-80">
        {canOpenEvidence ? (
          <Play className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
        ) : (
          <Video className="h-2.5 w-2.5" aria-hidden="true" />
        )}
      </span>
      <span className="max-w-28 truncate font-medium">{clipTitle}</span>
      {clipMeta && <span className="shrink-0 font-normal text-custom-text-300">· {clipMeta}</span>}
    </>
  );

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-b-md px-3 pb-2.5 pt-0.5 text-[11px] leading-none">
      {canOpenEvidence ? (
        <Button
          unstyled
          type="button"
          title={`${source.href && !hasDirectEvidence ? "Open uploaded video" : "Open original clip"}: ${clipTitle}`}
          aria-label={`Play ${clipTitle}`}
          onClick={() => {
            if (hasDirectEvidence) window.open(evidenceUrl, "_blank", "noopener,noreferrer");
            else if (source.href) router.push(source.href);
          }}
          className="mr-auto inline-flex min-h-6 min-w-0 max-w-full items-center gap-1.5 rounded text-custom-text-200 hover:text-custom-text-100 focus-visible:ring-2 focus-visible:ring-custom-primary-100"
        >
          {clipContent}
        </Button>
      ) : (
        <span
          className="mr-auto inline-flex min-h-6 min-w-0 max-w-full items-center gap-1.5 text-custom-text-200"
          title={clipTitle}
        >
          {clipContent}
        </span>
      )}
      {statusLabel && (
        <span
          className={cn(
            "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-[5px] px-2 text-[10.5px] font-medium",
            recipients.length === 0 || (stageName === "assigned" && viewedCount === 0)
              ? "bg-[#fd9038]/15 text-[#9a4800] dark:text-[#fd9038]"
              : isResolved
                ? "bg-[#3edbb0]/15 text-[#006e54] dark:text-[#3edbb0]"
                : "bg-[#2893cc]/15 text-[#006b9a] dark:text-[#3aa8e5]"
          )}
        >
          {statusLabel}
          {stageName === "assigned" && viewedCount === 0 && <span className="opacity-75">· 0 viewed</span>}
        </span>
      )}
      {children}
      {ageDays > 5 && !isResolved && (
        <span
          className={cn(
            "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-[5px] px-2 text-[10.5px] font-semibold",
            ageDays >= 10
              ? "bg-[#e05656]/15 text-[#a12727] dark:text-[#e05656]"
              : "bg-[#fd9038]/15 text-[#9a4800] dark:text-[#fd9038]"
          )}
          title={`${ageDays} days since card creation`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {ageDays}d
        </span>
      )}
    </div>
  );
};
