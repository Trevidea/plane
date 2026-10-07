"use client";

import type { FC } from "react";
import { MoveRight } from "lucide-react";
import { Tooltip } from "@plane/propel/tooltip";
// components
import { Button } from "@plane/ui";
import { EmptyState } from "@/components/common/empty-state";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";
// images
import emptyIssue from "@/public/empty-state/issue.svg";

type TIssuePeekOverviewError = {
  removeRoutePeekId: () => void;
  onRetry?: () => void;
};

export const IssuePeekOverviewError: FC<TIssuePeekOverviewError> = (props) => {
  const { removeRoutePeekId, onRetry } = props;
  // hooks
  const { isMobile } = usePlatformOS();

  return (
    <div className="w-full h-full overflow-hidden relative flex flex-col">
      <div className="flex-shrink-0 flex justify-start">
        <Tooltip tooltipContent="Close the peek view" isMobile={isMobile}>
          <button onClick={removeRoutePeekId} className="w-5 h-5 m-5">
            <MoveRight className="h-4 w-4 text-custom-text-300 hover:text-custom-text-200" />
          </button>
        </Tooltip>
      </div>

      <div className="w-full h-full">
        <EmptyState
          image={emptyIssue ?? undefined}
          title="Unable to load details"
          description="Please try again. The item may be unavailable or you may no longer have access."
        />
        {onRetry && (
          <div className="flex justify-center">
            <Button variant="neutral-primary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
