import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Check, UsersRound } from "lucide-react";
import type { EditorRefApi } from "@plane/editor";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssue, TNameDescriptionLoader } from "@plane/types";
import { Avatar, Button, Loader, Tabs } from "@plane/ui";
import { cn } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProjectState } from "@/hooks/store/use-project-state";
import { IssueService } from "@/services/issue/issue.service";
import type { TIssueOperations } from "../../issue-detail";
import { CoachingCardClips } from "../../issue-detail/coaching-card-clips";
import { AssignmentDialog } from "../../issue-layouts/kanban/coaching-card-actions";
import { alignCardStageConfig, getCardStageActions } from "../../issue-layouts/kanban/coaching-card-stage-model";
import { useCoachingCardStageRequest } from "../../issue-layouts/kanban/use-coaching-card-stage-request";
import { IssueTitleInput } from "../../title-input";
import { CoachingCardDiscussion } from "./discussion";
import { cardStageProgress } from "./model";
import { CoachingCardNote } from "./note";
import { CoachingCardProperties } from "./properties";
import type { CoachingCardUpdate } from "./properties";

const service = new IssueService();
export const CoachingCardPeekContent = observer(
  ({
    issue,
    workspaceSlug,
    projectId,
    disabled,
    issueOperations,
    editorRef,
    isSubmitting,
    setIsSubmitting,
    onModalChange,
  }: {
    issue: TIssue;
    workspaceSlug: string;
    projectId: string;
    disabled: boolean;
    issueOperations: TIssueOperations;
    editorRef: React.RefObject<EditorRefApi>;
    isSubmitting: TNameDescriptionLoader;
    setIsSubmitting: (value: TNameDescriptionLoader) => void;
    onModalChange: (open: boolean) => void;
  }) => {
    const {
      issue: { fetchIssue },
      fetchActivities,
    } = useIssueDetail();
    const { getProjectStates } = useProjectState();
    const [assigning, setAssigning] = useState(false);
    const [saving, setSaving] = useState(false);
    const searchParams = useSearchParams();
    const {
      data: fetchedConfig,
      error: configError,
      isLoading: configLoading,
      mutate: retryConfig,
    } = useSWR(
      ["coaching-card-config", workspaceSlug, projectId],
      () => service.getCoachingCardConfig(workspaceSlug, projectId),
      { revalidateOnFocus: false }
    );
    const config = alignCardStageConfig(fetchedConfig, getProjectStates(projectId));
    const refresh = useCallback(
      async (regroup = false) => {
        await fetchIssue(workspaceSlug, projectId, issue.id);
        void fetchActivities(workspaceSlug, projectId, issue.id);
        if (regroup) window.dispatchEvent(new CustomEvent("coaching-card-updated", { detail: { projectId } }));
      },
      [fetchIssue, fetchActivities, workspaceSlug, projectId, issue.id]
    );
    const { requestStageChange, dialogs } = useCoachingCardStageRequest(
      config,
      workspaceSlug,
      projectId,
      () => void refresh(true)
    );
    const stageDialogOpen = Boolean(dialogs);
    useEffect(() => {
      onModalChange(assigning || stageDialogOpen);
      return () => onModalChange(false);
    }, [assigning, stageDialogOpen, onModalChange]);
    const save = useCallback(
      async (data: CoachingCardUpdate) => {
        if (disabled) return;
        setSaving(true);
        try {
          await service.updateCoachingCard(workspaceSlug, projectId, issue.id, data);
          await refresh();
        } catch (error) {
          setToast({ type: TOAST_TYPE.ERROR, title: "Unable to update coaching card", message: "Please try again." });
          throw error;
        } finally {
          setSaving(false);
        }
      },
      [disabled, workspaceSlug, projectId, issue.id, refresh]
    );
    const move = async (stageId: string) => {
      if (disabled || saving) return;
      const request = await requestStageChange(issue, stageId);
      if (!request) return;
      setSaving(true);
      try {
        await service.transitionCoachingCard(workspaceSlug, projectId, issue.id, request.stageId, request.reason);
        await refresh(true);
      } catch {
        setToast({ type: TOAST_TYPE.ERROR, title: "Unable to change stage", message: "Please try again." });
      } finally {
        setSaving(false);
      }
    };
    const titleOperations = useMemo(
      () => ({
        ...issueOperations,
        update: async (_slug: string, _project: string, _id: string, data: Partial<TIssue>) => {
          if (data.name !== undefined) await save({ title: data.name }).catch(() => {});
        },
      }),
      [issueOperations, save]
    );
    const card = issue.coaching_card_data!;
    const recipients = card.recipients ?? (card.player ? [card.player] : []);
    const first = recipients[0];
    const assignment =
      card.position_group ||
      (first
        ? `${first.jersey_number ? `#${first.jersey_number.replace(/^#/, "")} — ` : ""}${first.name}`
        : "Unassigned");
    const progress = cardStageProgress(config?.stages ?? [], issue.state_id);
    const { available, next } = getCardStageActions(config, issue.state_id);
    const overview = (
      <div className="space-y-6 py-4">
        <section aria-label="Workflow progress" className="space-y-3">
          <h3 className="text-sm font-medium text-custom-text-100">Workflow</h3>
          {configLoading && (
            <Loader>
              <Loader.Item height="42px" width="100%" />
            </Loader>
          )}
          {configError && (
            <div className="flex items-center gap-3 text-sm text-custom-text-300" role="alert">
              Unable to load workflow.
              <Button variant="link-primary" size="sm" onClick={() => void retryConfig()}>
                Retry
              </Button>
            </div>
          )}
          {!configError && !configLoading && !progress.length && (
            <p className="text-sm text-custom-text-300">No workflow stages configured.</p>
          )}
          <ol className="flex overflow-x-auto pb-2 pt-1" aria-label="Coaching card stages" tabIndex={0}>
            {progress.map((stage, index) => (
              <li
                key={stage.id}
                aria-current={stage.status === "current" ? "step" : undefined}
                className="min-w-[96px] flex-1 text-center"
              >
                <div className="relative flex h-7 items-center justify-center">
                  {index > 0 && (
                    <span
                      className={cn(
                        "absolute left-0 right-1/2 h-0.5",
                        stage.status === "future" ? "bg-custom-border-300" : "bg-custom-primary-100"
                      )}
                      aria-hidden="true"
                    />
                  )}
                  {index < progress.length - 1 && (
                    <span
                      className={cn(
                        "absolute left-1/2 right-0 h-0.5",
                        stage.status === "completed" ? "bg-custom-primary-100" : "bg-custom-border-300"
                      )}
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={cn(
                      "relative flex h-6 w-6 items-center justify-center rounded-full border-2",
                      stage.status === "completed" && "border-custom-primary-100 bg-custom-primary-100 text-white",
                      stage.status === "future" && "border-custom-border-300 bg-custom-background-100",
                      stage.status === "current" &&
                        "border-custom-primary-100 bg-custom-background-100 text-custom-primary-100 ring-4 ring-custom-primary-100/20"
                    )}
                    aria-hidden="true"
                  >
                    {stage.status === "completed" ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : stage.status === "current" ? (
                      <span className="h-2 w-2 rounded-full bg-custom-primary-100" />
                    ) : null}
                  </span>
                </div>
                <span
                  className={cn(
                    "mt-2 block break-words px-2 text-[12px] leading-4",
                    stage.status === "current" ? "font-semibold text-custom-text-100" : "text-custom-text-200"
                  )}
                >
                  {stage.name}
                </span>
                <span className="sr-only">{stage.status}</span>
              </li>
            ))}
          </ol>
        </section>
        <CoachingCardNote
          issue={issue}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          disabled={disabled}
          issueOperations={issueOperations}
          onSave={save}
          editorRef={editorRef}
        />
        <CoachingCardProperties
          issue={issue}
          projectId={projectId}
          disabled={disabled || saving}
          config={config}
          onSave={save}
          onAssign={() => setAssigning(true)}
          onStageChange={move}
        />

        {!disabled && (
          <div className="flex flex-wrap items-center gap-2 border-t border-custom-border-200 pt-4">
            {!recipients.length && (
              <Button variant="primary" size="sm" disabled={saving} onClick={() => setAssigning(true)}>
                Assign to player
              </Button>
            )}
            {next && (
              <Button variant="primary" size="sm" disabled={saving} onClick={() => void move(next.id)}>
                {next.name}
              </Button>
            )}
            {available
              .filter((stage) => stage.id !== next?.id)
              .map((stage) => (
                <Button
                  key={stage.id}
                  variant="neutral-primary"
                  size="sm"
                  disabled={saving}
                  onClick={() => void move(stage.id)}
                >
                  {stage.name}
                </Button>
              ))}
            {config?.stages.find((stage) => stage.id === issue.state_id)?.name.toLowerCase() === "assigned" &&
              !next && <p className="text-xs text-custom-text-300">Advances automatically after player review.</p>}
          </div>
        )}
      </div>
    );
    return (
      <div className="space-y-4 px-4 py-5 sm:px-6">
        <IssueTitleInput
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issue.id}
          value={issue.name}
          disabled={disabled}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
          issueOperations={titleOperations}
          containerClassName="-ml-3"
        />
        <div className="flex items-center gap-3">
          {card.position_group ? (
            <UsersRound className="h-7 w-7 text-custom-text-300" aria-hidden="true" />
          ) : (
            <Avatar name={first?.name || "Unassigned"} size="md" />
          )}
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium text-custom-text-100">{assignment}</p>
            <p className="text-xs text-custom-text-300">
              {card.position_group ? "Position group" : first?.position || "No player assigned"}
              {recipients.length > 1 && ` · ${recipients.length} recipients`}
            </p>
          </div>
          {!disabled && (
            <Button variant="link-primary" size="sm" disabled={saving} onClick={() => setAssigning(true)}>
              {first ? "Edit" : "Assign player"}
            </Button>
          )}
        </div>
        <Tabs
          key={issue.id}
          storeInLocalStorage={false}
          defaultTab={searchParams.get("clip") ? "coaching-clips" : "coaching-overview"}
          size="sm"
          tabClassName="text-custom-text-100 hover:text-custom-text-100 focus-visible:ring-2 focus-visible:ring-custom-primary-100"
          tabListContainerClassName="sticky top-0 z-10 bg-custom-background-100 py-2"
          tabs={[
            { key: "coaching-overview", label: "Overview", content: overview },
            {
              key: "coaching-clips",
              label: "Clips",
              content: (
                <div className="py-4">
                  <CoachingCardClips
                    viewOnly
                    issue={issue}
                    workspaceSlug={workspaceSlug}
                    projectId={projectId}
                    disabled={disabled}
                    onModalChange={onModalChange}
                  />
                </div>
              ),
            },
            {
              key: "coaching-discussion",
              label: "Discussion",
              content: (
                <CoachingCardDiscussion
                  issue={issue}
                  workspaceSlug={workspaceSlug}
                  projectId={projectId}
                  disabled={disabled}
                  mode="comments"
                />
              ),
            },
            {
              key: "coaching-activity",
              label: "Activity",
              content: (
                <CoachingCardDiscussion
                  issue={issue}
                  workspaceSlug={workspaceSlug}
                  projectId={projectId}
                  disabled={disabled}
                  mode="activity"
                />
              ),
            },
          ]}
        />
        {assigning && (
          <AssignmentDialog
            issue={issue}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            onChanged={() => void refresh(true)}
            onClose={() => setAssigning(false)}
          />
        )}
        {dialogs}
      </div>
    );
  }
);
