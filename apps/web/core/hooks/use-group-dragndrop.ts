"use client";

import { useParams } from "next/navigation";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCoachingCardStageConfig, TIssue, TIssueGroupByOptions, TIssueOrderByOptions } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { canTransitionCard } from "@/components/issues/issue-layouts/kanban/coaching-card-stage-model";
import type {
  CardStageRequest,
  RequestCardStageChange,
} from "@/components/issues/issue-layouts/kanban/coaching-card-stage-request-context";
import type { GroupDropLocation } from "@/components/issues/issue-layouts/utils";
import { handleGroupDragDrop } from "@/components/issues/issue-layouts/utils";
import { IssueService } from "@/services/issue/issue.service";
import { ISSUE_FILTER_DEFAULT_DATA } from "@/store/issue/helpers/base-issues.store";
import { useIssueDetail } from "./store/use-issue-detail";
import { useIssues } from "./store/use-issues";
import { useIssuesActions } from "./use-issues-actions";

type DNDStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.PROFILE
  | EIssuesStoreType.ARCHIVED
  | EIssuesStoreType.WORKSPACE_DRAFT
  | EIssuesStoreType.TEAM
  | EIssuesStoreType.TEAM_VIEW
  | EIssuesStoreType.EPIC
  | EIssuesStoreType.TEAM_PROJECT_WORK_ITEMS;

export const useGroupIssuesDragNDrop = (
  storeType: DNDStoreType,
  orderBy: TIssueOrderByOptions | undefined,
  groupBy: TIssueGroupByOptions | undefined,
  subGroupBy?: TIssueGroupByOptions,
  cardStageConfig?: TCoachingCardStageConfig,
  requestCardStageChange?: RequestCardStageChange
) => {
  const { workspaceSlug } = useParams();

  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { updateIssue, fetchIssues } = useIssuesActions(storeType);
  const cardService = new IssueService();
  const { issues: projectIssues } = useIssues(EIssuesStoreType.PROJECT);
  const {
    issues: { getIssueIds, addCycleToIssue, removeCycleFromIssue, changeModulesInIssue },
  } = useIssues(storeType);

  /**
   * update Issue on Drop, checks if modules or cycles are changed and then calls appropriate functions
   * @param projectId
   * @param issueId
   * @param data
   * @param issueUpdates
   */
  const updateIssueOnDrop = async (
    projectId: string,
    issueId: string,
    data: Partial<TIssue>,
    issueUpdates: {
      [groupKey: string]: {
        ADD: string[];
        REMOVE: string[];
      };
    },
    reason?: string
  ) => {
    const errorToastProps = {
      type: TOAST_TYPE.ERROR,
      title: "Error!",
      message: "Error while updating work item",
    };
    const moduleKey = ISSUE_FILTER_DEFAULT_DATA["module"];
    const cycleKey = ISSUE_FILTER_DEFAULT_DATA["cycle"];

    const isModuleChanged = Object.keys(data).includes(moduleKey);
    const isCycleChanged = Object.keys(data).includes(cycleKey);

    if (isCycleChanged && workspaceSlug) {
      if (data[cycleKey]) {
        addCycleToIssue(workspaceSlug.toString(), projectId, data[cycleKey]?.toString() ?? "", issueId).catch(() =>
          setToast(errorToastProps)
        );
      } else {
        removeCycleFromIssue(workspaceSlug.toString(), projectId, issueId).catch(() => setToast(errorToastProps));
      }
      delete data[cycleKey];
    }

    if (isModuleChanged && workspaceSlug && issueUpdates[moduleKey]) {
      changeModulesInIssue(
        workspaceSlug.toString(),
        projectId,
        issueId,
        issueUpdates[moduleKey].ADD,
        issueUpdates[moduleKey].REMOVE
      ).catch(() => setToast(errorToastProps));
      delete data[moduleKey];
    }

    const sourceIssue = getIssueById(issueId);
    if (sourceIssue?.category === "Coaching Card" && (data.state_id || data.sort_order !== undefined)) {
      if (!workspaceSlug) return;
      const stageId = data.state_id ?? sourceIssue.state_id;
      if (!stageId) throw new Error("Coaching card stage is unavailable.");
      try {
        if (storeType === EIssuesStoreType.PROJECT) {
          await projectIssues.transitionCoachingCard(
            workspaceSlug.toString(),
            projectId,
            issueId,
            stageId,
            data.sort_order,
            reason
          );
        } else {
          await cardService.transitionCoachingCard(
            workspaceSlug.toString(),
            projectId,
            issueId,
            stageId,
            reason,
            data.sort_order
          );
        }
      } finally {
        if (storeType === EIssuesStoreType.PROJECT) {
          await projectIssues
            .fetchIssuesWithExistingPagination(workspaceSlug.toString(), projectId, "mutation")
            .catch(() =>
              setToast({
                type: TOAST_TYPE.ERROR,
                title: "Board refresh failed",
                message: "Refresh to see the latest card.",
              })
            );
        } else {
          await fetchIssues("init-loader", { canGroup: true, perPageCount: 30 });
        }
      }
      return;
    }

    if (updateIssue) await updateIssue(projectId, issueId, data).catch(() => setToast(errorToastProps));
  };

  const handleOnDrop = async (source: GroupDropLocation, destination: GroupDropLocation) => {
    if (
      source.columnId &&
      destination.columnId &&
      destination.columnId === source.columnId &&
      destination.id === source.id
    )
      return;

    const sourceIssue = source.id ? getIssueById(source.id) : undefined;
    let request: CardStageRequest | null = null;
    if (sourceIssue?.category === "Coaching Card" && groupBy === "state" && source.groupId !== destination.groupId) {
      if (requestCardStageChange) {
        request = await requestCardStageChange(sourceIssue, destination.groupId);
        if (!request) return;
        if (request.stageId !== destination.groupId) {
          // A backward drop reopens the previous stage, not the arbitrary drop column.
          destination = {
            ...destination,
            groupId: request.stageId,
            columnId: `${request.stageId}__${destination.subGroupId || "null"}`,
            id: undefined,
          };
        }
      } else if (!canTransitionCard(cardStageConfig, source.groupId, destination.groupId)) {
        setToast({
          type: TOAST_TYPE.WARNING,
          title: "Stage unavailable",
          message: "Select a stage on this coaching board.",
        });
        return;
      }
    }

    await handleGroupDragDrop(
      source,
      destination,
      getIssueById,
      getIssueIds,
      (boardId, issueId, data, updates) => updateIssueOnDrop(boardId, issueId, data, updates, request?.reason),
      groupBy,
      subGroupBy,
      orderBy !== "sort_order"
    ).catch((err) => {
      setToast({
        title: "Error!",
        type: TOAST_TYPE.ERROR,
        message: err?.detail ?? err?.reason?.[0] ?? err?.stage_id?.[0] ?? "Failed to perform this action",
      });
    });
  };

  return handleOnDrop;
};
