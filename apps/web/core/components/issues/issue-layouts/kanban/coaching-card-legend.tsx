import { getCoachingCardBorderBackground, getCoachingCardLegendEntries } from "./coaching-card-types";

const entries = getCoachingCardLegendEntries();

export const CoachingCardLegend = () => (
  <div
    role="group"
    aria-label="Coaching card border legend"
    className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-2 border-b border-custom-border-200 bg-custom-background-90 px-4 py-2 text-xs"
  >
    <span className="font-medium text-custom-text-200">Card types</span>
    <ul className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2 text-custom-text-200">
      {entries.map(({ accent, labels }) => (
        <li key={accent} className="inline-flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-sm" style={{ background: accent }} />
          <span>{labels.join(" / ")}</span>
        </li>
      ))}
      <li className="inline-flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="h-4 w-1 shrink-0 rounded-sm"
          style={{ background: getCoachingCardBorderBackground("Correction", "group") }}
        />
        <span>Position group</span>
      </li>
    </ul>
  </div>
);
