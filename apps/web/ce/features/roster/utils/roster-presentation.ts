import type { IRosterPlayer } from "@plane/types";

export const isPendingPlayer = (player: Pick<IRosterPlayer, "status" | "registration_status">) =>
  player.status === "pending" || player.registration_status === "pending";

export const summarizeRoster = (players: IRosterPlayer[]) => {
  const current = players.filter((player) => player.status !== "removed");
  const active = current.filter((player) => ["active", "injured"].includes(player.status));
  const linked = active.filter((player) => Boolean(player.user) && !isPendingPlayer(player)).length;
  return {
    active: active.length,
    inactive: current.filter((player) => player.status === "inactive").length,
    linked,
    unmatched: active.filter((player) => !player.user && !isPendingPlayer(player)).length,
    requests: current.filter(isPendingPlayer).length,
  };
};

const CSV_FIELDS = [
  "player_name",
  "email",
  "jersey_number",
  "position",
  "height",
  "weight",
  "class_year",
  "status",
  "notes",
] as const;

const spreadsheetCell = (value: string | null | undefined) => {
  const text = value ?? "";
  // Prevent a coach's exported names/notes from executing spreadsheet formulas.
  return /^\s*[=+@\-\t\r]/.test(text) ? `'${text}` : text;
};

export const rosterToSpreadsheetRows = (players: IRosterPlayer[]): string[][] => [
  [...CSV_FIELDS],
  ...players
    .filter((player) => player.status !== "removed" && player.status !== "pending")
    .map((player) =>
      CSV_FIELDS.map((field) =>
        spreadsheetCell(field === "status" && player.status === "injured" ? "active" : player[field])
      )
    ),
];

export const rosterToCSV = (players: IRosterPlayer[]) =>
  rosterToSpreadsheetRows(players)
    .map((row, index) => (index === 0 ? row.join(",") : row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")))
    .join("\r\n");
