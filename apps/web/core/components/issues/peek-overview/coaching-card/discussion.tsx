import { observer } from "mobx-react";
import useSWR from "swr";
import { ArrowRight, Eye } from "lucide-react";
import { EActivityFilterType, E_SORT_ORDER } from "@plane/constants";
import type { TIssue, TWorkspaceBaseActivity } from "@plane/types";
import { Button } from "@plane/ui";
import { CommentCreate } from "@/components/comments/comment-create";
import { ActivityBlockComponent } from "@/components/common/activity/activity-block";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { IssueService } from "@/services/issue/issue.service";
import { IssueActivityCommentRoot } from "../../issue-detail/issue-activity/activity-comment-root";
import { useCommentOperations } from "../../issue-detail/issue-activity/helper";
import { IssueActivityLoader } from "../../issue-detail/issue-activity/loader";

const service = new IssueService();
type Props = {
  issue: TIssue;
  workspaceSlug: string;
  projectId: string;
  disabled: boolean;
  mode: "comments" | "activity";
};

export const CoachingCardDiscussion = observer(({ issue, workspaceSlug, projectId, disabled, mode }: Props) => {
  const {
    activity: { getActivityAndCommentsByIssueId },
  } = useIssueDetail();
  const { getUserDetails } = useMember();
  const { getProjectById } = useProject();
  const operations = useCommentOperations(workspaceSlug, projectId, issue.id);
  const entries = getActivityAndCommentsByIssueId(issue.id, E_SORT_ORDER.ASC);
  const {
    data: history,
    error,
    isLoading,
    mutate,
  } = useSWR(
    mode === "activity" ? ["coaching-card-history", workspaceSlug, projectId, issue.id, issue.updated_at] : null,
    () => service.getCoachingCardHistory(workspaceSlug, projectId, issue.id),
    { revalidateOnFocus: false }
  );
  const isDiscussion = mode === "comments";
  const relevantEntries = entries?.filter((entry) => (entry.activity_type === "COMMENT") === isDiscussion);
  const card = issue.coaching_card_data;
  const views = Object.entries(card?.review?.viewed_by ?? {});
  const nativeActivity = (id: string, actor: string | null, date: string): TWorkspaceBaseActivity => ({
    id,
    actor: actor || "",
    workspace: getProjectById(projectId)?.workspace.toString() || "",
    created_at: date,
    updated_at: date,
    epoch: new Date(date).getTime(),
    verb: "updated",
    field: "state",
    comment: undefined,
    old_value: undefined,
    new_value: undefined,
    old_identifier: undefined,
    new_identifier: undefined,
  });
  return (
    <section aria-label={isDiscussion ? "Discussion" : "Activity"} className="space-y-4 py-3">
      {!entries && <IssueActivityLoader />}
      {isDiscussion && entries && !relevantEntries?.length && (
        <div className="py-5 text-sm text-custom-text-300">
          <p className="font-medium text-custom-text-200">No discussion yet.</p>
          <p className="mt-1">Start the conversation with the player or coaching staff.</p>
        </div>
      )}
      {!isDiscussion && (
        <>
          <h3 className="text-sm font-medium text-custom-text-100">Lifecycle</h3>
          {isLoading && <IssueActivityLoader />}
          {error && (
            <div role="alert" className="space-y-2 text-sm text-custom-text-300">
              <p>Unable to load lifecycle history.</p>
              <Button variant="neutral-primary" size="sm" onClick={() => void mutate()}>
                Retry
              </Button>
            </div>
          )}
          <ActivityBlockComponent
            activity={nativeActivity(`${issue.id}-created`, issue.created_by, issue.created_at)}
            ends="top"
            customUserName={getUserDetails(issue.created_by)?.display_name || card?.metadata?.author?.name || "Coach"}
          >
            created this coaching card
          </ActivityBlockComponent>
          {history?.map((event) => (
            <ActivityBlockComponent
              key={event.id}
              activity={nativeActivity(event.id, event.changed_by_id, event.changed_at)}
              ends={undefined}
              icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
              customUserName={
                event.changed_by_id ? getUserDetails(event.changed_by_id)?.display_name || "Coach" : "System"
              }
            >
              moved the card {event.from_stage_name ? `from ${event.from_stage_name} ` : ""}to {event.to_stage_name}
              {event.reason && <span className="mt-1 block text-custom-text-300">{event.reason}</span>}
            </ActivityBlockComponent>
          ))}
          {views.map(([playerId, date]) => (
            <ActivityBlockComponent
              key={playerId}
              activity={nativeActivity(`${issue.id}-review-${playerId}`, null, date)}
              ends={undefined}
              icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
              customUserName={card?.recipients?.find((player) => player.id === playerId)?.name || "Player"}
            >
              reviewed the coaching card
            </ActivityBlockComponent>
          ))}
          {entries && !relevantEntries?.length && !history?.length && !views.length && !isLoading && !error && (
            <p className="text-sm text-custom-text-300">No additional activity yet.</p>
          )}
        </>
      )}
      <IssueActivityCommentRoot
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issue.id}
        isIntakeIssue={false}
        disabled={disabled}
        activityOperations={operations}
        contentMode={mode}
        selectedFilters={
          isDiscussion
            ? [EActivityFilterType.COMMENT]
            : [EActivityFilterType.ACTIVITY, EActivityFilterType.STATE, EActivityFilterType.ASSIGNEE]
        }
        sortOrder={E_SORT_ORDER.ASC}
      />
      {isDiscussion && !disabled && (
        <CommentCreate
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          entityId={issue.id}
          activityOperations={operations}
          showToolbarInitially
        />
      )}
    </section>
  );
});
