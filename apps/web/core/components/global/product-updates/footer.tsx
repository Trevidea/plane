import Link from "next/link";
import { USER_TRACKER_ELEMENTS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// ui
import { getButtonStyling } from "@plane/propel/button";
import { PlaneLogo } from "@plane/propel/icons";
// helpers
import { cn } from "@plane/utils";

export const ProductUpdatesFooter = () => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between flex-shrink-0 gap-4 m-6 mb-4">
      <div className="flex items-center gap-2">
        <Link
          prefetch={false}
          href="https://go.plane.so/p-docs"
          target="_blank"
          className="text-sm text-custom-text-200 hover:text-custom-text-100 hover:underline underline-offset-1 outline-none"
        >
          {t("docs")}
        </Link>
        <svg viewBox="0 0 2 2" className="h-0.5 w-0.5 fill-current">
          <circle cx={1} cy={1} r={1} />
        </svg>
        <Link
          prefetch={false}
          data-ph-element={USER_TRACKER_ELEMENTS.CHANGELOG_REDIRECTED}
          href="https://go.plane.so/p-changelog"
          target="_blank"
          className="text-sm text-custom-text-200 hover:text-custom-text-100 hover:underline underline-offset-1 outline-none"
        >
          {t("full_changelog")}
        </Link>
        <svg viewBox="0 0 2 2" className="h-0.5 w-0.5 fill-current">
          <circle cx={1} cy={1} r={1} />
        </svg>
        <Link
          prefetch={false}
          href="mailto:support@plane.so"
          target="_blank"
          className="text-sm text-custom-text-200 hover:text-custom-text-100 hover:underline underline-offset-1 outline-none"
        >
          {t("support")}
        </Link>
        <svg viewBox="0 0 2 2" className="h-0.5 w-0.5 fill-current">
          <circle cx={1} cy={1} r={1} />
        </svg>
        <Link
          prefetch={false}
          href="https://go.plane.so/p-discord"
          target="_blank"
          className="text-sm text-custom-text-200 hover:text-custom-text-100 hover:underline underline-offset-1 outline-none"
        >
          Discord
        </Link>
      </div>
      <Link
        prefetch={false}
        href="https://plane.so/pages"
        target="_blank"
        className={cn(
          getButtonStyling("accent-primary", "sm"),
          "flex gap-1.5 items-center text-center font-medium hover:underline underline-offset-2 outline-none"
        )}
      >
        <PlaneLogo className="h-4 w-auto text-custom-text-100" />
        {t("powered_by_plane_pages")}
      </Link>
    </div>
  );
};
