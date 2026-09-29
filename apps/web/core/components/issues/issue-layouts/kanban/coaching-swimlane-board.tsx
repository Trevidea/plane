"use client";

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TGroupedIssues } from "@plane/types";
import { Avatar } from "@plane/ui";
import { useIssues } from "@/hooks/store/use-issues";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { RosterService } from "@/services/roster.service";
import { getGroupByColumns, isWorkspaceLevel } from "../utils";
import { orderCardColumns } from "./coaching-card-stage-model";
import { groupCardsBySwimlane } from "./coaching-swimlane-model";
import type { SwimlaneGroup, SwimlaneView } from "./coaching-swimlane-model";
import type { IKanBan } from "./default";
import { HeaderGroupByCard } from "./headers/group-by-card";
import { KanbanGroup } from "./kanban-group";

type Props = IKanBan & {
  view: Exclude<SwimlaneView, "stage">;
  preferenceKey: string;
};

const rosterService = new RosterService();

export const CoachingSwimlaneBoard: React.FC<Props> = observer((props) => {
  const { view, preferenceKey, groupedIssueIds, issuesMap, cardStageConfig, getGroupIssueCount } = props;
  const storeType = useIssueStoreType();
  const { issues } = useIssues(storeType);
  const { workspaceSlug, projectId } = useParams();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [now, setNow] = useState(() => new Date());
  const { data: roster } = useSWR(
    view === "player" && workspaceSlug && projectId ? ["swimlane-roster", workspaceSlug, projectId] : null,
    () => rosterService.getRoster(workspaceSlug.toString(), projectId.toString())
  );

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(`${preferenceKey}:${view}:collapsed`) || "[]");
      setCollapsed(Array.isArray(saved) ? saved : []);
    } catch {
      setCollapsed([]);
    }
  }, [preferenceKey, view]);

  useEffect(() => {
    if (view !== "aging") return;
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [view]);

  const columns = getGroupByColumns({
    groupBy: "state",
    includeNone: false,
    isWorkspaceLevel: isWorkspaceLevel(storeType),
  });
  const orderedColumns = columns && cardStageConfig ? orderCardColumns(columns, cardStageConfig) : columns;
  const stageIds = orderedColumns?.map((column) => column.id) ?? [];
  const stageIssueIds = Object.fromEntries(
    stageIds.map((stageId) => [stageId, ((groupedIssueIds as TGroupedIssues)?.[stageId] as string[]) ?? []])
  );
  const loadedCounts = stageIds.map((stageId) => stageIssueIds[stageId].length).join(":");
  useEffect(() => {
    for (const stageId of stageIds) {
      if (
        issues.getPaginationData(stageId, undefined)?.nextPageResults &&
        issues.getIssueLoader(stageId) !== "pagination"
      ) {
        props.loadMoreIssues(stageId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedCounts, issues, props.loadMoreIssues]);
  const coachColumns =
    view === "coach"
      ? getGroupByColumns({ groupBy: "assignees", includeNone: true, isWorkspaceLevel: isWorkspaceLevel(storeType) })
      : undefined;
  const coachById = new Map(coachColumns?.map((coach) => [coach.id, coach]));
  const availableLanes =
    view === "coach"
      ? (coachColumns
          ?.filter((coach) => coach.id !== "None")
          .map((coach) => ({
            id: `coach-${coach.id}`,
            value: coach.id,
            label: coach.name,
            secondaryLabel: "Coach",
          })) ?? [])
      : view === "player"
        ? [
            ...(roster?.map((player) => ({
              id: `player-${player.id}`,
              value: player.id,
              label: player.player_name,
              secondaryLabel: [player.jersey_number && `#${player.jersey_number.replace(/^#/, "")}`, player.position]
                .filter(Boolean)
                .join(" · "),
            })) ?? []),
            ...[
              ...new Set(
                roster?.map((player) => player.position).filter((position): position is string => !!position) ?? []
              ),
            ].map((position) => ({
              id: `position-${position}`,
              value: position,
              label: position,
              secondaryLabel: "Position group",
            })),
          ]
        : [];
  const groups = groupCardsBySwimlane(stageIssueIds, issuesMap, view, now, availableLanes);

  const toggleLane = (id: string) => {
    const next = collapsed.includes(id) ? collapsed.filter((value) => value !== id) : [...collapsed, id];
    setCollapsed(next);
    try {
      window.localStorage.setItem(`${preferenceKey}:${view}:collapsed`, JSON.stringify(next));
    } catch {
      // A private browser session can deny storage; collapsing still works in memory.
    }
  };

  if (!orderedColumns?.length) return null;

  const laneLabel = (group: SwimlaneGroup) =>
    view === "coach" ? coachById.get(group.value)?.name || group.label.replace(/^coach-/, "") : group.label;

  return (
    <div className="relative min-w-max bg-custom-background-90">
      <div className="sticky top-0 z-[4] flex h-[50px] items-center gap-4 bg-custom-background-90 px-3">
        {orderedColumns.map((column) => (
          <div
            key={column.id}
            className={`shrink-0 ${props.collapsedGroups.group_by.includes(column.id) ? "w-[44px]" : "w-[350px]"}`}
          >
            <HeaderGroupByCard
              cardStageConfig={cardStageConfig}
              sub_group_by={null}
              group_by="state"
              column_id={column.id}
              icon={column.icon}
              title={column.name}
              count={getGroupIssueCount(column.id, undefined, false) ?? 0}
              collapsedGroups={props.collapsedGroups}
              handleCollapsedGroups={props.handleCollapsedGroups}
              issuePayload={column.payload}
              disableIssueCreation
            />
          </div>
        ))}
      </div>

      {groups.map((group) => {
        const isCollapsed = collapsed.includes(group.id);
        const coach = coachById.get(group.value);
        const secondaryLabel =
          view === "player" && group.secondaryLabel?.startsWith("#")
            ? group.secondaryLabel.split(" · ").slice(1).join(" · ")
            : group.secondaryLabel || (view === "coach" ? "Coach" : "");
        return (
          <div key={group.id} className="border-t border-custom-border-200">
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() => toggleLane(group.id)}
              className="sticky top-[50px] z-[3] flex w-full items-center gap-2 bg-custom-background-100 px-3 py-2 text-left text-sm text-custom-text-100"
            >
              {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
              {coach?.icon && <span className="shrink-0">{coach.icon}</span>}
              {view === "player" && <Avatar name={laneLabel(group)} size="sm" />}
              {view === "player" && group.secondaryLabel?.startsWith("#") && (
                <span className="flex size-6 shrink-0 items-center justify-center rounded bg-custom-background-80 text-xs">
                  {group.secondaryLabel.split(" · ")[0]}
                </span>
              )}
              <span className="font-medium">{laneLabel(group)}</span>
              <span className="text-xs text-custom-text-300">{secondaryLabel}</span>
              <span className="text-xs text-custom-text-300">{group.cardCount} cards</span>
            </button>

            {!isCollapsed && (
              <div className="flex gap-4 px-3 py-2">
                {orderedColumns.map((column) => (
                  <div
                    key={column.id}
                    className={`shrink-0 ${props.collapsedGroups.group_by.includes(column.id) ? "w-[44px]" : "w-[350px]"}`}
                  >
                    {!props.collapsedGroups.group_by.includes(column.id) && (
                      <KanbanGroup
                        groupId={column.id}
                        sub_group_id={group.id}
                        sub_group_by={undefined}
                        group_by="state"
                        orderBy={props.orderBy}
                        issuesMap={issuesMap}
                        groupedIssueIds={groupedIssueIds}
                        issueIdsOverride={group.cardsByStage[column.id] ?? []}
                        disablePagination
                        displayProperties={props.displayProperties}
                        isDragDisabled={false}
                        isDropDisabled={!!props.isDropDisabled}
                        dropErrorMessage={props.dropErrorMessage}
                        updateIssue={props.updateIssue}
                        quickActions={props.quickActions}
                        enableQuickIssueCreate={false}
                        disableIssueCreation
                        canEditProperties={props.canEditProperties}
                        scrollableContainerRef={props.scrollableContainerRef}
                        loadMoreIssues={props.loadMoreIssues}
                        handleOnDrop={props.handleOnDrop}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
