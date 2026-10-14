import { useContext, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import {
  Archive,
  ChartNoAxesColumn,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Pencil,
  SquarePlus,
  Trash2,
  UsersRound,
} from "lucide-react";
import { Dialog } from "@headlessui/react";
import { ARCHIVABLE_STATE_GROUPS, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TContextMenuItem } from "@plane/ui";
import { Button, ContextMenu, CustomMenu, EModalWidth, ModalCore } from "@plane/ui";
import { cn, isDateTimePast } from "@plane/utils";
import { CommentCreate } from "@/components/comments/comment-create";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUserPermissions } from "@/hooks/store/user";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { IssueService } from "@/services/issue/issue.service";
import { ArchiveIssueModal } from "../../archive-issue-modal";
import { DeleteIssueModal } from "../../delete-issue-modal";
import { useCommentOperations } from "../../issue-detail/issue-activity/helper";
import type { IQuickActionProps } from "../list/list-view-types";
import { AssignmentDialog } from "./coaching-card-actions";
import {
  getCoachingCardAgeDays,
  getCoachingCardMenuStages,
  getCoachingCardPriorityChange,
} from "./coaching-card-menu-model";
import { canEditCoachingCardRecipients } from "./coaching-card-recipient-policy";
import { CoachingCardStageContext } from "./coaching-card-stage-context";
import { coachingCardErrorMessage, useCoachingCardStageAction } from "./use-coaching-card-stage-action";

const issueService = new IssueService();

const CoachFollowUpDialog = ({
  workspaceSlug,
  projectId,
  issueId,
  onClose,
}: {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  onClose: () => void;
}) => {
  const operations = useCommentOperations(workspaceSlug, projectId, issueId);
  return (
    <ModalCore isOpen handleClose={onClose} width={EModalWidth.LG}>
      <div className="space-y-4 p-5">
        <Dialog.Title as="h2" className="text-base font-semibold text-custom-text-100">
          Add coach follow-up
        </Dialog.Title>
        <CommentCreate
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          entityId={issueId}
          activityOperations={operations}
          showToolbarInitially
          onSubmitCallback={onClose}
        />
        <div className="flex justify-end">
          <Button variant="neutral-primary" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </ModalCore>
  );
};

