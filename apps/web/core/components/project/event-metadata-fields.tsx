"use client";

import type { Control } from "react-hook-form";
import { Controller } from "react-hook-form";
import { useTranslation } from "@plane/i18n";
import type { IProject } from "@plane/types";
import { LevelDropdown } from "@/components/dropdowns/level-property";
import { ProgramDropdown } from "@/components/dropdowns/program-property";
import { YearRangeDropdown } from "@/components/dropdowns/year-property";

type Props = {
  control: Control<IProject>;
  disabled?: boolean;
  futureSeasonYears?: number;
  variant?: "compact" | "form";
  lockedValues?: Pick<IProject, "event_season" | "event_program" | "event_level">;
};

export function ProjectEventMetadataFields({
  control,
  disabled,
  futureSeasonYears = 0,
  variant = "compact",
  lockedValues,
}: Props) {
  const { t } = useTranslation();
  const isForm = variant === "form";
  const fields = [
    { name: "event_season", label: t("year_field"), Dropdown: YearRangeDropdown },
    { name: "event_program", label: "Men/Women", Dropdown: ProgramDropdown },
    { name: "event_level", label: t("level_field"), Dropdown: LevelDropdown },
  ] as const;

  return (
    <>
      {fields.map(({ name, label, Dropdown }) => (
        <Controller
          key={name}
          name={name}
          control={control}
          render={({ field: { value, onChange } }) => (
            <div className={isForm ? "flex min-w-0 flex-col gap-1" : "h-7 max-w-full"}>
              {isForm && <h4 className="text-sm text-custom-text-100">{label}</h4>}
              <Dropdown
                value={value ?? null}
                onChange={onChange}
                placeholder={label}
                buttonVariant="border-with-text"
                className={isForm ? "h-auto w-full" : undefined}
                buttonContainerClassName={isForm ? "h-auto w-full text-left" : undefined}
                buttonClassName={
                  isForm
                    ? "h-auto w-full rounded-md border-[0.5px] border-custom-border-200 bg-custom-background-100 px-3 py-2 text-sm font-medium text-custom-text-100"
                    : undefined
                }
                disabled={disabled || Boolean(lockedValues?.[name]?.trim())}
                {...(name === "event_season" ? { futureYears: futureSeasonYears } : {})}
              />
            </div>
          )}
        />
      ))}
    </>
  );
}
