"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { beginRosterUI, rosterUIFailure } from "@plane/logger/diagnostics-browser";
import { isAxiosError } from "axios";
import { useParams } from "next/navigation";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  IRosterFilters,
  IRosterLifecycleEvent,
  IRosterPlayer,
  IRosterPlayerPayload,
  TRosterImportRow,
  TRosterPlayerStatus,
} from "@plane/types";
import { useUserPermissions } from "@/hooks/store/user";
import { RosterService } from "@/services/roster.service";
import { isPendingPlayer } from "../utils/roster-presentation";
import { canDeleteRosterPlayer, getUniqueRosterValues } from "../utils/roster.utils";

export type TRosterFormState = {
  player_name: string;
  email: string;
  jersey_number: string;
  position: string;
  height: string;
  weight: string;
  class_year: string;
  status: TRosterPlayerStatus;
  notes: string;
};

type TRosterImportOutcome =
  | { kind: "saved" }
  | { kind: "unknown" }
  | { kind: "rejected"; rowError?: { index: number; message: string } };

export type TRosterDisplayPropertyKey =
  | "player"
  | "jersey_number"
  | "position"
  | "height"
  | "weight"
  | "class_year"
  | "status"
  | "account_status"
  | "notes"
  | "created_at"
  | "updated_at";

export type TRosterGroupByOption = "none" | "position" | "status" | "class_year";
export type TRosterOrderByOption =
  | "manual"
  | "player_name"
  | "jersey_number"
  | "position"
  | "status"
  | "created_at"
  | "updated_at";
export type TRosterViewOption = "list" | "grid";
export type TRosterGroupValue = Exclude<TRosterGroupByOption, "none">;
export type IRosterGroup = {
  key: string | null;
  label: string;
  count: number;
  players: IRosterPlayer[];
  sub_groups?: IRosterGroup[];
};

export type IRosterGroupedResponse = {
  grouped_by: TRosterGroupValue;
  sub_grouped_by: TRosterGroupValue | null;
  order_by: TRosterOrderByOption;
  results: IRosterGroup[];
};

export type TRosterTab = "all" | "inactive" | "requests" | "events";
type TAccountDeletionTarget = { id: string; player_name: string };

type TRosterContext = {
  rosterTab: TRosterTab;
  setRosterTab: (tab: TRosterTab) => void;
  canPreviewAccounts: boolean;
  events: IRosterLifecycleEvent[];
  isLoadingEvents: boolean;
  eventsError: string | null;
  refetchEvents: () => Promise<void>;
  accountDeletionTarget: TAccountDeletionTarget | null;
  openDeleteAccountModal: (target: TAccountDeletionTarget) => void;
  closeDeleteAccountModal: () => void;
  deleteAccount: (confirmation: string) => Promise<boolean>;
  setPlayerStatus: (player: IRosterPlayer, status: "active" | "inactive") => Promise<void>;
  setSelectedPlayerStatus: (status: "active" | "inactive") => Promise<void>;
  workspaceSlug: string;
  projectId: string;
  players: IRosterPlayer[];
  groupedRoster: IRosterGroupedResponse | null;
  allPlayers: IRosterPlayer[];
  statusOptions: string[];
  positionOptions: string[];
  classYearOptions: string[];
  isLoading: boolean;
  isSubmitting: boolean;
  canManage: boolean;
  searchValue: string;
  selectedPosition: string;
  selectedStatus: string;
  selectedClassYear: string;
  activeView: TRosterViewOption;
  displayProperties: Record<TRosterDisplayPropertyKey, boolean>;
  groupBy: TRosterGroupByOption;
  subGroupBy: TRosterGroupByOption;
  orderBy: TRosterOrderByOption;
  isAddPlayerModalOpen: boolean;
  isImportRosterModalOpen: boolean;
  pendingImportFile: File | null;
  editingPlayer: IRosterPlayer | null;
  deletingPlayer: IRosterPlayer | null;
  selectedPlayerIds: string[];
  selectedPlayers: IRosterPlayer[];
  isBulkDeleteModalOpen: boolean;
  setSearchValue: (value: string) => void;
  setSelectedPosition: (value: string) => void;
  setSelectedStatus: (value: string) => void;
  setSelectedClassYear: (value: string) => void;
  setActiveView: (value: TRosterViewOption) => void;
  toggleDisplayProperty: (key: TRosterDisplayPropertyKey) => void;
  setGroupBy: (value: TRosterGroupByOption) => void;
  setSubGroupBy: (value: TRosterGroupByOption) => void;
  setOrderBy: (value: TRosterOrderByOption) => void;
  openCreatePlayerModal: () => void;
  openEditPlayerModal: (player: IRosterPlayer) => void;
  closePlayerModal: () => void;
  openImportRosterModal: () => void;
  closeImportRosterModal: () => void;
  setPendingImportFile: (file: File | null) => void;
  togglePlayerSelection: (playerId: string) => void;
  toggleAllPlayerSelections: () => void;
  clearSelectedPlayers: () => void;
  openDeletePlayerModal: (player: IRosterPlayer) => void;
  closeDeletePlayerModal: () => void;
  openBulkDeleteModal: () => void;
  closeBulkDeleteModal: () => void;
  submitPlayer: (
    payload: TRosterFormState,
    options?: { keepOpen?: boolean; existingAccountId?: string }
  ) => Promise<boolean>;
  deletePlayer: () => Promise<void>;
  deleteSelectedPlayers: () => Promise<void>;
  importPlayers: (players: TRosterImportRow[], importId: string, retry?: boolean) => Promise<TRosterImportOutcome>;
  refetchRoster: () => Promise<void>;
};

