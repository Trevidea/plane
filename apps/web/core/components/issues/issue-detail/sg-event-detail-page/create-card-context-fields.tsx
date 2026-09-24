import { LevelDropdown } from "@/components/dropdowns/level-property";
import { ProgramDropdown } from "@/components/dropdowns/program-property";
import SportDropdown from "@/components/dropdowns/sport-property";
import { YearRangeDropdown } from "@/components/dropdowns/year-property";
import type { CardContextValues } from "./create-card-model";

type Props = {
  value: CardContextValues;
  onChange: (field: keyof CardContextValues, value: string | null) => void;
  disabled: boolean;
};

const CONTEXT_FIELDS = [
  { key: "sport", label: "Sport", Dropdown: SportDropdown },
  { key: "level", label: "Level", Dropdown: LevelDropdown },
  { key: "program", label: "Program", Dropdown: ProgramDropdown },
  { key: "season", label: "Season", Dropdown: YearRangeDropdown },
] as const;

export const CreateCardContextFields = ({ value, onChange, disabled }: Props) => (
  <fieldset>
    <legend className="text-sm text-custom-text-200">Card Context</legend>
    <div className="mt-2 grid grid-cols-1 gap-3 rounded-lg border border-custom-border-300 bg-custom-background-90 p-3 sm:grid-cols-2">
      {CONTEXT_FIELDS.map(({ key, label, Dropdown }) => (
        <div key={key} role="group" aria-labelledby={`create-card-${key}-label`} className="min-w-0 space-y-1.5">
          <span id={`create-card-${key}-label`} className="block text-xs text-custom-text-200">
            {label}
          </span>
          <Dropdown
            value={value[key]}
            onChange={(selection) => onChange(key, selection)}
            placeholder={`Select ${label.toLowerCase()}`}
            buttonVariant="border-with-text"
            className="h-10"
            buttonContainerClassName="w-full text-left focus-visible:ring-2 focus-visible:ring-custom-primary-100 rounded-lg"
            buttonClassName="rounded-lg border border-custom-border-300 bg-custom-background-100 px-3 text-sm text-custom-text-100"
            clearIconClassName="h-3 w-3 shrink-0 text-custom-text-300"
            dropdownClassName="z-[70]"
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  </fieldset>
);
