"use client";

import { useState } from "react";
import { observer } from "mobx-react";
import { UsersRoundIcon } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs, Button, Header } from "@plane/ui";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import { CreateOppositionTeamModal } from "./opposition-team-model";


export const WorkspaceOppositionHeader = observer(() => {
  // state
  const [isDraftIssueModalOpen, setIsDraftIssueModalOpen] = useState(false);
  // store hooks
  const { allowPermissions } = useUserPermissions();
  const { joinedProjectIds } = useProject();

  const { t } = useTranslation();
  // check if user is authorized to create draft work item
  const isAuthorizedUser = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );
  return (
    <>
      <CreateOppositionTeamModal
        isOpen={isDraftIssueModalOpen}
        onClose={() => setIsDraftIssueModalOpen(false)}
      />
      <Header>
        <Header.LeftItem>
          <div className="flex items-center gap-2.5">
            <Breadcrumbs>
              <Breadcrumbs.Item
                component={
                  <BreadcrumbLink label={t("Opposition teams")} icon={<UsersRoundIcon className="h-4 w-4 text-custom-text-300" />} />
                }
              />
            </Breadcrumbs>
          </div>
        </Header.LeftItem>

        <Header.RightItem>
          {joinedProjectIds && joinedProjectIds.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              className="items-center gap-1"
              onClick={() => setIsDraftIssueModalOpen(true)}
              disabled={!isAuthorizedUser}
            >
              Create Opposition Team
            </Button>
          )}
        </Header.RightItem>
      </Header>
    </>
  );
});
