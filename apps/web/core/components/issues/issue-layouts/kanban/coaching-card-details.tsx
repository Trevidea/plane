import { useParams } from "next/navigation";
import { CalendarDays, Layers3, UserRound, UsersRound } from "lucide-react";
import type { TCoachingCardStageConfig, TIssue } from "@plane/types";
import { cn, renderFormattedDate } from "@plane/utils";
import { useProjectState } from "@/hooks/store/use-project-state";
import { getCoachingCardSource } from "./coaching-card-source";

const CARD_TYPES: Record<string, { label: string; accent: string; textClass: string }> = {
  Correction: { label: "Correction", accent: "#2893cc", textClass: "text-[#006b9a] dark:text-[#44b5f0]" },
  "Positive Reinforcement": {
    label: "Reinforcement",
    accent: "#c5a55a",
    textClass: "text-[#74520c] dark:text-[#ddbd72]",
  },
  "Opponent Scout": { label: "Scout", accent: "#445588", textClass: "text-[#344b83] dark:text-[#92a9dc]" },
  "S&C Connection": { label: "S&C", accent: "#7a4488", textClass: "text-[#663b7d] dark:text-[#c091d4]" },
  "Multi-Week Development": {
    label: "Multi-Week Development",
    accent: "#2893cc",
    textClass: "text-[#006b9a] dark:text-[#44b5f0]",
  },
};

export const isCoachingCardIssue = (issue: TIssue) =>
  issue.category === "Coaching Card" && issue.coaching_card_data?.kind === "coaching_card";

export const getCoachingCardAccent = (cardType?: string) => CARD_TYPES[cardType || ""]?.accent || "#2893cc";

