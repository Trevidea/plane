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
};

export function ProjectEventMetadataFields({ control, disabled, futureSeasonYears = 0 }: Props) {
  const { t } = useTranslation();
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
            <div className="h-7 max-w-full">
              <Dropdown
                value={value ?? null}
                onChange={onChange}
                placeholder={label}
                buttonVariant="border-with-text"
                disabled={disabled}
                {...(name === "event_season" ? { futureYears: futureSeasonYears } : {})}
              />
            </div>
          )}
        />
      ))}
    </>
  );
}
