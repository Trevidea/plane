"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CalendarDays,
  CheckIcon,
  ChevronDown,
  CircleDot,
  Eraser,
  GraduationCap,
  Eye,
  KeyRound,
  Link2,
  Hash,
  MoveRight,
  Pencil,
  Ruler,
  Scale,
  Shirt,
  Trash2,
} from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IRosterPlayer, TRosterPlayerStatus } from "@plane/types";
import { Avatar, Checkbox, CustomMenu, cn } from "@plane/ui";
import { getFileURL } from "@plane/utils";
import { useUserPermissions } from "@/hooks/store/user";
import { useUserReadOnly } from "@/hooks/use-user-readonly";
import { RosterService } from "@/services/roster.service";
import type { IRosterGroup, IRosterGroupedResponse } from "../store/roster-context";
import { useRoster } from "../store/roster-context";
import {
  canDeleteRosterPlayer,
  formatTimestamp,
  getRosterAccountStatus,
  getRosterDisplayEmail,
  invitationDeliveryLabels,
  toDisplayStatus,
} from "../utils/roster.utils";
import { RegistrationQRModal } from "./registration-qr-modal";
import { RosterApprovalButton } from "./roster-approval-button";
const rosterService = new RosterService();

type TRosterColumnKey =
  | "jersey_number"
  | "position"
  | "height"
  | "weight"
  | "class_year"
  | "status"
  | "account_status"
  | "created_at"
  | "updated_at";

type TRosterSortColumnKey = "player_name" | TRosterColumnKey;
type TRosterSortDirection = "asc" | "desc";
type TRosterSortConfig = {
  column: TRosterSortColumnKey;
  direction: TRosterSortDirection;
};

type TRosterColumn = {
  key: TRosterColumnKey;
  label: string;
  icon: LucideIcon;
  headerClassName: string;
  cellClassName: string;
  render: (player: IRosterPlayer) => ReactNode;
};

const EMPTY_VALUE = "--";
const DATE_SORT_COLUMNS: TRosterSortColumnKey[] = ["created_at", "updated_at"];
const NUMERIC_SORT_COLUMNS: TRosterSortColumnKey[] = ["jersey_number", "height", "weight"];
const CLASS_YEAR_ORDER: Record<string, number> = {
  freshman: 1,
  sophomore: 2,
  junior: 3,
  senior: 4,
  graduate: 5,
};

const sortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const statusStyles: Record<TRosterPlayerStatus, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  injured: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  removed: "border-custom-border-300 bg-custom-background-90 text-custom-text-300",
  inactive: "border-custom-border-300 bg-custom-background-90 text-custom-text-300",
  pending: "border-sky-500/30 bg-sky-500/10 text-sky-300",
};

const RosterValue = ({ value, className }: { value: string | null | undefined; className?: string }) => {
  const normalizedValue = value?.trim();
  const isEmptyValue = !normalizedValue || normalizedValue === EMPTY_VALUE;

  return (
    <span className={cn("truncate", className, isEmptyValue && "text-custom-text-400")}>
      {normalizedValue || EMPTY_VALUE}
    </span>
  );
};

export const RosterStatusPill = ({ status }: { status: TRosterPlayerStatus }) => (
  <span
    className={cn(
      "inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium leading-4",
      statusStyles[status]
    )}
  >
    {toDisplayStatus(status)}
  </span>
);

const accountStatusLabels = {
  email_missing: "No account linked",
  not_linked: "Not linked",
  invitation_pending: "Invitation pending",
  linked: "Linked",
};

export const RosterAccountStatusPill = ({ player }: { player: IRosterPlayer }) => {
  if (player.account_link_held)
    return (
      <span className={cn("inline-flex rounded border px-2 py-0.5 text-xs font-medium", statusStyles.pending)}>
        Account access revoked
      </span>
    );
  if (player.registration_status === "pending")
    return (
      <span
        className={cn(
          "inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium",
          statusStyles.pending
        )}
      >
        Waiting for approval
      </span>
    );
  const status = getRosterAccountStatus(player);
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium leading-4",
        status === "linked"
          ? statusStyles.active
          : status === "invitation_pending"
            ? statusStyles.pending
            : statusStyles.inactive
      )}
    >
      {accountStatusLabels[status]}
    </span>
  );
};