export const CoachingCardKanbanDetails = ({
  issue,
  projectIdentifier,
  cardStageConfig,
}: {
  issue: TIssue;
  projectIdentifier?: string;
  cardStageConfig?: TCoachingCardStageConfig;
}) => {
  const { workspaceSlug } = useParams() as { workspaceSlug: string };
  const { getStateById } = useProjectState();
  const card = issue.coaching_card_data;
  if (!card) return null;

  const type = CARD_TYPES[card.card_type || ""] || {
    label: card.card_type || "Coaching card",
    accent: "#2893cc",
    textClass: "text-[#006b9a] dark:text-[#44b5f0]",
  };
  const clips = card.playlists.flatMap((playlist) => playlist.clips);
  const firstClip = clips[0];
  const recipients = card.recipients ?? (card.player ? [card.player] : []);
  const firstRecipient = recipients[0];
  const jersey = firstRecipient?.jersey_number?.trim().replace(/^#/, "");
  const source = getCoachingCardSource(card, workspaceSlug, issue.project_id, projectIdentifier);
  const cardContext = [
    card.metadata?.sport,
    card.metadata?.level,
    card.metadata?.program,
    card.metadata?.season,
    card.metadata?.category,
    card.metadata?.location,
    card.metadata?.start_date,
    card.metadata?.start_time,
    ...(card.metadata?.tags ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const stageName =
    cardStageConfig?.stages.find((stage) => stage.id === issue.state_id)?.name ||
    getStateById(issue.state_id)?.name ||
    "Stage unavailable";
  const normalizedStageName = stageName.toLowerCase();
  const isDraft =
    recipients.length === 0 &&
    (issue.state_id === cardStageConfig?.initial_stage_id ||
      (!cardStageConfig && (stageName === "Identified" || stageName === "Film Tagged")));
  const isResolved = normalizedStageName === "resolved" || normalizedStageName === "verified on film";
  const stageBadge = isDraft
    ? "Draft"
    : normalizedStageName === "verified on film"
      ? "Verified"
      : normalizedStageName === "player reviewed"
        ? "Reviewed"
        : normalizedStageName === "practice check"
          ? "Practice"
          : normalizedStageName === "ready for coach review"
            ? "Coach Review"
            : stageName;
  const badgeColor = isResolved ? "#3edbb0" : type.accent;
  const qualifier = firstClip?.detail || firstClip?.secondary_detail || firstClip?.group;
  const reviewDate =
    normalizedStageName === "player reviewed" || normalizedStageName === "in work" ? card.review?.completed_at : null;
  const assignmentDate = normalizedStageName === "assigned" ? card.review?.assigned_at : null;
  const dateLabel = reviewDate ? "Advanced" : assignmentDate ? "Delivered" : "Created";
  const date = reviewDate || assignmentDate || issue.created_at;

  return (
    <div className="min-w-0 space-y-2 text-xs">
      <div className="flex min-w-0 items-center gap-1.5 pr-6 text-[11px] leading-4">
        <span className="shrink-0 font-medium text-custom-text-300">
          {projectIdentifier ? `${projectIdentifier}-${issue.sequence_id}` : `#${issue.sequence_id}`}
        </span>
        <span className={cn("min-w-0 truncate font-medium", type.textClass)} title={card.card_type}>
          {type.label}
          {card.position_group ? " · Group" : ""}
        </span>
        {card.priority === "Game Plan Critical" && (
          <span
            className="shrink-0 rounded-sm bg-[#c5a55a] px-1 py-0.5 text-[9px] font-bold text-[#15110a]"
            title="Game Plan Critical"
          >
            GP
          </span>
        )}
        <span
          className={cn(
            "ml-auto max-w-[38%] shrink-0 truncate rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
            isDraft && "bg-[#fd9038]/15 text-[#9a4800] dark:text-[#fd9038]",
            !isDraft && (isResolved || type.label === "Reinforcement") && "text-[#0a1a15]",
            !isDraft && !isResolved && type.label !== "Reinforcement" && "text-white"
          )}
          style={isDraft ? undefined : { backgroundColor: badgeColor }}
          title={stageName}
        >
          {stageBadge}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-custom-text-300">
        <Layers3 className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="shrink-0">{source.label}</span>
        {source.title && (
          <span className="truncate" title={source.title}>
            · {source.title}
          </span>
        )}
      </div>

      <div className="min-w-0">
        {firstRecipient && !card.position_group ? (
          <div className="flex min-w-0 items-baseline gap-2">
            <span
              className="min-w-0 truncate text-sm font-semibold leading-5 text-custom-text-100"
              title={firstRecipient.name}
            >
              {jersey ? `#${jersey} — ` : ""}
              {firstRecipient.name}
            </span>
            {firstRecipient.position && (
              <span className="shrink-0 text-[11px] text-custom-text-300">{firstRecipient.position}</span>
            )}
          </div>
        ) : (
          <div
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-sm font-semibold leading-5",
              recipients.length ? "text-custom-text-100" : "text-[#9a4800] dark:text-[#fd9038]"
            )}
          >
            {recipients.length ? (
              <UsersRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{card.position_group || "Unassigned"}</span>
            {recipients.length > 0 && (
              <span className="shrink-0 text-[11px] font-normal text-custom-text-300">{recipients.length} players</span>
            )}
          </div>
        )}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-custom-text-300">
          {card.position_group ? (
            <span className="rounded bg-[#7a4488]/20 px-2 py-0.5 text-[#663b7d] dark:text-[#c091d4]">
              Position group
            </span>
          ) : recipients.length > 1 ? (
            <>
              {recipients.slice(1, 3).map((recipient) => (
                <span
                  key={recipient.id}
                  className="max-w-full truncate rounded border border-custom-border-200 px-2 py-0.5 text-custom-text-200"
                >
                  + {recipient.jersey_number ? `#${recipient.jersey_number.replace(/^#/, "")} ` : ""}
                  {recipient.name}
                </span>
              ))}
              {recipients.length > 3 && <span>+{recipients.length - 3} more</span>}
            </>
          ) : null}
          <span>
            {recipients.length
              ? `${recipients.length} ${recipients.length === 1 ? "recipient" : "recipients"}`
              : "No player selected"}
          </span>
        </div>
      </div>

      <p
        className={cn("line-clamp-2 min-w-0 break-words text-[13px] font-medium leading-[1.4]", type.textClass)}
        title={card.title || issue.name}
      >
        {card.title || issue.name}
      </p>
      {card.feedback && (
        <p
          className="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-[1.45] text-custom-text-200"
          title={card.feedback}
        >
          {card.feedback}
        </p>
      )}
      {cardContext && (
        <p className="line-clamp-1 text-[11px] text-custom-text-300" title={cardContext}>
          {cardContext}
        </p>
      )}

      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {qualifier && (
          <span
            className={cn("max-w-full truncate rounded px-2 py-1 text-[10px] font-medium", type.textClass)}
            style={{ backgroundColor: `${type.accent}1f` }}
            title={qualifier}
          >
            {qualifier}
          </span>
        )}
        {card.priority && (
          <span
            className={cn(
              "max-w-full truncate rounded border border-custom-border-200 px-2 py-1 text-[10px]",
              card.priority === "Game Plan Critical"
                ? "border-transparent bg-[#c5a55a]/15 text-[#74520c] dark:text-[#c5a55a]"
                : "text-custom-text-200"
            )}
          >
            {card.priority === "Game Plan Critical" ? "Game-Plan Critical" : card.priority}
          </span>
        )}
        <span className="inline-flex max-w-full items-center gap-1 truncate rounded border border-custom-border-200 px-2 py-1 text-[10px] text-custom-text-300">
          <CalendarDays className="h-3 w-3 shrink-0" aria-hidden="true" />
          {dateLabel} {renderFormattedDate(date)}
        </span>
      </div>
    </div>
  );
};
