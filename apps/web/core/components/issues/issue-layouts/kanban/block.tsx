"use client";

import type { MutableRefObject } from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane helpers
import { MoreHorizontal, MoreVertical } from "lucide-react";
import { useOutsideClickDetector } from "@plane/hooks";
// types
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TCoachingCardStageConfig, TIssue, IIssueDisplayProperties, IIssueMap } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// ui
import { ControlLink, DropIndicator } from "@plane/ui";
import { cn, generateWorkItemLink } from "@plane/utils";
// components
import RenderIfVisible from "@/components/core/render-if-visible-HOC";
import { HIGHLIGHT_CLASS, getIssueBlockId } from "@/components/issues/issue-layouts/utils";
// helpers
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useKanbanView } from "@/hooks/store/use-kanban-view";
import { useProject } from "@/hooks/store/use-project";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
// local components
import { IssueStats } from "@/plane-web/components/issues/issue-layouts/issue-stats";
import { canActivateCard } from "../../peek-overview/coaching-card/model";
import type { TRenderQuickActions } from "../list/list-view-types";
import { IssueProperties } from "../properties/all-properties";
import { WithDisplayPropertiesHOC } from "../properties/with-display-properties-HOC";
import { CoachingCardActions } from "./coaching-card-actions";
import { CoachingCardKanbanDetails, getCoachingCardAccent, isCoachingCardIssue } from "./coaching-card-details";
import { CoachingCardFooter } from "./coaching-card-footer";
import { CoachingCardStageContext } from "./coaching-card-stage-context";

interface IssueBlockProps {
  issueId: string;
  groupId: string;
  subGroupId: string;
  issuesMap: IIssueMap;
  displayProperties: IIssueDisplayProperties | undefined;
  draggableId: string;
  canDropOverIssue: boolean;
  canDragIssuesInCurrentGrouping: boolean;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  canEditProperties: (projectId: string | undefined) => boolean;
  scrollableContainerRef?: MutableRefObject<HTMLDivElement | null>;
  shouldRenderByDefault?: boolean;
  isEpic?: boolean;
}

interface IssueDetailsBlockProps {
  cardRef: React.RefObject<HTMLElement>;
  issue: TIssue;
  projectIdentifier?: string;
  displayProperties: IIssueDisplayProperties | undefined;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  isReadOnly: boolean;
  cardStageConfig?: TCoachingCardStageConfig;
  isEpic?: boolean;
}

const KanbanIssueDetailsBlock: React.FC<IssueDetailsBlockProps> = observer((props) => {
  const {
    cardRef,
    issue,
    projectIdentifier,
    updateIssue,
    quickActions,
    isReadOnly,
    cardStageConfig,
    displayProperties,
    isEpic = false,
  } = props;
  // refs
  const menuActionRef = useRef<HTMLDivElement | null>(null);
  // states
  const [isMenuActive, setIsMenuActive] = useState(false);
  // hooks
  const { isMobile } = usePlatformOS();

  // derived values
  const subIssueCount = issue?.sub_issues_count ?? 0;
  const isCoachingCard = isCoachingCardIssue(issue);
  const MenuIcon = isCoachingCard ? MoreVertical : MoreHorizontal;

  const customActionButton = (
    <div
      ref={menuActionRef}
      className={`flex items-center h-full w-full cursor-pointer rounded p-1 text-custom-sidebar-text-400 hover:bg-custom-background-80 ${
        isMenuActive ? "bg-custom-background-80 text-custom-text-100" : "text-custom-text-200"
      }`}
      onClick={() => setIsMenuActive(!isMenuActive)}
    >
      <MenuIcon className="h-3.5 w-3.5" />
    </div>
  );

  const handleEventPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  useOutsideClickDetector(menuActionRef, () => setIsMenuActive(false));

  return (
    <>
      <div className="relative">
        {!isCoachingCard && issue.project_id && (
          <IssueIdentifier
            issueId={issue.id}
            projectId={issue.project_id}
            textContainerClassName="line-clamp-1 text-xs text-custom-text-300"
            displayProperties={displayProperties}
          />
        )}
        <div
          className={cn("absolute right-0", isCoachingCard ? "top-0" : "-top-1", {
            "hidden group-hover/kanban-block:block": !isMobile && !isCoachingCard,
            "!block": isMenuActive,
          })}
          onClick={handleEventPropagation}
        >
          {quickActions({
            issue,
            parentRef: cardRef,
            customActionButton,
          })}
        </div>
      </div>

      {isCoachingCard ? (
        <CoachingCardKanbanDetails
          issue={issue}
          projectIdentifier={projectIdentifier}
          cardStageConfig={cardStageConfig}
        />
      ) : (
        <>
          <Tooltip tooltipContent={issue.name} isMobile={isMobile} renderByDefault={false}>
            <div className="w-full line-clamp-1 text-sm text-custom-text-100">
              <span>{issue.name}</span>
            </div>
          </Tooltip>

          <div className="flex items-center gap-2">
            <IssueProperties
              className="flex flex-wrap items-center gap-2 whitespace-nowrap pt-1.5 text-custom-text-300"
              issue={issue}
              displayProperties={displayProperties}
              activeLayout="Kanban"
              updateIssue={updateIssue}
              isReadOnly={isReadOnly}
              isEpic={isEpic}
            />
          </div>
        </>
      )}
      {isEpic && displayProperties && (
        <WithDisplayPropertiesHOC
          displayProperties={displayProperties}
          displayPropertyKey="sub_issue_count"
          shouldRenderProperty={(properties) => !!properties.sub_issue_count && !!subIssueCount}
        >
          <IssueStats issueId={issue.id} className="mt-2 font-medium text-custom-text-350" />
        </WithDisplayPropertiesHOC>
      )}
    </>
  );
});