export const CoachingCardMenu = observer((props: IQuickActionProps) => {
  const {
    issue,
    parentRef,
    customActionButton,
    portalElement,
    placements = "bottom-end",
    readOnly,
    handleDelete,
    handleArchive,
  } = props;
  const { workspaceSlug: slug } = useParams();
  const workspaceSlug = slug?.toString() ?? "";
  const projectId = issue.project_id ?? "";
  const config = useContext(CoachingCardStageContext);
  const { getProjectIdentifierById } = useProject();
  const { getStateById } = useProjectState();
  const { allowPermissions } = useUserPermissions();
  const { handleRedirection } = useIssuePeekOverviewRedirection();
  const [dialog, setDialog] = useState<"recipients" | "follow-up" | "archive" | "delete" | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const identifier = `${getProjectIdentifierById(projectId) || "Card"}-${issue.sequence_id}`;
  const stages = getCoachingCardMenuStages(config, issue.state_id);
  const currentState = getStateById(issue.state_id);
  const currentName = stages.current?.name || currentState?.name || "Stage unavailable";
  const canEdit =
    !readOnly &&
    !issue.archived_at &&
    !issue.tempId &&
    Boolean(workspaceSlug && projectId) &&
    allowPermissions(
      [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
      EUserPermissionsLevel.PROJECT,
      workspaceSlug,
      projectId
    );
  const canDelete =
    canEdit &&
    allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId) &&
    !isDateTimePast(issue.start_date, issue.start_time);
  const canArchive = Boolean(
    canEdit && handleArchive && currentState && ARCHIVABLE_STATE_GROUPS.includes(currentState.group)
  );
  const onChanged = () => window.dispatchEvent(new CustomEvent("coaching-card-updated", { detail: { projectId } }));
  const { moveToStage, isMoving, canRequestStageChange } = useCoachingCardStageAction({
    issue,
    config,
    workspaceSlug,
    projectId,
    onChanged,
  });
  const busy = isMoving || isUpdating;
  const canEditRecipients = canEditCoachingCardRecipients(config, issue.state_id);
  const cardPriority = issue.coaching_card_data?.priority;
  const raisedPriority = getCoachingCardPriorityChange(cardPriority, "raise");
  const loweredPriority = getCoachingCardPriorityChange(cardPriority, "lower");

  const changePriority = async (priority: string | undefined) => {
    if (!canEdit || busy || !priority) return;
    setIsUpdating(true);
    try {
      await issueService.updateCoachingCard(workspaceSlug, projectId, issue.id, { priority });
      onChanged();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Priority updated", message: priority });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Priority update failed",
        message: coachingCardErrorMessage(error, "Please try again."),
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const items: (TContextMenuItem & { section: "card" | "movement" | "lifecycle" })[] = [
    {
      key: "next",
      section: "card",
      title: stages.primaryLabel,
      description: stages.primaryHint,
      icon: ChartNoAxesColumn,
      disabled: !canEdit || busy || !stages.next || !canRequestStageChange,
      action: () => {
        if (stages.next && canEdit && !busy) void moveToStage(stages.next.id);
      },
    },
    {
      key: "open",
      section: "card",
      title: "Open card",
      icon: SquarePlus,
      action: () => handleRedirection(workspaceSlug, issue),
    },
    {
      key: "recipients",
      section: "card",
      title: "Edit recipients",
      icon: UsersRound,
      disabled: !canEdit || busy,
      action: () => {
        if (canEdit && canEditRecipients && !busy) setDialog("recipients");
      },
    },
    {
      key: "follow-up",
      section: "card",
      title: "Add coach follow-up",
      icon: Pencil,
      disabled: !canEdit || busy,
      action: () => setDialog("follow-up"),
    },
    {
      key: "previous",
      section: "movement",
      title: `Move back to ${stages.previous?.name ?? "-"}`,
      description: "reopen - reason required",
      icon: ChevronLeft,
      disabled: !canEdit || busy || !stages.previous || !canRequestStageChange,
      action: () => {
        if (stages.previous && canEdit && !busy) void moveToStage(stages.previous.id);
      },
    },
    {
      key: "raise",
      section: "movement",
      title: "Raise priority",
      icon: ChevronUp,
      disabled: !canEdit || busy || !raisedPriority,
      action: () => void changePriority(raisedPriority),
    },
    {
      key: "lower",
      section: "movement",
      title: "Lower priority",
      icon: ChevronDown,
      disabled: !canEdit || busy || !loweredPriority,
      action: () => void changePriority(loweredPriority),
    },
    {
      key: "archive",
      section: "lifecycle",
      title: "Archive...",
      description: canArchive ? "confirmation required" : "completed / cancelled only",
      icon: Archive,
      disabled: !canArchive || busy,
      action: () => setDialog("archive"),
    },
    {
      key: "delete",
      section: "lifecycle",
      title: "Delete",
      description: "admin only",
      icon: Trash2,
      disabled: !canDelete || busy,
      className: "text-red-500",
      iconClassName: "text-red-500",
      action: () => setDialog("delete"),
    },
  ];
  const visibleItems = items.filter(
    ({ key }) =>
      (key !== "previous" || Boolean(stages.previous)) &&
      (key !== "next" || stages.showPrimaryAction) &&
      (key !== "recipients" || canEditRecipients)
  );

  return (
    <>
      <ContextMenu parentRef={parentRef} items={visibleItems} />
      <CustomMenu
        verticalEllipsis
        customButton={customActionButton}
        ariaLabel={`Actions for ${identifier}`}
        placement={placements}
        portalElement={portalElement}
        menuItemsClassName="z-[20]"
        optionsClassName="w-[min(18rem,calc(100vw-1.5rem))] min-w-0 max-h-[calc(100dvh-2rem)] overflow-y-auto whitespace-normal bg-custom-background-90 p-1"
        closeOnSelect
        useCaptureForOutsideClick
      >
        <p className="break-words px-2 pb-1 pt-1 text-[10px] font-semibold uppercase text-custom-text-300">
          {identifier} · {currentName} · {getCoachingCardAgeDays(issue.created_at)}d
        </p>
        {(["card", "movement", "lifecycle"] as const).map((section) => (
          <div key={section} className={cn(section !== "card" && "mt-1 border-t border-custom-border-200 pt-1")}>
            {section !== "card" && (
              <p className="px-2 py-1 text-[10px] font-semibold uppercase text-custom-text-300">{section}</p>
            )}
            {visibleItems
              .filter((item) => item.section === section)
              .map((item) => (
                <CustomMenu.MenuItem
                  key={item.key}
                  disabled={item.disabled}
                  onClick={item.action}
                  className={cn(
                    "flex min-h-8 items-center gap-2 overflow-visible whitespace-normal px-2 py-1 text-xs leading-4 focus-visible:ring-2 focus-visible:ring-custom-primary-100",
                    item.key === "next" && !item.disabled && "bg-custom-primary-100/10 text-custom-primary-100",
                    item.key === "delete" && !item.disabled && "text-red-500"
                  )}
                >
                  {item.icon && <item.icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1 break-words">{item.title}</span>
                  {item.description && (
                    <span className="max-w-[45%] shrink-0 text-right text-[11px] font-normal text-custom-text-300">
                      {item.description}
                    </span>
                  )}
                </CustomMenu.MenuItem>
              ))}
          </div>
        ))}
        <p className="px-2 pb-1 pt-1.5 text-[10px] leading-relaxed text-custom-text-300">
          Every transition is logged with time and actor. Backward moves record a reason.
        </p>
      </CustomMenu>
      {dialog === "recipients" && canEdit && (
        <AssignmentDialog
          issue={issue}
          config={config}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          onChanged={onChanged}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "follow-up" && canEdit && (
        <CoachFollowUpDialog
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issue.id}
          onClose={() => setDialog(null)}
        />
      )}
      <ArchiveIssueModal
        data={issue}
        isOpen={dialog === "archive" && canArchive}
        handleClose={() => setDialog(null)}
        onSubmit={handleArchive}
      />
      <DeleteIssueModal
        data={issue}
        isOpen={dialog === "delete" && canDelete}
        handleClose={() => setDialog(null)}
        onSubmit={handleDelete}
      />
    </>
  );
});