const RosterContext = createContext<TRosterContext | undefined>(undefined);

const rosterService = new RosterService();

const DEFAULT_FORM_STATE: TRosterFormState = {
  player_name: "",
  email: "",
  jersey_number: "",
  position: "",
  height: "",
  weight: "",
  class_year: "",
  status: "active",
  notes: "",
};

const DEFAULT_DISPLAY_PROPERTIES: Record<TRosterDisplayPropertyKey, boolean> = {
  player: true,
  jersey_number: true,
  position: true,
  height: false,
  weight: false,
  class_year: true,
  status: true,
  account_status: true,
  notes: false,
  created_at: true,
  updated_at: false,
};
const STATUS_ORDER: TRosterPlayerStatus[] = ["active", "injured", "inactive", "pending"];
const CLASS_YEAR_ORDER: Record<string, number> = {
  freshman: 1,
  sophomore: 2,
  junior: 3,
  senior: 4,
  graduate: 5,
};

const sortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const normalizeValue = (value: string | null | undefined) => value?.trim() || "";

const getPlayerSortValue = (player: IRosterPlayer, orderBy: TRosterOrderByOption) => {
  switch (orderBy) {
    case "player_name":
      return normalizeValue(player.player_name);
    case "jersey_number":
      return normalizeValue(player.jersey_number);
    case "position":
      return normalizeValue(player.position);
    case "status":
      return STATUS_ORDER.indexOf(player.status);
    case "created_at":
    case "updated_at": {
      const timestamp = Date.parse(player[orderBy]);
      return Number.isNaN(timestamp) ? null : timestamp;
    }
    default:
      return null;
  }
};

const sortPlayers = (players: IRosterPlayer[], orderBy: TRosterOrderByOption) => {
  if (orderBy === "manual") return players;

  return players
    .map((player, index) => ({ player, index }))
    .sort((currentPlayer, nextPlayer) => {
      const currentValue = getPlayerSortValue(currentPlayer.player, orderBy);
      const nextValue = getPlayerSortValue(nextPlayer.player, orderBy);
      const currentMissing = currentValue === null || currentValue === "";
      const nextMissing = nextValue === null || nextValue === "";

      if (currentMissing && nextMissing) return currentPlayer.index - nextPlayer.index;
      if (currentMissing) return 1;
      if (nextMissing) return -1;

      let sortResult = 0;
      if (typeof currentValue === "number" && typeof nextValue === "number") {
        sortResult = currentValue - nextValue;
      } else {
        sortResult = sortCollator.compare(String(currentValue), String(nextValue));
      }

      if (sortResult === 0) {
        return sortCollator.compare(
          normalizeValue(currentPlayer.player.player_name),
          normalizeValue(nextPlayer.player.player_name)
        );
      }

      if (orderBy === "created_at" || orderBy === "updated_at") return -sortResult;
      return sortResult;
    })
    .map(({ player }) => player);
};

