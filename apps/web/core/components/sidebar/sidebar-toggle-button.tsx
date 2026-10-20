"use client";

import { observer } from "mobx-react";
import { PanelLeft } from "lucide-react";
import { Button } from "@plane/ui";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";

export const AppSidebarToggleButton = observer(() => {
  // store hooks
  const { toggleSidebar, sidebarPeek, toggleSidebarPeek } = useAppTheme();

  return (
    <Button
      unstyled
      type="submit"
      className="flex items-center justify-center size-6 rounded-md text-custom-text-400 hover:text-custom-primary-100 hover:bg-custom-background-90"
      onClick={() => {
        if (sidebarPeek) toggleSidebarPeek(false);
        toggleSidebar();
      }}
    >
      <PanelLeft className="size-4" />
    </Button>
  );
});
