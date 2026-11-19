"use client";

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ListFilter, QrCode, Search, SlidersHorizontal, Upload } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import type { EProjectFeatureKey } from "@plane/constants";
import { Breadcrumbs, Button, Header, Input } from "@plane/ui";
import { CountChip } from "@/components/common/count-chip";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import { CommonProjectBreadcrumbs } from "@/plane-web/components/breadcrumbs/common";
import { useRoster } from "../store/roster-context";
import { RegistrationQRModal } from "./registration-qr-modal";
import { RosterAddPlayerActions } from "./roster-add-player-actions";
import { RosterDisplayDropdown, RosterFilterDropdown } from "./roster-dropdowns";
import { RosterExportDropdown } from "./roster-export-dropdown";

export const ProjectRosterHeader = observer(() => {
  const { workspaceSlug, projectId } = useParams() as { workspaceSlug: string; projectId: string };
  const { loader } = useProject();
  const { refetchRoster } = useRoster();
  const { allowPermissions } = useUserPermissions();
  const [showQR, setShowQR] = useState(false);
  const {
    players,
    allPlayers,
    searchValue,
    setSearchValue,
    canManage,
    openImportRosterModal,
    openCreatePlayerModal,
    selectedPlayerIds,
    clearSelectedPlayers,
  } = useRoster();
  const canGenerateQR =
    canManage &&
    allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE, workspaceSlug);

  return (
    <>
      <Header className="flex-wrap !gap-y-2">
        <Header.LeftItem className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Breadcrumbs isLoading={loader === "init-loader"} className="flex-grow-0">
              <CommonProjectBreadcrumbs
                workspaceSlug={workspaceSlug?.toString() ?? ""}
                projectId={projectId?.toString() ?? ""}
                featureKey={"roster" as EProjectFeatureKey}
                isLast
              />
            </Breadcrumbs>
            <CountChip count={players.length} />
          </div>
        </Header.LeftItem>
        <Header.RightItem className="min-w-40 flex-1">
          <div className="relative w-full max-w-[28.75rem]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-custom-text-400" />
            <Input
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search name, jersey #, position…"
              aria-label="Search roster"
              className="w-full border-custom-border-200 bg-custom-background-100 py-1.5 pl-9 pr-3 text-sm text-custom-text-200"
            />
          </div>
        </Header.RightItem>
        <Header.RightItem className="flex-wrap gap-2">
          <div className="flex gap-2">
            <RosterFilterDropdown
              title="Filter"
              icon={<ListFilter className="size-3.5" />}
              miniIcon={<ListFilter className="size-3.5" />}
            />
            <RosterDisplayDropdown title="Columns" miniIcon={<SlidersHorizontal className="size-3.5" />} />
            {canManage && selectedPlayerIds.length ? (
              <>
                <Button variant="neutral-primary" size="sm" onClick={clearSelectedPlayers}>
                  Clear selection
                </Button>
              </>
            ) : null}
          </div>
          {canManage && <RosterExportDropdown players={allPlayers} projectId={projectId} />}
          {canManage && <RosterAddPlayerActions onAdd={openCreatePlayerModal} onImport={openImportRosterModal} />}
          {canManage ? (
            <Button variant="neutral-primary" size="sm" prependIcon={<Upload />} onClick={openImportRosterModal}>
              Import roster
            </Button>
          ) : null}
          {canGenerateQR && (
            <Button variant="neutral-primary" size="sm" prependIcon={<QrCode />} onClick={() => setShowQR(true)}>
              Team join link
            </Button>
          )}
        </Header.RightItem>
      </Header>
      {showQR && canGenerateQR && (
        <RegistrationQRModal
          key={`${workspaceSlug}:${projectId}`}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          onClose={() => {
            setShowQR(false);
            void refetchRoster();
          }}
        />
      )}
    </>
  );
});
