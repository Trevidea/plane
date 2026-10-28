"use client";

import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@plane/ui";

// lucide icons

interface IFilterHeader {
  title: string;
  isPreviewEnabled: boolean;
  handleIsPreviewEnabled: () => void;
}

export const FilterHeader = ({ title, isPreviewEnabled, handleIsPreviewEnabled }: IFilterHeader) => (
  <div className="sticky top-0 flex items-center justify-between gap-2 bg-custom-background-100">
    <div className="flex-grow truncate text-xs font-medium text-custom-text-300">{title}</div>
    <Button
      unstyled
      type="button"
      className="grid h-5 w-5 flex-shrink-0 place-items-center rounded hover:bg-custom-background-80"
      onClick={handleIsPreviewEnabled}
    >
      {isPreviewEnabled ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </Button>
  </div>
);