const matchesSearch = (player: IRosterPlayer, searchTerm: string) => {
  if (!searchTerm) return true;

  const haystack = [
    player.player_name,
    player.jersey_number,
    player.position,
    player.class_year,
    player.status,
    player.height,
    player.weight,
    player.notes,
  ]
    .map((value) => normalizeValue(value).toLowerCase())
    .join(" ");

  return haystack.includes(searchTerm.toLowerCase());
};

const getGroupLabel = (field: TRosterGroupValue, value: string | null) => {
  if (!value) return "Unassigned";
  if (field === "status") return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
  return value;
};

type TRosterGroupSortKey = [number, number, string];

const getGroupSortKey = (field: TRosterGroupValue, value: string | null): TRosterGroupSortKey => {
  if (!value) return [1, Number.MAX_SAFE_INTEGER, ""];
  if (field === "status") {
    const statusIndex = STATUS_ORDER.indexOf(value as TRosterPlayerStatus);
    return [0, statusIndex >= 0 ? statusIndex : Number.MAX_SAFE_INTEGER, ""];
  }
  if (field === "class_year") {
    return [0, CLASS_YEAR_ORDER[value.toLowerCase()] ?? Number.MAX_SAFE_INTEGER, value.toLowerCase()];
  }
  return [0, 0, value.toLowerCase()];
};

const compareGroupSortKeys = (currentKey: TRosterGroupSortKey, nextKey: TRosterGroupSortKey) => {
  if (currentKey[0] !== nextKey[0]) return currentKey[0] - nextKey[0];
  if (currentKey[1] !== nextKey[1]) return currentKey[1] - nextKey[1];
  return sortCollator.compare(currentKey[2], nextKey[2]);
};

const buildGroupedRoster = (
  players: IRosterPlayer[],
  groupBy: TRosterGroupByOption,
  subGroupBy: TRosterGroupByOption,
  orderBy: TRosterOrderByOption
): IRosterGroupedResponse | null => {
  if (groupBy === "none") return null;

  const groupedResults = new Map<string | null, IRosterGroup & { sub_groups_map: Map<string | null, IRosterGroup> }>();

  players.forEach((player) => {
    const groupKey = (player[groupBy] as string | null) ?? null;
    const group = groupedResults.get(groupKey) ?? {
      key: groupKey,
      label: getGroupLabel(groupBy, groupKey),
      count: 0,
      players: [],
      sub_groups_map: new Map<string | null, IRosterGroup>(),
    };

    group.count += 1;

    if (subGroupBy !== "none") {
      const subGroupKey = (player[subGroupBy] as string | null) ?? null;
      const subGroup = group.sub_groups_map.get(subGroupKey) ?? {
        key: subGroupKey,
        label: getGroupLabel(subGroupBy, subGroupKey),
        count: 0,
        players: [],
      };

      subGroup.count += 1;
      subGroup.players.push(player);
      group.sub_groups_map.set(subGroupKey, subGroup);
    } else {
      group.players.push(player);
    }

    groupedResults.set(groupKey, group);
  });

  const results = Array.from(groupedResults.values())
    .sort((currentGroup, nextGroup) =>
      compareGroupSortKeys(getGroupSortKey(groupBy, currentGroup.key), getGroupSortKey(groupBy, nextGroup.key))
    )
    .map((group) => {
      const payload: IRosterGroup = {
        key: group.key,
        label: group.label,
        count: group.count,
        players: group.players,
      };

      if (subGroupBy !== "none") {
        payload.sub_groups = Array.from(group.sub_groups_map.values()).sort((currentGroup, nextGroup) =>
          compareGroupSortKeys(
            getGroupSortKey(subGroupBy, currentGroup.key),
            getGroupSortKey(subGroupBy, nextGroup.key)
          )
        );
      }

      return payload;
    });

  return {
    grouped_by: groupBy,
    sub_grouped_by: subGroupBy === "none" ? null : subGroupBy,
    order_by: orderBy,
    results,
  };
};