export const KanbanIssueBlock: React.FC<IssueBlockProps> = observer((props) => {
  const {
    issueId,
    groupId,
    subGroupId,
    issuesMap,
    displayProperties,

    canDropOverIssue,
    canDragIssuesInCurrentGrouping,
    updateIssue,
    quickActions,
    canEditProperties,
    scrollableContainerRef,
    shouldRenderByDefault,
    isEpic = false,
  } = props;

  const cardRef = useRef<HTMLAnchorElement | null>(null);
  const cardContainerRef = useRef<HTMLDivElement | null>(null);
  const suppressClickUntil = useRef(0);
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  // hooks
  const { getProjectIdentifierById } = useProject();
  const { getIsIssuePeeked } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);
  const { isMobile } = usePlatformOS();

  // handlers
  const handleIssuePeekOverview = (issue: TIssue) =>
    handleRedirection(workspaceSlug, issue, isCoachingCardIssue(issue) ? false : isMobile);

  const issue = issuesMap[issueId];

  const { setIsDragging: setIsKanbanDragging } = useKanbanView();

  const [isDraggingOverBlock, setIsDraggingOverBlock] = useState(false);
  const [isCurrentBlockDragging, setIsCurrentBlockDragging] = useState(false);

  const canEditIssueProperties = canEditProperties(issue?.project_id ?? undefined);

  const isDragAllowed = canDragIssuesInCurrentGrouping && !issue?.tempId && canEditIssueProperties;
  const projectIdentifier = getProjectIdentifierById(issue?.project_id);
  const isCoachingCard = Boolean(issue && isCoachingCardIssue(issue));
  const coachingCardAccent = getCoachingCardAccent(issue?.coaching_card_data?.card_type);
  const showCoachingActions = Boolean(isCoachingCard && canEditIssueProperties && workspaceSlug && issue?.project_id);
  const cardStageConfig = useContext(CoachingCardStageContext);

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issue?.project_id,
    issueId,
    projectIdentifier,
    sequenceId: issue?.sequence_id,
    isEpic,
    isArchived: !!issue?.archived_at,
  });

  useOutsideClickDetector(cardContainerRef, () => {
    cardContainerRef.current?.classList.remove(HIGHLIGHT_CLASS);
    cardRef?.current?.classList?.remove(HIGHLIGHT_CLASS);
  });

  // Make Issue block both as as Draggable and,
  // as a DropTarget for other issues being dragged to get the location of drop
  useEffect(() => {
    const element = cardRef.current;

    if (!element) return;

    return combine(
      draggable({
        element,
        dragHandle: element,
        canDrag: () => isDragAllowed,
        getInitialData: () => ({ id: issue?.id, type: "ISSUE" }),
        onDragStart: () => {
          suppressClickUntil.current = Number.POSITIVE_INFINITY;
          setIsCurrentBlockDragging(true);
          setIsKanbanDragging(true);
        },
        onDrop: () => {
          suppressClickUntil.current = Date.now() + 350;
          setIsKanbanDragging(false);
          setIsCurrentBlockDragging(false);
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source?.data?.id !== issue?.id && canDropOverIssue,
        getData: () => ({ id: issue?.id, type: "ISSUE" }),
        onDragEnter: () => {
          setIsDraggingOverBlock(true);
        },
        onDragLeave: () => {
          setIsDraggingOverBlock(false);
        },
        onDrop: () => {
          setIsDraggingOverBlock(false);
        },
      })
    );
  }, [cardRef?.current, issue?.id, isDragAllowed, canDropOverIssue, setIsCurrentBlockDragging, setIsDraggingOverBlock]);

  if (!issue) return null;

  const handleCardChanged = () => {
    window.dispatchEvent(new CustomEvent("coaching-card-updated", { detail: { projectId: issue.project_id } }));
  };

  return (
    <>
      <DropIndicator isVisible={!isCurrentBlockDragging && isDraggingOverBlock} />
      <div
        data-coaching-card-id={isCoachingCard ? issue.id : undefined}
        data-prevent-outside-click={isCoachingCard ? true : undefined}
        id={isCoachingCard ? getIssueBlockId(issueId, groupId, subGroupId) : `issue-${issueId}`}
        ref={cardContainerRef}
        // make Z-index higher at the beginning of drag, to have a issue drag image of issue block without any overlaps
        className={cn(
          "group/kanban-block relative mb-2",
          isCoachingCard &&
            "rounded-md border border-custom-border-200 bg-custom-background-100 transition-colors hover:border-custom-border-400",
          isCoachingCard &&
            getIsIssuePeeked(issue.id) &&
            "border-custom-primary-70 ring-1 ring-custom-primary-70 hover:border-custom-primary-70",
          { "z-[1]": isCurrentBlockDragging }
        )}
        onDragStart={() => {
          if (isDragAllowed) setIsCurrentBlockDragging(true);
          else {
            setToast({
              type: TOAST_TYPE.WARNING,
              title: "Cannot move work item",
              message: !canEditIssueProperties
                ? "You are not allowed to move this work item"
                : "Drag and drop is disabled for the current grouping",
            });
          }
        }}
      >
        {isCoachingCard && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-px left-px z-[1] w-[3px] rounded-l-md"
            style={{
              background: issue.coaching_card_data?.position_group
                ? `linear-gradient(180deg, ${coachingCardAccent} 50%, #7a4488 50%)`
                : coachingCardAccent,
            }}
          />
        )}
        <ControlLink
          id={isCoachingCard ? undefined : getIssueBlockId(issueId, groupId, subGroupId)}
          href={workItemLink}
          ref={cardRef}
          className={cn(
            "block w-full text-sm",
            isCoachingCard
              ? "relative rounded-t-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100"
              : "rounded border-[1px] outline-[0.5px] outline-transparent border-custom-border-200 bg-custom-background-100 transition-all hover:border-custom-border-400",
            { "hover:cursor-pointer": isDragAllowed },
            {
              "border border-custom-primary-70 hover:border-custom-primary-70":
                !isCoachingCard && getIsIssuePeeked(issue.id),
            },
            { "bg-custom-background-80 z-[100]": isCurrentBlockDragging }
          )}
          onClick={(event) => {
            const target = event.target as HTMLElement;
            const interactive =
              Boolean(target.closest("button, input, select, textarea, [role='button'], [role='menuitem']")) ||
              Boolean(target.closest("a") && target.closest("a") !== event.currentTarget);
            if (canActivateCard({ now: Date.now(), suppressUntil: suppressClickUntil.current, interactive })) {
              handleIssuePeekOverview(issue);
            }
          }}
          disabled={!!issue?.tempId}
        >
          <RenderIfVisible
            classNames={cn("space-y-2 px-3 py-2", isCoachingCard && "py-2.5")}
            root={scrollableContainerRef}
            defaultHeight={isCoachingCard ? "245px" : "100px"}
            horizontalOffset={100}
            verticalOffset={200}
            defaultValue={shouldRenderByDefault}
          >
            <KanbanIssueDetailsBlock
              cardRef={cardRef}
              issue={issue}
              projectIdentifier={projectIdentifier}
              displayProperties={displayProperties}
              updateIssue={updateIssue}
              quickActions={quickActions}
              isReadOnly={!canEditIssueProperties}
              cardStageConfig={cardStageConfig}
              isEpic={isEpic}
            />
          </RenderIfVisible>
        </ControlLink>
        {isCoachingCard && (
          <CoachingCardFooter issue={issue} projectIdentifier={projectIdentifier} config={cardStageConfig}>
            {showCoachingActions && workspaceSlug && issue.project_id && (
              <CoachingCardActions
                issue={issue}
                config={cardStageConfig}
                workspaceSlug={workspaceSlug}
                projectId={issue.project_id}
                onChanged={handleCardChanged}
              />
            )}
          </CoachingCardFooter>
        )}
      </div>
    </>
  );
});

KanbanIssueBlock.displayName = "KanbanIssueBlock";
