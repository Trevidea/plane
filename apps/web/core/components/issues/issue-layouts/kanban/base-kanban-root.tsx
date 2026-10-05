"use client";

import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { EIssueFilterType, EUserPermissions, EUserPermissionsLevel, WORK_ITEM_TRACKER_EVENTS } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EIssueServiceType, EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";
//constants
//hooks
import { captureError, captureSuccess } from "@/helpers/event-tracker.helper";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useKanbanView } from "@/hooks/store/use-kanban-view";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import { useGroupIssuesDragNDrop } from "@/hooks/use-group-dragndrop";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { IssueService } from "@/services/issue/issue.service";
// store
// ui
// types
import { DeleteIssueModal } from "../../delete-issue-modal";
import { IssueLayoutHOC } from "../issue-layout-HOC";
import type { IQuickActionProps, TRenderQuickActions } from "../list/list-view-types";
//components
import type { GroupDropLocation } from "../utils";
import { getSourceFromDropPayload } from "../utils";
import { CoachingCardStageContext } from "./coaching-card-stage-context";
import { CoachingCardStageRequestContext } from "./coaching-card-stage-request-context";
import { CoachingSwimlaneBoard } from "./coaching-swimlane-board";
import { getSwimlaneLaneUpdate } from "./coaching-swimlane-model";
import { KanBan } from "./default";
import { KanBanSwimLanes } from "./swimlanes";
import { useCoachingCardStageRequest } from "./use-coaching-card-stage-request";
import { useSwimlanePreference } from "./use-swimlane-preference";

export type KanbanStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.PROFILE
  | EIssuesStoreType.TEAM
  | EIssuesStoreType.TEAM_VIEW
  | EIssuesStoreType.EPIC;

export interface IBaseKanBanLayout {
  QuickActions: FC<IQuickActionProps>;
  addIssuesToView?: (issueIds: string[]) => Promise<any>;
  canEditPropertiesBasedOnProject?: (projectId: string) => boolean;
  isCompletedCycle?: boolean;
  viewId?: string | undefined;
  isEpic?: boolean;
}

