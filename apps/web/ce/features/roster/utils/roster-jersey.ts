import type { IRosterPlayer } from "@plane/types";

export const findRosterJerseyConflict = (
  players: Pick<IRosterPlayer, "id" | "jersey_number" | "status" | "player_name">[],
  jersey: string,
  editingPlayerId?: string
) => {
  const number = jersey.trim();
  return number
    ? players.find(
        (player) =>
          player.id !== editingPlayerId &&
          ["active", "injured", "pending"].includes(player.status) &&
          player.jersey_number === number
      )
    : undefined;
};
