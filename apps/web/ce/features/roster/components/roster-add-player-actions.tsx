"use client";

import { ChevronDown, Download, Plus, Upload } from "lucide-react";
import { Button, CustomMenu } from "@plane/ui";

export const RosterAddPlayerActions = ({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) => (
  <div
    className="inline-flex h-7 shrink-0 items-stretch rounded bg-custom-primary-100"
    role="group"
    aria-label="Add players"
  >
    <Button variant="primary" size="sm" className="h-full rounded-r-none" prependIcon={<Plus />} onClick={onAdd}>
      Add player
    </Button>
    <CustomMenu
      className="h-full shrink-0"
      customButtonClassName="flex h-full w-7 items-center justify-center rounded-r border-l border-white/20 bg-custom-primary-100 text-white transition-colors hover:bg-custom-primary-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-custom-primary-100"
      ariaLabel="More ways to add players"
      customButton={<ChevronDown className="size-3.5" aria-hidden="true" />}
      placement="bottom-end"
      closeOnSelect
    >
      <CustomMenu.MenuItem onClick={onAdd} className="flex items-center gap-2">
        <Plus className="size-3.5" />
        Add one player
      </CustomMenu.MenuItem>
      <CustomMenu.MenuItem onClick={onImport} className="flex items-center gap-2">
        <Upload className="size-3.5" />
        Import CSV or Excel
      </CustomMenu.MenuItem>
      <CustomMenu.MenuItem>
        <a className="flex items-center gap-2" href="/templates/roster-template.xlsx" download="roster-template.xlsx">
          <Download className="size-3.5" />
          Download template
        </a>
      </CustomMenu.MenuItem>
    </CustomMenu>
  </div>
);
