import type { ReactNode } from "react";
import { observer } from "mobx-react";
import type { TCoachingCardStageConfig, TIssue } from "@plane/types";
import { Button, CustomSelect } from "@plane/ui";
import { renderFormattedDate } from "@plane/utils";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import type { IssueService } from "@/services/issue/issue.service";

export type CoachingCardUpdate = Parameters<IssueService["updateCoachingCard"]>[3];
const Property = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid min-h-9 grid-cols-[88px_minmax(0,1fr)] items-center gap-3 text-sm">
    <span className="font-medium text-custom-text-200">{label}</span>
    <div className="min-w-0 font-medium leading-6 text-custom-text-100">{children}</div>
  </div>
);
const CardSelect = ({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  choices: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) => (
  <CustomSelect
    value={value}
    label={value || `Select ${label.toLowerCase()}`}
    disabled={disabled}
    onChange={onChange}
    buttonClassName="w-full justify-between rounded border border-custom-border-200 bg-custom-background-90 px-3 py-2 text-sm font-medium text-custom-text-100 hover:bg-custom-background-80 focus-visible:ring-2 focus-visible:ring-custom-primary-100"
    optionsClassName="z-40"
  >
    {choices.map((choice) => (
      <CustomSelect.Option key={choice} value={choice}>
        {choice}
      </CustomSelect.Option>
    ))}
  </CustomSelect>
);

export const CoachingCardProperties = observer(
  ({
    issue,
    projectId,
    disabled,
    config,
    onSave,
    onAssign,
  }: {
    issue: TIssue;
    projectId: string;
    disabled: boolean;
    config?: TCoachingCardStageConfig;
    onSave: (data: CoachingCardUpdate) => Promise<void>;
    onAssign: () => void;
  }) => {
    const { getUserDetails } = useMember();
    const { getProjectById } = useProject();
    const { getStateById } = useProjectState();
    const card = issue.coaching_card_data!;
    const recipients = card.recipients ?? (card.player ? [card.player] : []);
    const stageName =
      config?.stages.find((stage) => stage.id === issue.state_id)?.name ||
      getStateById(issue.state_id)?.name ||
      "Stage unavailable";
    const reviewedAt = Object.values(card.review?.viewed_by ?? {}).sort()[0];
    const save = (data: CoachingCardUpdate) => {
      void onSave(data).catch(() => {});
    };
    return (
      <section aria-label="Card properties" className="space-y-3 rounded-lg bg-custom-background-100 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-custom-text-100">Properties</h3>
          <span className="text-xs text-custom-text-200">Edits are logged to Activity</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <span className="block text-sm font-medium text-custom-text-200">Card type</span>
            <CardSelect
              label="Card type"
              value={card.card_type || "Correction"}
              disabled={disabled}
              choices={[
                "Correction",
                "Positive Reinforcement",
                "Opponent Scout",
                "S&C Connection",
                "Multi-Week Development",
              ]}
              onChange={(card_type) => save({ card_type })}
            />
          </div>
          <div className="min-w-0 space-y-1">
            <span className="block text-sm font-medium text-custom-text-200">Priority</span>
            <CardSelect
              label="Priority"
              value={card.priority || "Standard"}
              disabled={disabled}
              choices={["Game Plan Critical", "Standard", "Developmental"]}
              onChange={(priority) => save({ priority })}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Property label="Assignee">
            {card.position_group || recipients.length ? (
              <span>{card.position_group || recipients.map((player) => player.name).join(", ")}</span>
            ) : (
              <Button
                variant="link-primary"
                size="sm"
                className="px-0 text-sm font-semibold"
                disabled={disabled}
                onClick={onAssign}
              >
                Unassigned · Assign…
              </Button>
            )}
          </Property>
          <Property label="Program">
            {[
              issue.program || card.metadata?.program,
              issue.level || card.metadata?.level,
              issue.year || card.metadata?.season,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </Property>
          <div className="grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
            <Property label="Sport">{getProjectById(projectId)?.sport || card.sport || "—"}</Property>
            <Property label="Position">
              {card.position_group ||
                recipients
                  .map((player) => player.position)
                  .filter(Boolean)
                  .join(", ") ||
                "—"}
            </Property>
            <Property label="Stage">{stageName}</Property>
            <Property label="Created">
              <span className="break-words">
                {renderFormattedDate(issue.created_at)} <span className="text-custom-text-200"> · </span>
                {getUserDetails(issue.created_by)?.display_name || card.metadata?.author?.name || "—"}
              </span>
            </Property>
            <Property label="Delivered">
              {card.review?.assigned_at ? renderFormattedDate(card.review.assigned_at) : "—"}
            </Property>
            <Property label="Reviewed">{reviewedAt ? renderFormattedDate(reviewedAt) : "—"}</Property>
            <Property label="Completed">
              {card.review?.completed_at ? renderFormattedDate(card.review.completed_at) : "—"}
            </Property>
          </div>
        </div>
      </section>
    );
  }
);
