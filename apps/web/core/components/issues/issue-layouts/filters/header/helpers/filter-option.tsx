import React from "react";
import { Check } from "lucide-react";
import { Button } from "@plane/ui";

// lucide icons

type Props = {
  icon?: React.ReactNode;
  isChecked: boolean;
  title: React.ReactNode;
  onClick?: () => void;
  multiple?: boolean;
  activePulse?: boolean;
};

export const FilterOption: React.FC<Props> = (props) => {
  const { icon, isChecked, multiple = true, onClick, title, activePulse = false } = props;

  return (
    <Button
      unstyled
      type="button"
      className="flex w-full items-center gap-2 rounded p-1.5 hover:bg-custom-background-80"
      onClick={onClick}
    >
      <div
        className={`grid h-3 w-3 flex-shrink-0 place-items-center border bg-custom-background-90 ${
          isChecked ? "border-custom-primary-100 bg-custom-primary-100 text-white" : "border-custom-border-300"
        } ${multiple ? "rounded-sm" : "rounded-full"}`}
      >
        {isChecked && <Check size={10} strokeWidth={3} />}
      </div>
      <div className="flex items-center gap-2 truncate">
        {icon && <div className="grid w-5 flex-shrink-0 place-items-center">{icon}</div>}
        <div className="flex-grow truncate text-xs text-custom-text-200">{title}</div>
      </div>
      {activePulse && (
        <div className="flex-shrink-0 text-xs w-2 h-2 rounded-full bg-custom-primary-100 animate-pulse ml-auto" />
      )}
    </Button>
  );
};
