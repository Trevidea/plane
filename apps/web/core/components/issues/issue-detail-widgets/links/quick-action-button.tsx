"use client";
import type { FC } from "react";
import React from "react";

import { observer } from "mobx-react";
import { Plus } from "lucide-react";
// plane imports
import type { TIssueServiceType } from "@plane/types";
import { Button } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

type Props = {
  customButton?: React.ReactNode;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
};

export const IssueLinksActionButton: FC<Props> = observer((props) => {
  const { customButton, disabled = false, issueServiceType } = props;
  // store hooks
  const { toggleIssueLinkModal } = useIssueDetail(issueServiceType);

  // handlers
  const handleOnClick = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    toggleIssueLinkModal(true);
  };

  return (
    <Button unstyled type="button" onClick={handleOnClick} disabled={disabled}>
      {customButton ? customButton : <Plus className="h-4 w-4" />}
    </Button>
  );
});
