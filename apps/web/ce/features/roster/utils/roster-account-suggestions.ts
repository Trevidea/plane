import type { IRosterPlayer, IWorkspaceMember } from "@plane/types";

const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export const findRosterAccountSuggestions = (
  members: IWorkspaceMember[],
  players: Pick<IRosterPlayer, "user">[],
  fullName: string,
  email: string
) => {
  const linkedIds = new Set(players.map((player) => player.user).filter(Boolean));
  const name = normalize(fullName);
  const address = normalize(email);
  return members.flatMap((membership) => {
    const user = membership.member;
    if (
      !user ||
      membership.is_active === false ||
      ("is_active" in user && user.is_active === false) ||
      user.is_bot ||
      linkedIds.has(user.id) ||
      !user.email?.trim()
    )
      return [];
    const emailMatches = Boolean(address && normalize(user.email) === address);
    const nameMatches = Boolean(name && normalize(`${user.first_name} ${user.last_name}`) === name);
    if (!emailMatches && !nameMatches) return [];
    return [{ user, reason: emailMatches ? ("email" as const) : ("name" as const) }];
  });
};

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
