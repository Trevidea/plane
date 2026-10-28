import type { ReactNode } from "react";
import { Tabs } from "@plane/ui";

export const CoachingCardPeekTabs = ({
  cardId,
  initialTab,
  overview,
  discussion,
  clips,
  audit,
}: {
  cardId: string;
  initialTab?: string;
  overview: ReactNode;
  discussion: ReactNode;
  clips: ReactNode;
  audit: ReactNode;
}) => (
  <Tabs
    key={cardId}
    storeInLocalStorage={false}
    defaultTab={initialTab || "coaching-overview"}
    size="sm"
    tabClassName="text-sm font-medium text-custom-text-100 hover:text-custom-text-100 focus-visible:ring-2 focus-visible:ring-custom-primary-100"
    tabListContainerClassName="sticky top-0 z-10 bg-custom-background-100 py-2"
    tabs={[
      {
        key: "coaching-overview",
        label: "Overview",
        content: (
          <>
            {overview}
            <div className="border-t border-custom-border-200 pt-4">
              <h3 className="text-base font-semibold text-custom-text-100">Thread</h3>
              {discussion}
            </div>
          </>
        ),
      },
      { key: "coaching-clips", label: "Clips", content: clips },
      { key: "coaching-activity", label: "Audit", content: audit },
    ]}
  />
);
