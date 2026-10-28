import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/ui";
// hooks
import { SidebarSearchButton } from "@/components/sidebar/search-button";
import { useCommandPalette } from "@/hooks/store/use-command-palette";

export const AppSearch = observer(() => {
  // store hooks
  const { toggleCommandPaletteModal } = useCommandPalette();
  // translation
  const { t } = useTranslation();

  return (
    <Button
      unstyled
      type="button"
      onClick={() => toggleCommandPaletteModal(true)}
      aria-label={t("aria_labels.projects_sidebar.open_command_palette")}
    >
      <SidebarSearchButton isActive={false} />
    </Button>
  );
});