const parseNumberValue = (value: string | null | undefined) => {
  if (!value) return null;
  const parsedValue = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isNaN(parsedValue) ? null : parsedValue;
};

const parseHeightValue = (value: string | null | undefined) => {
  const normalizedValue = value?.trim().toLowerCase();
  if (!normalizedValue) return null;

  if (!normalizedValue.includes("'") && !normalizedValue.includes("ft")) return parseNumberValue(normalizedValue);

  const feetMatch = normalizedValue.match(/(\d+(?:\.\d+)?)\s*(?:'|ft)/);
  const inchesMatch = normalizedValue.match(/(?:'|ft)\s*(\d+(?:\.\d+)?)/);
  const feet = feetMatch ? Number.parseFloat(feetMatch[1]) : 0;
  const inches = inchesMatch ? Number.parseFloat(inchesMatch[1]) : 0;

  return feet || inches ? feet * 12 + inches : null;
};

const getSortValue = (player: IRosterPlayer, column: TRosterSortColumnKey): string | number | null => {
  switch (column) {
    case "player_name":
      return player.player_name?.trim() || null;
    case "jersey_number":
      return player.jersey_number?.trim() || null;
    case "height":
      return parseHeightValue(player.height);
    case "weight":
      return parseNumberValue(player.weight);
    case "class_year": {
      const normalizedClassYear = player.class_year?.trim().toLowerCase();
      return normalizedClassYear ? (CLASS_YEAR_ORDER[normalizedClassYear] ?? player.class_year) : null;
    }
    case "created_at":
    case "updated_at": {
      const timestamp = Date.parse(player[column]);
      return Number.isNaN(timestamp) ? null : timestamp;
    }
    default:
      return player[column]?.trim() || null;
  }
};

const sortRosterPlayers = (players: IRosterPlayer[], sortConfig: TRosterSortConfig | null) => {
  if (!sortConfig) return players;

  return players
    .map((player, index) => ({ player, index }))
    .sort((currentPlayer, nextPlayer) => {
      const currentValue = getSortValue(currentPlayer.player, sortConfig.column);
      const nextValue = getSortValue(nextPlayer.player, sortConfig.column);
      const currentIsMissing = currentValue === null || currentValue === "";
      const nextIsMissing = nextValue === null || nextValue === "";

      if (currentIsMissing && nextIsMissing) return currentPlayer.index - nextPlayer.index;
      if (currentIsMissing) return 1;
      if (nextIsMissing) return -1;

      const sortResult =
        typeof currentValue === "number" && typeof nextValue === "number"
          ? currentValue - nextValue
          : sortCollator.compare(String(currentValue), String(nextValue));

      if (sortResult === 0) return currentPlayer.index - nextPlayer.index;
      return sortConfig.direction === "asc" ? sortResult : -sortResult;
    })
    .map(({ player }) => player);
};

const isDateSortColumn = (columnKey: TRosterSortColumnKey) => DATE_SORT_COLUMNS.includes(columnKey);
const isNumericSortColumn = (columnKey: TRosterSortColumnKey) => NUMERIC_SORT_COLUMNS.includes(columnKey);

const getSortIcon = (columnKey: TRosterSortColumnKey, direction: TRosterSortDirection) => {
  if (isDateSortColumn(columnKey)) return direction === "desc" ? ArrowDownWideNarrow : ArrowUpNarrowWide;
  return direction === "asc" ? ArrowDownWideNarrow : ArrowUpNarrowWide;
};

const ROSTER_COLUMNS: TRosterColumn[] = [
  {
    key: "jersey_number",
    label: "Jersey #",
    icon: Hash,
    headerClassName: "min-w-20",
    cellClassName: "min-w-20 text-custom-text-200",
    render: (player) => <RosterValue value={player.jersey_number} className="text-custom-text-200" />,
  },
  {
    key: "position",
    label: "Position",
    icon: Shirt,
    headerClassName: "min-w-28",
    cellClassName: "min-w-28 text-custom-text-300",
    render: (player) => <RosterValue value={player.position} />,
  },
  {
    key: "height",
    label: "Height",
    icon: Ruler,
    headerClassName: "min-w-28",
    cellClassName: "min-w-28 text-custom-text-300",
    render: (player) => <RosterValue value={player.height} />,
  },
  {
    key: "weight",
    label: "Weight",
    icon: Scale,
    headerClassName: "min-w-28",
    cellClassName: "min-w-28 text-custom-text-300",
    render: (player) => <RosterValue value={player.weight} />,
  },
  {
    key: "class_year",
    label: "Grad year / class",
    icon: GraduationCap,
    headerClassName: "min-w-32",
    cellClassName: "min-w-32 text-custom-text-300",
    render: (player) => <RosterValue value={player.class_year} />,
  },
  {
    key: "account_status",
    label: "Account",
    icon: CircleDot,
    headerClassName: "min-w-32",
    cellClassName: "min-w-32",
    render: (player) => (
      <div className="flex flex-col items-start gap-1">
        <RosterAccountStatusPill player={player} />
        {player.invitation_delivery && (
          <span
            className={cn(
              "text-xs",
              player.invitation_delivery.status === "failed" ? "text-red-500" : "text-custom-text-300"
            )}
          >
            {invitationDeliveryLabels[player.invitation_delivery.status]}
          </span>
        )}
      </div>
    ),
  },
  {
    key: "status",
    label: "Status",
    icon: CircleDot,
    headerClassName: "min-w-28",
    cellClassName: "min-w-28",
    render: (player) => <RosterStatusPill status={player.status} />,
  },
  {
    key: "created_at",
    label: "Added",
    icon: CalendarDays,
    headerClassName: "min-w-28",
    cellClassName: "min-w-28 text-custom-text-300",
    render: (player) => <RosterValue value={formatTimestamp(player.created_at)} />,
  },
  {
    key: "updated_at",
    label: "Updated on",
    icon: CalendarDays,
    headerClassName: "min-w-28",
    cellClassName: "min-w-28 text-custom-text-300",
    render: (player) => <RosterValue value={formatTimestamp(player.updated_at)} />,
  },
];

const RosterSortOption = ({
  columnKey,
  direction,
  isActive,
  onSelect,
}: {
  columnKey: TRosterSortColumnKey;
  direction: TRosterSortDirection;
  isActive: boolean;
  onSelect: () => void;
}) => {
  const isDateColumn = isDateSortColumn(columnKey);
  const isNumericColumn = isNumericSortColumn(columnKey);
  const SortIcon = getSortIcon(columnKey, direction);
  const startLabel = isDateColumn
    ? direction === "desc"
      ? "New"
      : "Old"
    : isNumericColumn
      ? direction === "asc"
        ? "1"
        : "9"
      : direction === "asc"
        ? "A"
        : "Z";
  const endLabel = isDateColumn
    ? direction === "desc"
      ? "Old"
      : "New"
    : isNumericColumn
      ? direction === "asc"
        ? "9"
        : "1"
      : direction === "asc"
        ? "Z"
        : "A";

  return (
    <CustomMenu.MenuItem onClick={onSelect}>
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-1",
          isActive ? "text-custom-text-100" : "text-custom-text-200 hover:text-custom-text-100"
        )}
      >
        <div className="flex items-center gap-2">
          <SortIcon className="h-3 w-3 stroke-[1.5]" />
          <span>{startLabel}</span>
          <MoveRight className="h-3 w-3" />
          <span>{endLabel}</span>
        </div>
        {isActive ? <CheckIcon className="h-3 w-3" /> : null}
      </div>
    </CustomMenu.MenuItem>
  );
};

const RosterClearSortOption = ({ onSelect }: { onSelect: () => void }) => (
  <CustomMenu.MenuItem className="mt-0.5" onClick={onSelect}>
    <div className="flex items-center gap-2 px-1 text-custom-text-200 hover:text-custom-text-100">
      <Eraser className="h-3 w-3" />
      <span>Clear sorting</span>
    </div>
  </CustomMenu.MenuItem>
);

const RosterSortableHeaderCell = ({
  columnKey,
  label,
  icon: Icon,
  className,
  sortConfig,
  onSort,
  onClearSort,
  isFirstColumn = false,
  selectionControl,
}: {
  columnKey: TRosterSortColumnKey;
  label: string;
  icon?: LucideIcon;
  className?: string;
  sortConfig: TRosterSortConfig | null;
  onSort: (column: TRosterSortColumnKey, direction: TRosterSortDirection) => void;
  onClearSort: () => void;
  isFirstColumn?: boolean;
  selectionControl?: ReactNode;
}) => (
  <th
    className={cn(
      "h-11 bg-custom-background-100 py-1 text-xs font-medium text-custom-text-300",
      isFirstColumn
        ? "sticky left-0 z-[15] min-w-64 border-r-[0.5px] border-custom-border-100"
        : "border border-b-0 border-t-0 border-custom-border-100",
      className
    )}
    tabIndex={-1}
  >
    <CustomMenu
      customButtonClassName="clickable !w-full"
      customButtonTabIndex={-1}
      className="!w-full"
      customButton={
        <div
          className={cn(
            "flex h-full w-full cursor-pointer items-center justify-between gap-1.5 px-4 py-2 hover:text-custom-text-100",
            isFirstColumn && "px-6",
            sortConfig?.column === columnKey && "text-custom-text-100"
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            {selectionControl ? (
              <div className="flex flex-shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
                {selectionControl}
              </div>
            ) : null}
            {Icon ? <Icon className="h-4 w-4 flex-shrink-0 text-custom-text-400" /> : null}
            <span className="truncate">{label}</span>
          </div>
          <div className="ml-3 flex flex-shrink-0 items-center gap-1 text-custom-text-400">
            {sortConfig?.column === columnKey
              ? (() => {
                  const SortIcon = getSortIcon(columnKey, sortConfig.direction);
                  return <SortIcon className="h-3 w-3" />;
                })()
              : null}
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </div>
        </div>
      }
      placement="bottom-start"
      closeOnSelect
    >
      {(isDateSortColumn(columnKey) ? (["desc", "asc"] as const) : (["asc", "desc"] as const)).map((direction) => (
        <RosterSortOption
          key={direction}
          columnKey={columnKey}
          direction={direction}
          isActive={sortConfig?.column === columnKey && sortConfig.direction === direction}
          onSelect={() => onSort(columnKey, direction)}
        />
      ))}
      {sortConfig?.column === columnKey ? <RosterClearSortOption onSelect={onClearSort} /> : null}
    </CustomMenu>
  </th>
);

const RosterTableHeaderCell = ({ label, className }: { label: string; className?: string }) => (
  <th
    className={cn(
      "h-11 min-w-28 border-b border-custom-border-100 bg-custom-background-100 py-1 text-xs font-medium text-custom-text-300",
      className
    )}
    tabIndex={-1}
  >
    <div className="flex h-full w-full items-center justify-end gap-1.5 px-4 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{label}</span>
      </div>
    </div>
  </th>
);

const RosterTableCell = ({
  children,
  className,
  isFirstColumn = false,
  isActionsColumn = false,
}: {
  children: ReactNode;
  className?: string;
  isFirstColumn?: boolean;
  isActionsColumn?: boolean;
}) => (
  <td
    className={cn(
      "h-16 border-b border-custom-border-100 bg-custom-background-100 px-4 text-[13px] group-hover:bg-custom-background-90/60",
      isFirstColumn && "sticky left-0 z-10 min-w-64 max-w-[32rem] border-r-[0.5px] border-custom-border-200 px-0",
      isActionsColumn && "min-w-28",
      className
    )}
    tabIndex={0}
  >
    <div className={cn("flex h-full min-w-0 items-center", isActionsColumn && "justify-end")}>{children}</div>
  </td>
);

const RosterPlayerCell = ({
  player,
  selectionControl,
  onSelect,
  showAccountDetails = true,
}: {
  player: IRosterPlayer;
  selectionControl?: ReactNode;
  onSelect?: () => void;
  showAccountDetails?: boolean;
}) => (
  <RosterTableCell isFirstColumn>
    <div className="flex h-16 min-w-0 items-center gap-3 px-6">
      {selectionControl ? <div className="flex flex-shrink-0 items-center">{selectionControl}</div> : null}
      <Avatar
        name={player.player_name}
        src={getFileURL(player.account_avatar_url ?? "")}
        fallbackText={player.player_name
          .split(/\s+/)
          .map((name) => name[0])
          .slice(0, 2)
          .join("")}
        size={28}
        showTooltip={false}
        className={
          !player.user
            ? "border border-dashed border-custom-border-300 !bg-custom-background-90 !text-custom-text-300"
            : ""
        }
      />
      <div className="min-w-0 space-y-0.5">
        {onSelect ? (
          <button
            type="button"
            onClick={onSelect}
            className="block max-w-full truncate text-left text-[13px] font-medium text-custom-text-100 hover:text-custom-primary-100"
          >
            {player.player_name || "Unnamed player"}
          </button>
        ) : (
          <span className="block truncate text-[13px] font-medium text-custom-text-100">
            {player.player_name || "Unnamed player"}
          </span>
        )}
        {showAccountDetails && (
          <p className="truncate text-xs text-custom-text-400">
            {getRosterDisplayEmail(player) ||
              (player.registration_status === "pending" ? "Waiting for your approval" : "Account not linked yet")}
          </p>
        )}
      </div>
    </div>
  </RosterTableCell>
);

const RosterActionsMenu = observer(
  ({ player, onOpenDetails }: { player: IRosterPlayer; onOpenDetails?: () => void }) => {
    const {
      workspaceSlug,
      projectId,
      canManage,
      canPreviewAccounts,
      isSubmitting,
      openEditPlayerModal,
      openDeletePlayerModal,
      setPlayerStatus,
      openDeleteAccountModal,
    } = useRoster();
    const { allowPermissions } = useUserPermissions();
    const [copying, setCopying] = useState(false);
    const [showJoin, setShowJoin] = useState(false);
    const canShare =
      canManage &&
      allowPermissions(
        [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
        EUserPermissionsLevel.WORKSPACE,
        workspaceSlug
      );
    const copyJoinLink = async () => {
      if (!canShare || copying) return;
      setCopying(true);
      try {
        const session = await rosterService.getRegistration(workspaceSlug, projectId);
        if (!session || Date.parse(session.expires_at) <= Date.now()) {
          setShowJoin(true);
          return;
        }
        await navigator.clipboard.writeText(session.url);
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Join link copied",
          message: "Share it with the player in your own message.",
        });
      } catch {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Could not copy join link",
          message: "Open the team join dialog to copy or generate a link.",
        });
      } finally {
        setCopying(false);
      }
    };
    if (!canManage) return null;
    const isPending = player.registration_status === "pending" || player.status === "pending";

    return (
      <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
        {player.status === "inactive" && (
          <button
            type="button"
            disabled={isSubmitting}
            className="whitespace-nowrap rounded border border-custom-border-200 px-2 py-1 text-xs text-custom-text-200 hover:bg-custom-background-80 disabled:opacity-50"
            onClick={() => void setPlayerStatus(player, "active")}
          >
            Make active
          </button>
        )}
        {isPending && <RosterApprovalButton player={player} />}
        <CustomMenu
          ellipsis
          placement="bottom-end"
          closeOnSelect
          buttonClassName="grid size-7 place-items-center rounded text-custom-text-400 hover:bg-custom-background-80 hover:text-custom-text-100"
        >
          {onOpenDetails && (
            <CustomMenu.MenuItem className="flex items-center gap-2" onClick={onOpenDetails}>
              <Eye className="size-3.5" />
              Open details
            </CustomMenu.MenuItem>
          )}
          {!isPending && (
            <>
              <CustomMenu.MenuItem
                className={cn("flex items-center gap-2", !canManage && "text-custom-text-400")}
                disabled={!canManage}
                onClick={() => openEditPlayerModal(player)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </CustomMenu.MenuItem>
              <CustomMenu.MenuItem
                className="flex items-center gap-2"
                disabled={isSubmitting}
                onClick={() => void setPlayerStatus(player, player.status === "inactive" ? "active" : "inactive")}
              >
                <CircleDot className="h-3.5 w-3.5" />
                {player.status === "inactive" ? "Set active" : "Set inactive"}
              </CustomMenu.MenuItem>
            </>
          )}
          {player.user ? (
            <CustomMenu.MenuItem disabled className="flex items-center gap-2 text-custom-text-400">
              <KeyRound className="size-3.5" />
              Reset password · unavailable
            </CustomMenu.MenuItem>
          ) : (
            canShare && (
              <CustomMenu.MenuItem
                disabled={copying}
                onClick={() => void copyJoinLink()}
                className="flex items-center gap-2"
              >
                <Link2 className="size-3.5" />
                Copy team join link
              </CustomMenu.MenuItem>
            )
          )}
          {canManage && canDeleteRosterPlayer(player) && (
            <CustomMenu.MenuItem
              className="flex items-center gap-2 text-red-500"
              onClick={() => openDeletePlayerModal(player)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove from roster
            </CustomMenu.MenuItem>
          )}
          {canPreviewAccounts && player.user && (
            <CustomMenu.MenuItem
              className="flex items-center gap-2 text-red-500"
              disabled={isSubmitting}
              onClick={() => openDeleteAccountModal({ id: player.id, player_name: player.player_name })}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Preview account deletion
            </CustomMenu.MenuItem>
          )}
        </CustomMenu>
        {showJoin && canShare && (
          <RegistrationQRModal workspaceSlug={workspaceSlug} projectId={projectId} onClose={() => setShowJoin(false)} />
        )}
      </div>
    );
  }
);

const RosterLoadingRows = ({ columns, showActions }: { columns: TRosterColumn[]; showActions: boolean }) => (
  <>
    {Array.from({ length: 6 }).map((_, rowIndex) => (
      <tr key={rowIndex} className="group bg-custom-background-100">
        <RosterTableCell isFirstColumn>
          <div className="flex h-11 items-center gap-3 px-6">
            <span className="h-3 w-14 animate-pulse rounded bg-custom-background-80" />
            <span className="h-3 w-40 animate-pulse rounded bg-custom-background-80" />
          </div>
        </RosterTableCell>
        {columns.map((column) => (
          <RosterTableCell key={column.key} className={column.cellClassName}>
            <span className="h-3 w-20 animate-pulse rounded bg-custom-background-80" />
          </RosterTableCell>
        ))}
        {showActions && (
          <RosterTableCell isActionsColumn>
            <span className="h-5 w-5 animate-pulse rounded bg-custom-background-80" />
          </RosterTableCell>
        )}
      </tr>
    ))}
  </>
);

const RosterEmptyRow = ({ columnCount, message }: { columnCount: number; message: string }) => (
  <tr className="bg-custom-background-100">
    <td
      colSpan={columnCount}
      className="h-11 border-b-[0.5px] border-custom-border-100 px-6 text-sm text-custom-text-400"
    >
      {message}
    </td>
  </tr>
);

const getGroupLabel = (group: IRosterGroup) => group.label || group.key || "Unassigned";

const RosterGroupRow = ({
  label,
  count,
  columnCount,
  isSubGroup = false,
}: {
  label: string;
  count: number;
  columnCount: number;
  isSubGroup?: boolean;
}) => (
  <tr className="bg-custom-background-90">
    <td
      colSpan={columnCount}
      className={cn(
        "h-10 border-b-[0.5px] border-custom-border-100 px-6 text-sm font-medium text-custom-text-200",
        isSubGroup && "pl-10 text-custom-text-300"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className="text-xs text-custom-text-400">{count}</span>
      </div>
    </td>
  </tr>
);

export const RosterTable = observer(
  ({
    players,
    groupedRoster,
    isLoading = false,
    onSelectPlayer,
  }: {
    players: IRosterPlayer[];
    groupedRoster?: IRosterGroupedResponse | null;
    isLoading?: boolean;
    onSelectPlayer?: (player: IRosterPlayer) => void;
  }) => {
    const {
      canManage,
      displayProperties,
      searchValue,
      selectedClassYear,
      selectedPosition,
      selectedStatus,
      selectedPlayerIds,
      togglePlayerSelection,
      toggleAllPlayerSelections,
    } = useRoster();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [sortConfig, setSortConfig] = useState<TRosterSortConfig | null>(null);

    const isReadOnlyUser = useUserReadOnly();
    const visibleColumns = useMemo(
      () =>
        ROSTER_COLUMNS.filter(
          (column) =>
            displayProperties[column.key] &&
            (!isReadOnlyUser || ["jersey_number", "position", "height", "weight", "class_year"].includes(column.key))
        ),
      [displayProperties, isReadOnlyUser]
    );
    const sortedPlayers = useMemo(() => sortRosterPlayers(players, sortConfig), [players, sortConfig]);
    const allVisiblePlayerIds = useMemo(() => sortedPlayers.map((player) => player.id), [sortedPlayers]);
    const allVisiblePlayersSelected =
      allVisiblePlayerIds.length > 0 && allVisiblePlayerIds.every((playerId) => selectedPlayerIds.includes(playerId));
    const someVisiblePlayersSelected =
      allVisiblePlayerIds.some((playerId) => selectedPlayerIds.includes(playerId)) && !allVisiblePlayersSelected;
    const handleSort = useCallback((column: TRosterSortColumnKey, direction: TRosterSortDirection) => {
      setSortConfig({ column, direction });
    }, []);
    const handleClearSort = useCallback(() => setSortConfig(null), []);

    const handleScroll = useCallback(() => {
      const scrollContainer = containerRef.current;
      if (!scrollContainer) return;

      const firstColumns = scrollContainer.querySelectorAll("table tr td:first-child, table tr th:first-child");
      const shadow = scrollContainer.scrollLeft > 0 ? "8px 22px 22px 10px rgba(0, 0, 0, 0.05)" : "none";
      const headerShadow = scrollContainer.scrollLeft > 0 ? "8px -22px 22px 10px rgba(0, 0, 0, 0.05)" : "none";

      firstColumns.forEach((column, index) => {
        (column as HTMLElement).style.boxShadow = index === 0 ? headerShadow : shadow;
      });
    }, []);

    useEffect(() => {
      const currentContainer = containerRef.current;
      if (!currentContainer) return;

      currentContainer.addEventListener("scroll", handleScroll);
      handleScroll();

      return () => currentContainer.removeEventListener("scroll", handleScroll);
    }, [handleScroll]);

    const columnCount = visibleColumns.length + (isReadOnlyUser ? 1 : 2);
    const hasActiveFilters =
      searchValue.trim().length > 0 ||
      Boolean(selectedPosition) ||
      Boolean(selectedStatus) ||
      Boolean(selectedClassYear);
    const emptyMessage = hasActiveFilters ? "No players match your search or filters." : "No roster players found.";

    const renderPlayerRow = (player: IRosterPlayer, nested = false) => (
      <tr
        key={player.id}
        className={cn(
          "group bg-custom-background-100 text-sm text-custom-text-300 transition-[background-color]",
          nested && "bg-custom-background-100/80"
        )}
      >
        <RosterPlayerCell
          player={player}
          showAccountDetails={!isReadOnlyUser}
          onSelect={onSelectPlayer ? () => onSelectPlayer(player) : undefined}
          selectionControl={
            canManage ? (
              <Checkbox
                checked={selectedPlayerIds.includes(player.id)}
                onClick={(event) => {
                  event.stopPropagation();
                  togglePlayerSelection(player.id);
                }}
                readOnly
                aria-label={`Select ${player.player_name || "player"}`}
              />
            ) : undefined
          }
        />
        {visibleColumns.map((column) => (
          <RosterTableCell key={column.key} className={column.cellClassName}>
            {column.render(player)}
          </RosterTableCell>
        ))}
        {!isReadOnlyUser && (
          <RosterTableCell isActionsColumn>
            <RosterActionsMenu
              player={player}
              onOpenDetails={onSelectPlayer ? () => onSelectPlayer(player) : undefined}
            />
          </RosterTableCell>
        )}
      </tr>
    );

    const renderGroupedRows = (groups: IRosterGroup[]) =>
      groups.flatMap((group) => {
        const groupRows: ReactNode[] = [
          <RosterGroupRow
            key={`group-${group.key ?? "none"}`}
            label={getGroupLabel(group)}
            count={group.count}
            columnCount={columnCount}
          />,
        ];

        if (group.sub_groups?.length) {
          groupRows.push(
            ...group.sub_groups.flatMap((subGroup: IRosterGroup) => [
              <RosterGroupRow
                key={`sub-group-${group.key ?? "none"}-${subGroup.key ?? "none"}`}
                label={getGroupLabel(subGroup)}
                count={subGroup.count}
                columnCount={columnCount}
                isSubGroup
              />,
              ...subGroup.players.map((player: IRosterPlayer) => renderPlayerRow(player, true)),
            ])
          );
        } else {
          groupRows.push(...group.players.map((player: IRosterPlayer) => renderPlayerRow(player)));
        }

        return groupRows;
      });

    return (
      <div className="relative flex h-full min-h-0 w-full flex-col overflow-x-hidden whitespace-nowrap bg-custom-background-100 text-custom-text-200">
        <div ref={containerRef} className="vertical-scrollbar horizontal-scrollbar scrollbar-lg h-full w-full">
          <table className="w-full min-w-max overflow-y-auto bg-custom-background-100">
            <thead className="sticky left-0 top-0 z-[12] border-b-[0.5px] border-custom-border-100">
              <tr>
                <RosterSortableHeaderCell
                  columnKey="player_name"
                  label="Player"
                  sortConfig={sortConfig}
                  onSort={handleSort}
                  onClearSort={handleClearSort}
                  isFirstColumn
                  selectionControl={
                    canManage ? (
                      <Checkbox
                        checked={allVisiblePlayersSelected}
                        indeterminate={someVisiblePlayersSelected}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleAllPlayerSelections();
                        }}
                        disabled={!allVisiblePlayerIds.length || isLoading}
                        readOnly
                        aria-label="Select all visible players"
                      />
                    ) : undefined
                  }
                />
                {visibleColumns.map((column) => (
                  <RosterSortableHeaderCell
                    key={column.key}
                    columnKey={column.key}
                    label={column.label}
                    icon={column.icon}
                    className={column.headerClassName}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    onClearSort={handleClearSort}
                  />
                ))}
                {!isReadOnlyUser && <RosterTableHeaderCell label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <RosterLoadingRows columns={visibleColumns} showActions={!isReadOnlyUser} />
              ) : groupedRoster?.results.length ? (
                renderGroupedRows(groupedRoster.results)
              ) : sortedPlayers.length > 0 ? (
                sortedPlayers.map((player) => renderPlayerRow(player))
              ) : (
                <RosterEmptyRow columnCount={columnCount} message={emptyMessage} />
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
);