const normalizePayload = (payload: TRosterFormState): IRosterPlayerPayload => ({
  player_name: payload.player_name.trim(),
  email: payload.email.trim().toLowerCase(),
  jersey_number: payload.jersey_number.trim() || null,
  position: payload.position.trim() || null,
  height: payload.height.trim() || null,
  weight: payload.weight.trim() || null,
  class_year: payload.class_year.trim() || null,
  status: payload.status,
  notes: payload.notes.trim() || null,
});

const getErrorMessage = (error: unknown, fallback: string) => {
  if (!error || typeof error !== "object") return fallback;
  if ("error" in error && typeof error.error === "string") return error.error;
  if ("players" in error && Array.isArray(error.players) && typeof error.players[0] === "string")
    return error.players[0];
  const firstFieldError = Object.values(error)[0];
  if (typeof firstFieldError === "string") return firstFieldError;
  if (Array.isArray(firstFieldError) && typeof firstFieldError[0] === "string") return firstFieldError[0];
  return fallback;
};

export const RosterProvider = ({ children }: { children: ReactNode }) => {
  const { workspaceSlug, projectId } = useParams() as { workspaceSlug: string; projectId: string };
  const { allowPermissions } = useUserPermissions();
  const [allPlayers, setAllPlayers] = useState<IRosterPlayer[]>([]);
  const [rosterTab, updateRosterTab] = useState<TRosterTab>("all");
  const [events, setEvents] = useState<IRosterLifecycleEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [accountDeletionTarget, setAccountDeletionTarget] = useState<TAccountDeletionTarget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [selectedPosition, setSelectedPosition] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedClassYear, setSelectedClassYear] = useState("");
  const [activeView, setActiveView] = useState<TRosterViewOption>("list");
  const [displayProperties, setDisplayProperties] = useState(DEFAULT_DISPLAY_PROPERTIES);
  const [groupBy, setGroupBy] = useState<TRosterGroupByOption>("none");
  const [subGroupBy, setSubGroupBy] = useState<TRosterGroupByOption>("none");
  const [orderBy, setOrderBy] = useState<TRosterOrderByOption>("jersey_number");
  const [isAddPlayerModalOpen, setIsAddPlayerModalOpen] = useState(false);
  const [isImportRosterModalOpen, setIsImportRosterModalOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<IRosterPlayer | null>(null);
  const [deletingPlayer, setDeletingPlayer] = useState<IRosterPlayer | null>(null);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const canManage = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );

  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug);
  const setRosterTab = useCallback((tab: TRosterTab) => {
    updateRosterTab(tab);
    setSelectedStatus("");
    setSelectedPlayerIds([]);
  }, []);
  const refetchEvents = useCallback(async () => {
    if (!canManage) return;
    setIsLoadingEvents(true);
    setEventsError(null);
    try {
      setEvents(await rosterService.getRosterEvents(workspaceSlug, projectId));
    } catch (error) {
      setEventsError(getErrorMessage(error, "Event log could not be loaded. Please try again."));
    } finally {
      setIsLoadingEvents(false);
    }
  }, [canManage, projectId, workspaceSlug]);
  useEffect(() => {
    if (rosterTab === "events") void refetchEvents();
  }, [refetchEvents, rosterTab]);

  useEffect(() => {
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(() => setDebouncedSearch(searchValue.trim()), 300);
    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, [searchValue]);

  const activeFilters = useMemo<IRosterFilters>(
    () => ({
      search: debouncedSearch || undefined,
      position: selectedPosition || undefined,
      status: (selectedStatus as TRosterPlayerStatus) || undefined,
      class_year: selectedClassYear || undefined,
    }),
    [debouncedSearch, selectedClassYear, selectedPosition, selectedStatus]
  );

  const statusOptions = ["active", "inactive"];
  const positionOptions = useMemo(() => getUniqueRosterValues(allPlayers, "position"), [allPlayers]);
  const classYearOptions = useMemo(() => getUniqueRosterValues(allPlayers, "class_year"), [allPlayers]);
  const players = useMemo(() => {
    const filteredPlayers = allPlayers.filter(
      (player) =>
        player.status !== "removed" &&
        (rosterTab === "requests"
          ? isPendingPlayer(player)
          : rosterTab === "inactive"
            ? player.status === "inactive"
            : ["active", "injured"].includes(player.status)) &&
        matchesSearch(player, debouncedSearch) &&
        (!activeFilters.position || player.position === activeFilters.position) &&
        (!activeFilters.status || player.status === activeFilters.status) &&
        (!activeFilters.class_year || player.class_year === activeFilters.class_year)
    );

    return sortPlayers(filteredPlayers, orderBy);
  }, [
    activeFilters.class_year,
    activeFilters.position,
    activeFilters.status,
    allPlayers,
    debouncedSearch,
    orderBy,
    rosterTab,
  ]);
  const groupedRoster = useMemo(
    () => buildGroupedRoster(players, groupBy, subGroupBy, orderBy),
    [groupBy, orderBy, players, subGroupBy]
  );
  const selectedPlayers = useMemo(
    () => allPlayers.filter((player) => selectedPlayerIds.includes(player.id)),
    [allPlayers, selectedPlayerIds]
  );

  useEffect(() => {
    setSelectedPlayerIds((currentSelectedPlayerIds) =>
      currentSelectedPlayerIds.filter((playerId) => allPlayers.some((player) => player.id === playerId))
    );
  }, [allPlayers]);

  const refetchRoster = useCallback(async () => {
    setIsLoading(true);
    try {
      const roster = await rosterService.getRoster(workspaceSlug, projectId);
      setAllPlayers(
        roster
          .filter((player) => player.status !== "removed")
          .map((player) => (player.status === "injured" ? { ...player, status: "active" as const } : player))
      );
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: getErrorMessage(error, "Roster could not be loaded. Please try again."),
      });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, workspaceSlug]);

  useEffect(() => {
    refetchRoster();
  }, [refetchRoster]);

  const openCreatePlayerModal = () => {
    setEditingPlayer(null);
    setIsAddPlayerModalOpen(true);
  };

  const openEditPlayerModal = (player: IRosterPlayer) => {
    if (
      !canManage ||
      player.status === "removed" ||
      player.status === "pending" ||
      player.registration_status === "pending"
    )
      return;
    setEditingPlayer(player);
    setIsAddPlayerModalOpen(true);
  };

  const closePlayerModal = () => {
    setEditingPlayer(null);
    setIsAddPlayerModalOpen(false);
  };

  const openImportRosterModal = () => setIsImportRosterModalOpen(true);
  const closeImportRosterModal = () => {
    setPendingImportFile(null);
    setIsImportRosterModalOpen(false);
  };
  const togglePlayerSelection = (playerId: string) =>
    setSelectedPlayerIds((currentSelectedPlayerIds) =>
      currentSelectedPlayerIds.includes(playerId)
        ? currentSelectedPlayerIds.filter((id) => id !== playerId)
        : [...currentSelectedPlayerIds, playerId]
    );
  const toggleAllPlayerSelections = () =>
    setSelectedPlayerIds((currentSelectedPlayerIds) => {
      const visiblePlayerIds = players.map((player) => player.id);
      const hasUnselectedVisiblePlayers = visiblePlayerIds.some(
        (playerId) => !currentSelectedPlayerIds.includes(playerId)
      );

      if (hasUnselectedVisiblePlayers) {
        return Array.from(new Set([...currentSelectedPlayerIds, ...visiblePlayerIds]));
      }

      return currentSelectedPlayerIds.filter((playerId) => !visiblePlayerIds.includes(playerId));
    });
  const clearSelectedPlayers = () => setSelectedPlayerIds([]);
  const openDeletePlayerModal = (player: IRosterPlayer) => {
    if (canManage && canDeleteRosterPlayer(player)) setDeletingPlayer(player);
  };
  const closeDeletePlayerModal = () => setDeletingPlayer(null);
  const openBulkDeleteModal = () => setIsBulkDeleteModalOpen(true);
  const closeBulkDeleteModal = () => setIsBulkDeleteModalOpen(false);
  const toggleDisplayProperty = (key: TRosterDisplayPropertyKey) =>
    setDisplayProperties((current) => ({ ...current, [key]: !current[key] }));
  const updateGroupBy = (value: TRosterGroupByOption) => {
    setGroupBy(value);
    if (value === "none") {
      setSubGroupBy("none");
      return;
    }
    if (subGroupBy === value) setSubGroupBy("none");
  };
  const updateSubGroupBy = (value: TRosterGroupByOption) => {
    if (groupBy === "none") {
      setGroupBy(value === "none" ? "none" : value);
      setSubGroupBy("none");
      return;
    }
    setSubGroupBy(value === groupBy ? "none" : value);
  };

  const submitPlayer = async (
    payload: TRosterFormState,
    options?: { keepOpen?: boolean; existingAccountId?: string }
  ) => {
    if (!canManage || isSubmitting || !["active", "inactive"].includes(payload.status)) return false;
    if (
      editingPlayer?.registration_status === "pending" ||
      editingPlayer?.status === "pending" ||
      editingPlayer?.status === "removed"
    )
      return false;
    const observed = beginRosterUI(editingPlayer && editingPlayer.status !== payload.status ? "status" : "save");
    setIsSubmitting(true);
    try {
      if (editingPlayer) {
        const updatedPlayer = await rosterService.updateRosterPlayer(
          workspaceSlug,
          projectId,
          editingPlayer.id,
          normalizePayload(payload),
          observed.headers
        );
        setAllPlayers((currentPlayers) =>
          currentPlayers.map((player) => (player.id === updatedPlayer.id ? updatedPlayer : player))
        );
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Success!",
          message: "Player updated successfully.",
        });
      } else {
        const createdPlayer = await rosterService.createRosterPlayer(
          workspaceSlug,
          projectId,
          {
            ...normalizePayload(payload),
            ...(options?.existingAccountId ? { existing_account_id: options.existingAccountId } : {}),
          },
          observed.headers
        );
        setAllPlayers((currentPlayers) => [...currentPlayers, createdPlayer]);
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Success!",
          message: options?.existingAccountId
            ? "Player added and linked to their existing account."
            : "Player added successfully.",
        });
      }

      if (!options?.keepOpen || editingPlayer) closePlayerModal();
      await refetchRoster();
      observed.finish("confirmed");
      return true;
    } catch (error) {
      observed.finish(rosterUIFailure(error));
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: getErrorMessage(
          isAxiosError(error) ? error.response?.data : error,
          "Player could not be saved. Please try again."
        ),
      });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const setPlayerStatus = async (player: IRosterPlayer, status: "active" | "inactive") => {
    if (
      !canManage ||
      isSubmitting ||
      player.status === "pending" ||
      player.registration_status === "pending" ||
      player.status === "removed"
    )
      return;
    setIsSubmitting(true);
    try {
      await rosterService.updateRosterPlayer(workspaceSlug, projectId, player.id, { status });
      setSelectedPlayerIds((ids) => ids.filter((id) => id !== player.id));
      await refetchRoster();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Player updated", message: `Player set ${status}.` });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Could not update player",
        message: getErrorMessage(error, "Please try again."),
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  const setSelectedPlayerStatus = async (status: "active" | "inactive") => {
    if (!canManage || isSubmitting) return;
    const eligible = selectedPlayers.filter((player) => !isPendingPlayer(player) && player.status !== "removed");
    if (!eligible.length) return;
    setIsSubmitting(true);
    try {
      const results = await Promise.allSettled(
        eligible.map((player) => rosterService.updateRosterPlayer(workspaceSlug, projectId, player.id, { status }))
      );
      const failedIds = eligible.filter((_, index) => results[index].status === "rejected").map((player) => player.id);
      setSelectedPlayerIds(failedIds);
      await refetchRoster();
      setToast({
        type: failedIds.length ? TOAST_TYPE.ERROR : TOAST_TYPE.SUCCESS,
        title: failedIds.length ? "Some players could not be updated" : "Players updated",
        message: `${eligible.length - failedIds.length} player(s) set ${status}.${failedIds.length ? ` ${failedIds.length} could not be updated. Their selection is kept so you can retry.` : ""}`,
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  const openDeleteAccountModal = (target: TAccountDeletionTarget) => {
    if (isWorkspaceAdmin) setAccountDeletionTarget(target);
  };
  const closeDeleteAccountModal = () => setAccountDeletionTarget(null);
  const deleteAccount = async (confirmation: string) => {
    if (!isWorkspaceAdmin || !accountDeletionTarget || isSubmitting) return false;
    setIsSubmitting(true);
    try {
      await rosterService.deletePlayerAccount(workspaceSlug, projectId, accountDeletionTarget.id, confirmation);
      closeDeleteAccountModal();
      setSelectedPlayerIds([]);
      await refetchRoster();
      if (rosterTab === "events") await refetchEvents();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Account deleted",
        message: "The athlete account has been permanently deleted.",
      });
      return true;
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Could not delete account",
        message: getErrorMessage(error, "Please try again."),
      });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const deletePlayer = async () => {
    if (!canManage || !deletingPlayer || !canDeleteRosterPlayer(deletingPlayer) || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const declining = deletingPlayer.registration_status === "pending" && !deletingPlayer.user;
      if (declining) {
        await rosterService.declinePlayer(workspaceSlug, projectId, deletingPlayer.id);
      } else {
        await rosterService.deleteRosterPlayer(workspaceSlug, projectId, deletingPlayer.id);
        setAllPlayers((currentPlayers) => currentPlayers.filter((player) => player.id !== deletingPlayer.id));
      }
      setSelectedPlayerIds((currentSelectedPlayerIds) =>
        currentSelectedPlayerIds.filter((playerId) => playerId !== deletingPlayer.id)
      );
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success!",
        message: declining
          ? "Join request declined. The account and any existing roster entry are retained."
          : "Player removed from roster. Their account and historical cards are retained.",
      });
      closeDeletePlayerModal();
      await refetchRoster();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: getErrorMessage(error, "Player could not be removed. Please try again."),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteSelectedPlayers = async () => {
    if (!selectedPlayerIds.length) return;

    setIsSubmitting(true);
    try {
      const playerIdsToDelete = [...selectedPlayerIds];
      const deleteResults = await Promise.allSettled(
        playerIdsToDelete.map((playerId) => rosterService.deleteRosterPlayer(workspaceSlug, projectId, playerId))
      );
      const deletedPlayerIds = playerIdsToDelete.filter((_, index) => deleteResults[index].status === "fulfilled");
      const failedPlayerIds = playerIdsToDelete.filter((_, index) => deleteResults[index].status === "rejected");

      if (deletedPlayerIds.length) {
        setAllPlayers((currentPlayers) => currentPlayers.filter((player) => !deletedPlayerIds.includes(player.id)));
      }

      setSelectedPlayerIds(failedPlayerIds);
      closeBulkDeleteModal();

      if (!failedPlayerIds.length) {
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Success!",
          message: `${deletedPlayerIds.length} player${deletedPlayerIds.length === 1 ? "" : "s"} deleted successfully.`,
        });
      } else {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Partial delete",
          message: `${deletedPlayerIds.length} player${deletedPlayerIds.length === 1 ? "" : "s"} deleted. ${failedPlayerIds.length} failed to delete.`,
        });
      }

      await refetchRoster();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: getErrorMessage(error, "Selected players could not be deleted. Please try again."),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const importPlayers = async (
    playersToImport: TRosterImportRow[],
    importId: string,
    retry = false
  ): Promise<TRosterImportOutcome> => {
    const observed = beginRosterUI("import");
    setIsSubmitting(true);
    try {
      const response = await rosterService.importRoster(
        workspaceSlug,
        projectId,
        {
          players: playersToImport,
          import_id: importId,
        },
        observed.headers,
        observed.progress
      );
      if (response?.success !== true || !Array.isArray(response.data)) {
        observed.finish("unverified");
        return { kind: "unknown" };
      }
      setAllPlayers((currentPlayers) => [
        ...new Map([...currentPlayers, ...response.data].map((player) => [player.id, player])).values(),
      ]);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success!",
        message: response.message || "Roster imported successfully.",
      });
      closeImportRosterModal();
      void refetchRoster();
      observed.finish("confirmed");
      return { kind: "saved" };
    } catch (error) {
      observed.finish(rosterUIFailure(error));
      const response = isAxiosError(error) ? error.response : undefined;
      if (!response || response.status >= 500 || response.status === 408 || response.status === 429)
        return { kind: "unknown" };
      // Authorization or routing can reject a retry before it reaches the batch receipt.
      if (retry && response.status !== 400) return { kind: "unknown" };
      const row = response.data?.row_error;
      if (row && typeof row.index === "string" && /^\d+$/.test(row.index) && typeof row.message === "string")
        return { kind: "rejected", rowError: { index: Number(row.index), message: row.message } };
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: getErrorMessage(response.data, "Roster could not be imported. Please try again."),
      });
      return { kind: "rejected" };
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RosterContext.Provider
      value={{
        rosterTab,
        setRosterTab,
        canPreviewAccounts: isWorkspaceAdmin,
        events,
        isLoadingEvents,
        eventsError,
        refetchEvents,
        accountDeletionTarget,
        openDeleteAccountModal,
        closeDeleteAccountModal,
        deleteAccount,
        setPlayerStatus,
        setSelectedPlayerStatus,
        workspaceSlug,
        projectId,
        players,
        groupedRoster,
        allPlayers,
        statusOptions,
        positionOptions,
        classYearOptions,
        isLoading,
        isSubmitting,
        canManage,
        searchValue,
        selectedPosition,
        selectedStatus,
        selectedClassYear,
        activeView,
        displayProperties,
        groupBy,
        subGroupBy,
        orderBy,
        isAddPlayerModalOpen,
        isImportRosterModalOpen,
        pendingImportFile,
        editingPlayer,
        deletingPlayer,
        selectedPlayerIds,
        selectedPlayers,
        isBulkDeleteModalOpen,
        setSearchValue,
        setSelectedPosition,
        setSelectedStatus,
        setSelectedClassYear,
        setActiveView,
        toggleDisplayProperty,
        setGroupBy: updateGroupBy,
        setSubGroupBy: updateSubGroupBy,
        setOrderBy,
        openCreatePlayerModal,
        openEditPlayerModal,
        closePlayerModal,
        openImportRosterModal,
        closeImportRosterModal,
        setPendingImportFile,
        togglePlayerSelection,
        toggleAllPlayerSelections,
        clearSelectedPlayers,
        openDeletePlayerModal,
        closeDeletePlayerModal,
        openBulkDeleteModal,
        closeBulkDeleteModal,
        submitPlayer,
        deletePlayer,
        deleteSelectedPlayers,
        importPlayers,
        refetchRoster,
      }}
    >
      {children}
    </RosterContext.Provider>
  );
};

export const useRoster = () => {
  const context = useContext(RosterContext);
  if (!context) throw new Error("useRoster must be used within RosterProvider");
  return context;
};

export const getRosterFormState = (player?: IRosterPlayer | null): TRosterFormState =>
  player
    ? {
        player_name: player.player_name ?? "",
        email: player.email ?? "",
        jersey_number: player.jersey_number ?? "",
        position: player.position ?? "",
        height: player.height ?? "",
        weight: player.weight ?? "",
        class_year: player.class_year ?? "",
        status: player.status === "injured" ? "active" : (player.status ?? "active"),
        notes: player.notes ?? "",
      }
    : DEFAULT_FORM_STATE;
