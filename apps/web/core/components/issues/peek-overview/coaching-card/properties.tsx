import type { ReactNode } from "react";
import { observer } from "mobx-react";
import type { TCoachingCardStageConfig, TIssue } from "@plane/types";
import { Button, CustomSelect } from "@plane/ui";
import { renderFormattedDate } from "@plane/utils";
import { LevelDropdown } from "@/components/dropdowns/level-property";
import { ProgramDropdown } from "@/components/dropdowns/program-property";
import { YearRangeDropdown } from "@/components/dropdowns/year-property";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import type { IssueService } from "@/services/issue/issue.service";
import { getCardStageActions } from "../../issue-layouts/kanban/coaching-card-stage-model";

export type CoachingCardUpdate = Parameters<IssueService["updateCoachingCard"]>[3];
const Property = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid min-h-8 grid-cols-[150px_minmax(0,1fr)] items-center gap-8 text-sm">
    <span className="text-custom-text-300">{label}</span>
    <div className="min-w-0 text-custom-text-100">{children}</div>
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
    buttonClassName="border-0 px-0 text-sm"
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
    onStageChange,
  }: {
    issue: TIssue;
    projectId: string;
    disabled: boolean;
    config?: TCoachingCardStageConfig;
    onSave: (data: CoachingCardUpdate) => Promise<void>;
    onAssign: () => void;
    onStageChange: (id: string) => Promise<void>;
  }) => {
    const { getUserDetails } = useMember();
    const { getProjectById } = useProject();
    const { getStateById } = useProjectState();
    const card = issue.coaching_card_data!;
    const recipients = card.recipients ?? (card.player ? [card.player] : []);
    const { available } = getCardStageActions(config, issue.state_id);
    const stageName =
      config?.stages.find((stage) => stage.id === issue.state_id)?.name ||
      getStateById(issue.state_id)?.name ||
      "Stage unavailable";
    const save = (data: CoachingCardUpdate) => {
      void onSave(data).catch(() => {});
    };
    const selectorProps = {
      disabled,
      buttonVariant: "transparent-with-text" as const,
      hideIcon: true,
      buttonClassName: "px-0 py-1 text-sm",
    };
    return (
      <section aria-label="Card properties" className="space-y-3">
        <h3 className="text-sm font-medium text-custom-text-100">Properties</h3>
        <div className="space-y-4">
          <Property label="Player / Group">
            <Button variant="link-primary" size="sm" className="px-0" disabled={disabled} onClick={onAssign}>
              {card.position_group || recipients.map((player) => player.name).join(", ") || "Assign player"}
            </Button>
          </Property>
          <Property label="Position">
            {card.position_group ||
              recipients
                .map((player) => player.position)
                .filter(Boolean)
                .join(", ") ||
              "—"}
          </Property>
          <Property label="Card type">
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
          </Property>
          <Property label="Stage">
            <CustomSelect
              value={issue.state_id}
              label={stageName}
              disabled={disabled || !available.length}
              buttonClassName="border-0 px-0 text-sm"
              onChange={(id: string) => void onStageChange(id)}
              optionsClassName="z-40"
            >
              {available.map((stage) => (
                <CustomSelect.Option key={stage.id} value={stage.id}>
                  {stage.name}
                </CustomSelect.Option>
              ))}
            </CustomSelect>
          </Property>
          <Property label="Priority">
            <CardSelect
              label="Priority"
              value={card.priority || "Standard"}
              disabled={disabled}
              choices={["Game Plan Critical", "Standard", "Developmental"]}
              onChange={(priority) => save({ priority })}
            />
          </Property>
          <Property label="Sport">{getProjectById(projectId)?.sport || card.sport || "—"}</Property>
          <Property label="Program">
            <ProgramDropdown
              isClearable={false}
              {...selectorProps}
              value={issue.program || card.metadata?.program}
              onChange={(program) => save({ program: program || "" })}
            />
          </Property>
          <Property label="Level">
            <LevelDropdown
              isClearable={false}
              {...selectorProps}
              value={issue.level || card.metadata?.level}
              onChange={(level) => save({ level: level || "" })}
            />
          </Property>
          <Property label="Season">
            <YearRangeDropdown
              isClearable={false}
              {...selectorProps}
              value={issue.year || card.metadata?.season}
              onChange={(season) => save({ season: season || "" })}
            />
          </Property>
          <Property label="Created by">
            {getUserDetails(issue.created_by)?.display_name || card.metadata?.author?.name || "—"}
          </Property>
          <Property label="Created">{renderFormattedDate(issue.created_at)}</Property>
        </div>
      </section>
    );
  }
);
