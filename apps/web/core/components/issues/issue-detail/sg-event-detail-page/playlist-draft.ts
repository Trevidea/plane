import type { SgTagRow } from "./types";

export type PlaylistDraft = {
  name: string;
  rowIds: string[];
};

export const PLAYLIST_TAG_DRAG_TYPE = "application/x-plane-event-tag-ids";

export const writePlaylistTagDragData = (
  dataTransfer: Pick<DataTransfer, "effectAllowed" | "setData">,
  rowIds: readonly string[]
) => {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(PLAYLIST_TAG_DRAG_TYPE, JSON.stringify([...new Set(rowIds)]));
};

export const readPlaylistTagDragData = (dataTransfer: Pick<DataTransfer, "getData">): string[] => {
  try {
    const value: unknown = JSON.parse(dataTransfer.getData(PLAYLIST_TAG_DRAG_TYPE));
    if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && id.length > 0)) return [];
    return [...new Set(value as string[])];
  } catch {
    return [];
  }
};

export const getPlaylistDraftRows = (availableRows: readonly SgTagRow[], rowIds: readonly string[]): SgTagRow[] => {
  const rowsById = new Map(availableRows.map((row) => [row.id, row]));
  const rows: SgTagRow[] = [];
  for (const id of new Set(rowIds)) {
    const row = rowsById.get(id);
    if (row && (row.playlistTimestamp?.trim() || row.playlistFallbackTimestamp?.trim())) rows.push(row);
  }
  return rows;
};

export const getDraggedPlaylistTagIds = (
  rowId: string,
  visibleRows: readonly SgTagRow[],
  selectedIds: readonly string[]
): string[] => {
  if (!selectedIds.includes(rowId)) return [rowId];
  const selected = new Set(selectedIds);
  return visibleRows.filter((row) => selected.has(row.id)).map((row) => row.id);
};
