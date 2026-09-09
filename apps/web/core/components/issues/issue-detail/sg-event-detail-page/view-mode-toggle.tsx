import { Grid3x3, List, SlidersHorizontal } from "lucide-react";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";
import type { SgEventTagViewMode } from "./types";

type SgEventViewModeToggleProps = {
  isMatrixViewEnabled: boolean;
  onChange: (value: SgEventTagViewMode) => void;
  value: SgEventTagViewMode;
};

const VIEW_OPTIONS = [
  { value: "list", label: "List view", icon: List },
  { value: "timeline", label: "Timeline view", icon: SlidersHorizontal },
  { value: "matrix", label: "Matrix view", icon: Grid3x3 },
] as const;

export const SgEventViewModeToggle = ({ isMatrixViewEnabled, onChange, value }: SgEventViewModeToggleProps) => (
  <div
    role="group"
    aria-label="Clip view"
    className="inline-flex h-9 shrink-0 overflow-hidden rounded-[5px] border border-[var(--sg-matrix-border)] bg-[var(--sg-matrix-panel)]"
  >
    {VIEW_OPTIONS.filter((option) => option.value !== "matrix" || isMatrixViewEnabled).map((option, index) => {
      const Icon = option.icon;
      const isActive = value === option.value;

      return (
        <Tooltip key={option.value} tooltipContent={option.label} isMobile={false}>
          <button
            type="button"
            aria-label={option.label}
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-full w-9 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-custom-primary-100",
              index > 0 && "border-l border-[var(--sg-matrix-border)]",
              isActive
                ? "bg-[var(--sg-matrix-selected-nav)] text-[var(--sg-matrix-text)]"
                : "text-[var(--sg-matrix-text-muted)] hover:bg-[var(--sg-matrix-hover)] hover:text-[var(--sg-matrix-text)]"
            )}
          >
            <Icon aria-hidden="true" className={option.value === "list" ? "h-4 w-4" : "h-3.5 w-3.5"} />
          </button>
        </Tooltip>
      );
    })}
  </div>
);