export const BaseKanBanRoot: React.FC<IBaseKanBanLayout> = observer((props: IBaseKanBanLayout) => {
  const {
    QuickActions,
    addIssuesToView,
    canEditPropertiesBasedOnProject,
    isCompletedCycle = false,
    viewId,
    isEpic = false,
  } = props;
  // router
  const { workspaceSlug, projectId } = useParams();
  // store hooks
  const storeType = useIssueStoreType() as KanbanStoreType;
  const { allowPermissions } = useUserPermissions();
  const { issueMap, issuesFilter, issues } = useIssues(storeType);
  const { issues: projectIssues } = useIssues(EIssuesStoreType.PROJECT);
  const { getProjectById } = useProject();
  const {
    issue: { getIssueById },
  } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
  const {
    fetchIssues,
    fetchNextIssues,
    quickAddIssue,
    updateIssue,
    removeIssue,
    removeIssueFromView,
    archiveIssue,
    restoreIssue,
    updateFilters,
  } = useIssuesActions(storeType);

  const deleteAreaRef = useRef<HTMLDivElement | null>(null);
  const [isDragOverDelete, setIsDragOverDelete] = useState(false);

  const { isDragging } = useKanbanView();

  const displayFilters = issuesFilter?.issueFilters?.displayFilters;
  const displayProperties = issuesFilter?.issueFilters?.displayProperties;

  const sub_group_by = displayFilters?.sub_group_by;
  const group_by = displayFilters?.group_by;

  const orderBy = displayFilters?.order_by;

  const fetchMoreIssues = useCallback(
    (groupId?: string, subgroupId?: string) => {
      if (issues?.getIssueLoader(groupId, subgroupId) !== "pagination") {
        fetchNextIssues(groupId, subgroupId);
      }
    },
    [fetchNextIssues, issues]
  );

  const groupedIssueIds = issues?.groupedIssueIds;

  const userDisplayFilters = displayFilters || null;

  const { enableInlineEditing, enableQuickAdd, enableIssueCreation } = issues?.viewFlags || {};
  const currentProject = projectId ? getProjectById(projectId.toString()) : undefined;
  const isCoachingBoard = storeType === EIssuesStoreType.PROJECT && Boolean(currentProject?.sport?.trim());
  const { view: swimlaneView, preferenceKey } = useSwimlanePreference(
    workspaceSlug?.toString(),
    isCoachingBoard ? projectId?.toString() : undefined,
    currentProject?.default_swimlane_view ?? "stage"
  );
  const hasCoachingSwimlanes = isCoachingBoard && swimlaneView !== "stage";
  const KanBanView = sub_group_by && !isCoachingBoard ? KanBanSwimLanes : KanBan;
  const boardPageSize = hasCoachingSwimlanes ? 1000 : sub_group_by && !isCoachingBoard ? 10 : 30;

  useEffect(() => {
    fetchIssues("init-loader", { canGroup: true, perPageCount: boardPageSize }, viewId);
  }, [fetchIssues, storeType, group_by, sub_group_by, boardPageSize, viewId]);
  useEffect(() => {
    if (isCoachingBoard && (group_by !== "state" || sub_group_by) && projectId) {
      void updateFilters(projectId.toString(), EIssueFilterType.DISPLAY_FILTERS, {
        group_by: "state",
        sub_group_by: null,
      });
    }
  }, [group_by, sub_group_by, isCoachingBoard, projectId, updateFilters]);
  const cardService = useMemo(() => new IssueService(), []);
  const {
    data: cardStageConfig,
    error: cardConfigError,
    mutate: refreshCardConfig,
  } = useSWR(
    isCoachingBoard && workspaceSlug && projectId ? ["coaching-card-config", workspaceSlug, projectId] : null,
    () => cardService.getCoachingCardConfig(workspaceSlug.toString(), projectId.toString())
  );

  useEffect(() => {
    if (!isCoachingBoard) return;
    const refreshBoard = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail?.projectId !== projectId?.toString()) return;
      void refreshCardConfig();
      void fetchIssues("mutation", { canGroup: true, perPageCount: boardPageSize }, viewId).catch(() =>
        setToast({ type: TOAST_TYPE.ERROR, title: "Board refresh failed", message: "Refresh to see the latest card." })
      );
    };
    window.addEventListener("coaching-card-created", refreshBoard);
    window.addEventListener("coaching-card-updated", refreshBoard);
    return () => {
      window.removeEventListener("coaching-card-created", refreshBoard);
      window.removeEventListener("coaching-card-updated", refreshBoard);
    };
  }, [fetchIssues, isCoachingBoard, projectId, refreshCardConfig, boardPageSize, viewId]);

  const scrollableContainerRef = useRef<HTMLDivElement | null>(null);

  // states
  const [draggedIssueId, setDraggedIssueId] = useState<string | undefined>(undefined);
  const [deleteIssueModal, setDeleteIssueModal] = useState(false);

  const isEditingAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  const canEditProperties = useCallback(
    (projectId: string | undefined) => {
      const isEditingAllowedBasedOnProject =
        canEditPropertiesBasedOnProject && projectId ? canEditPropertiesBasedOnProject(projectId) : isEditingAllowed;

      return enableInlineEditing && isEditingAllowedBasedOnProject;
    },
    [canEditPropertiesBasedOnProject, enableInlineEditing, isEditingAllowed]
  );

  const refreshAfterAssignment = useCallback(() => {
    window.dispatchEvent(new CustomEvent("coaching-card-updated", { detail: { projectId: projectId?.toString() } }));
  }, [projectId]);
  const { requestStageChange, dialogs: stageDialogs } = useCoachingCardStageRequest(
    cardStageConfig,
    workspaceSlug?.toString() ?? "",
    projectId?.toString() ?? "",
    refreshAfterAssignment,
    currentProject?.identifier
  );

  const handleOnDrop = useGroupIssuesDragNDrop(
    storeType,
    orderBy,
    group_by,
    isCoachingBoard ? undefined : sub_group_by,
    cardStageConfig,
    isCoachingBoard ? requestStageChange : undefined
  );

  const handleSwimlaneDrop = useCallback(
    async (source: GroupDropLocation, destination: GroupDropLocation) => {
      if (!source.id || !projectId || !workspaceSlug) return;
      const issue = getIssueById(source.id);
      if (!issue || !canEditProperties(issue.project_id ?? undefined)) return;
      const sourceLane = source.subGroupId || "";
      const targetLane = destination.subGroupId || "";
      const changedLane = sourceLane !== targetLane;
      const changedStage = source.groupId !== destination.groupId;
      if (!changedLane) {
        await handleOnDrop(
          { ...source, subGroupId: "null", columnId: `${source.groupId}__null` },
          { ...destination, subGroupId: "null", columnId: `${destination.groupId}__null` }
        );
        return;
      }
      if (swimlaneView === "aging" || swimlaneView === "stage") {
        setToast({
          type: TOAST_TYPE.WARNING,
          title: "Aging is automatic",
          message: "Cards cannot be moved between aging lanes.",
        });
        return;
      }
      const stageRequest = changedStage ? await requestStageChange(issue, destination.groupId) : null;
      if (changedStage && !stageRequest) return;
      const slug = workspaceSlug.toString();
      const boardId = projectId.toString();
      let laneUpdate: ReturnType<typeof getSwimlaneLaneUpdate>;
      try {
        laneUpdate = getSwimlaneLaneUpdate(
          swimlaneView,
          sourceLane,
          targetLane,
          issue.assignee_ids,
          issue.coaching_card_data?.recipient_ids ??
            (issue.coaching_card_data?.player ? [issue.coaching_card_data.player.id] : [])
        );
      } catch (error) {
        setToast({
          type: TOAST_TYPE.WARNING,
          title: "Lane unavailable",
          message: error instanceof Error ? error.message : "This lane does not accept cards.",
        });
        return;
      }
      let stageMoved = false;
      try {
        if (stageRequest) {
          await projectIssues.transitionCoachingCard(
            slug,
            boardId,
            issue.id,
            stageRequest.stageId,
            undefined,
            stageRequest.reason
          );
          stageMoved = true;
        }
        if (laneUpdate.issuePatch) {
          if (!updateIssue) throw new Error("Coach assignment is unavailable.");
          await updateIssue(issue.project_id, issue.id, laneUpdate.issuePatch);
        }
        if (laneUpdate.cardPatch) await cardService.updateCoachingCard(slug, boardId, issue.id, laneUpdate.cardPatch);
      } catch (error) {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Card move failed",
          message: stageMoved
            ? "The stage changed, but the lane assignment could not be updated."
            : error instanceof Error
              ? error.message
              : "The card could not be moved.",
        });
      } finally {
        try {
          await fetchIssues("mutation", { canGroup: true, perPageCount: 1000 }, viewId);
        } catch {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: "Board refresh failed",
            message: "Refresh the board to see the latest card.",
          });
        }
      }
    },
    [
      projectId,
      workspaceSlug,
      getIssueById,
      canEditProperties,
      handleOnDrop,
      swimlaneView,
      requestStageChange,
      cardService,
      projectIssues,
      updateIssue,
      fetchIssues,
      viewId,
    ]
  );

  // Enable Auto Scroll for Main Kanban
  useEffect(() => {
    const element = scrollableContainerRef.current;

    if (!element) return;

    return combine(
      autoScrollForElements({
        element,
      })
    );
  }, []);

  // Make the Issue Delete Box a Drop Target
  useEffect(() => {
    const element = deleteAreaRef.current;

    if (!element) return;

    return combine(
      dropTargetForElements({
        element,
        getData: () => ({ columnId: "issue-trash-box", groupId: "issue-trash-box", type: "DELETE" }),
        onDragEnter: () => {
          setIsDragOverDelete(true);
        },
        onDragLeave: () => {
          setIsDragOverDelete(false);
        },
        onDrop: (payload) => {
          setIsDragOverDelete(false);
          const source = getSourceFromDropPayload(payload);

          if (!source) return;

          setDraggedIssueId(source.id);
          setDeleteIssueModal(true);
        },
      })
    );
  }, [setIsDragOverDelete, setDraggedIssueId, setDeleteIssueModal]);

  const renderQuickActions: TRenderQuickActions = useCallback(
    ({ issue, parentRef, customActionButton }) => (
      <QuickActions
        parentRef={parentRef}
        customActionButton={customActionButton}
        issue={issue}
        handleDelete={async () => removeIssue(issue.project_id, issue.id)}
        handleUpdate={async (data) => updateIssue && updateIssue(issue.project_id, issue.id, data)}
        handleRemoveFromView={async () => removeIssueFromView && removeIssueFromView(issue.project_id, issue.id)}
        handleArchive={async () => archiveIssue && archiveIssue(issue.project_id, issue.id)}
        handleRestore={async () => restoreIssue && restoreIssue(issue.project_id, issue.id)}
        readOnly={!canEditProperties(issue.project_id ?? undefined) || isCompletedCycle}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isCompletedCycle, canEditProperties, removeIssue, updateIssue, removeIssueFromView, archiveIssue, restoreIssue]
  );

  const handleDeleteIssue = async () => {
    const draggedIssue = getIssueById(draggedIssueId ?? "");

    if (!draggedIssueId || !draggedIssue) return;

    await removeIssue(draggedIssue.project_id, draggedIssueId)
      .then(() => {
        captureSuccess({
          eventName: WORK_ITEM_TRACKER_EVENTS.delete,
          payload: { id: draggedIssueId },
        });
      })
      .catch(() => {
        captureError({
          eventName: WORK_ITEM_TRACKER_EVENTS.delete,
          payload: { id: draggedIssueId },
        });
      })
      .finally(() => {
        setDeleteIssueModal(false);
        setDraggedIssueId(undefined);
      });
  };

  const handleCollapsedGroups = useCallback(
    (toggle: "group_by" | "sub_group_by", value: string) => {
      if (workspaceSlug) {
        let collapsedGroups = issuesFilter?.issueFilters?.kanbanFilters?.[toggle] || [];
        if (collapsedGroups.includes(value)) {
          collapsedGroups = collapsedGroups.filter((_value) => _value != value);
        } else {
          collapsedGroups.push(value);
        }
        updateFilters(projectId?.toString() ?? "", EIssueFilterType.KANBAN_FILTERS, {
          [toggle]: collapsedGroups,
        });
      }
    },
    [workspaceSlug, issuesFilter, projectId, updateFilters]
  );

  const collapsedGroups = issuesFilter?.issueFilters?.kanbanFilters || { group_by: [], sub_group_by: [] };

  const boardProps = {
    issuesMap: issueMap,
    cardStageConfig,
    isDropDisabled: isCoachingBoard && !cardStageConfig,
    dropErrorMessage: "Coaching stage configuration is unavailable.",
    groupedIssueIds: groupedIssueIds ?? {},
    getGroupIssueCount: issues.getGroupIssueCount,
    displayProperties,
    sub_group_by: isCoachingBoard ? null : sub_group_by,
    group_by,
    orderBy,
    updateIssue,
    quickActions: renderQuickActions,
    handleCollapsedGroups,
    collapsedGroups,
    enableQuickIssueCreate: isCoachingBoard ? false : enableQuickAdd,
    showEmptyGroup: isCoachingBoard || (userDisplayFilters?.show_empty_groups ?? true),
    quickAddCallback: quickAddIssue,
    disableIssueCreation: isCoachingBoard || !enableIssueCreation || !isEditingAllowed || isCompletedCycle,
    canEditProperties,
    addIssuesToView,
    scrollableContainerRef,
    loadMoreIssues: fetchMoreIssues,
    isEpic,
  };

  return (
    <>
      {stageDialogs}
      <DeleteIssueModal
        dataId={draggedIssueId}
        isOpen={deleteIssueModal}
        handleClose={() => setDeleteIssueModal(false)}
        onSubmit={handleDeleteIssue}
        isEpic={isEpic}
      />
      {/* drag and delete component */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 ${
          isDragging ? "z-40" : ""
        } top-3 mx-3 flex w-72 items-center justify-center`}
        ref={deleteAreaRef}
      >
        <div
          className={`${
            isDragging ? `opacity-100` : `opacity-0`
          } flex w-full items-center justify-center rounded border-2 border-red-500/20 bg-custom-background-100 px-3 py-5 text-xs font-medium italic text-red-500 ${
            isDragOverDelete ? "bg-red-500 opacity-70 blur-2xl" : ""
          } transition duration-300`}
        >
          Drop here to delete the work item.
        </div>
      </div>
      <IssueLayoutHOC layout={EIssueLayoutTypes.KANBAN}>
        {isCoachingBoard && cardConfigError && (
          <div role="alert" className="border-b border-red-500/30 px-4 py-2 text-sm text-red-500">
            Coaching stage configuration is unavailable. Card moves are disabled.
          </div>
        )}
        <div
          className={`horizontal-scrollbar scrollbar-lg relative flex h-full w-full bg-custom-background-90 ${hasCoachingSwimlanes || (sub_group_by && !isCoachingBoard) ? "vertical-scrollbar overflow-y-auto" : "overflow-x-auto overflow-y-hidden"}`}
          ref={scrollableContainerRef}
        >
          <div className="relative h-full w-max min-w-full bg-custom-background-90">
            <div className="h-full w-max">
              <CoachingCardStageContext.Provider value={cardStageConfig}>
                <CoachingCardStageRequestContext.Provider value={requestStageChange}>
                  {hasCoachingSwimlanes ? (
                    <CoachingSwimlaneBoard
                      {...boardProps}
                      view={swimlaneView}
                      preferenceKey={preferenceKey}
                      handleOnDrop={handleSwimlaneDrop}
                    />
                  ) : (
                    <KanBanView {...boardProps} handleOnDrop={handleOnDrop} />
                  )}
                </CoachingCardStageRequestContext.Provider>
              </CoachingCardStageContext.Provider>
            </div>
          </div>
        </div>
      </IssueLayoutHOC>
    </>
  );
});
