import { isAxiosError } from "axios";
import { API_BASE_URL } from "@plane/constants";
import type { IRosterPlayer } from "@plane/types";
import { APIService } from "@/services/api.service";
import { AuthService } from "@/services/auth.service";

export type AdminPage<T> = { next: string | null; previous: string | null; results: T[] };
export type AdminOption = { id: string; name: string };
export type TeamSeason = AdminOption & {
  project_id: string;
  season_label: string;
  sport: string;
  division: string;
  level: string;
  archived: boolean;
};
export type SeasonAssignment = AdminOption & { assignment: "coach" | "operator"; manage_roster: boolean };
export type DelegatedPlayer = {
  id: string;
  player_name: string;
  jersey_number: string | null;
  class_year: string | null;
  position: string | null;
  updated_at: string;
};
export type SchoolRosterRow = Pick<DelegatedPlayer, "id" | "player_name" | "jersey_number" | "class_year"> & {
  program: string;
  project_id: string;
  season_label: string;
  status: string;
  account_status: "pending" | "linked" | "unlinked" | "held";
};
export type RosterCorrectionTarget = Pick<
  IRosterPlayer,
  "id" | "user" | "player_name" | "account_email" | "status" | "class_year"
>;

function firstError(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      const message = firstError(child);
      if (message) return message;
    }
  }
}

export const teamSeasonError = (error: unknown) =>
  (isAxiosError(error) && firstError(typeof error.response?.data === "object" ? error.response.data : null)) ||
  "Request failed. Please try again.";

export class TeamSeasonService extends APIService {
  private auth = new AuthService();

  constructor() {
    super(API_BASE_URL);
  }

  private adminPath(slug: string, route: string) {
    return `/api/workspaces/${slug}/team-admin/${route}/`;
  }

  async readPage<T>(slug: string, route: string, page = 1, filters?: Record<string, string>): Promise<AdminPage<T>> {
    return (await this.get(this.adminPath(slug, route), { params: { page, ...filters } })).data;
  }

  private async write<T>(method: "post" | "put" | "patch" | "delete", url: string, data?: object): Promise<T> {
    const { csrf_token } = await this.auth.requestCSRFToken();
    if (!csrf_token) throw new Error("Missing security token.");
    return (await this.request({ method, url, data, headers: { "X-CSRFToken": csrf_token } })).data;
  }

  createTeam(slug: string, name: string) {
    return this.write<AdminOption>("post", this.adminPath(slug, "teams"), { name });
  }

  addSeason(slug: string, team: string, values: Record<string, string>) {
    return this.write<TeamSeason>("post", this.adminPath(slug, `teams/${team}/seasons`), values);
  }

  setStaff(slug: string, season: string, user: string, values: Pick<SeasonAssignment, "assignment" | "manage_roster">) {
    return this.write<SeasonAssignment>("put", this.adminPath(slug, `seasons/${season}/staff/${user}`), values);
  }

  clearStaff(slug: string, season: string, user: string) {
    return this.write<void>("delete", this.adminPath(slug, `seasons/${season}/staff/${user}`));
  }

  private rosterPath(slug: string, project: string) {
    return `/api/workspaces/${slug}/projects/${project}/roster/`;
  }

  async delegatedPlayers(slug: string, project: string, page: number): Promise<AdminPage<DelegatedPlayer>> {
    return (await this.get(`${this.rosterPath(slug, project)}delegated/`, { params: { page } })).data;
  }

  saveDelegatedPlayer(slug: string, project: string, values: object, player?: DelegatedPlayer) {
    const endpoint = `${this.rosterPath(slug, project)}delegated/`;
    return player
      ? this.write<DelegatedPlayer>("patch", `${endpoint}${player.id}/`, {
          ...values,
          expected_updated_at: player.updated_at,
        })
      : this.write<DelegatedPlayer>("post", endpoint, values);
  }

  correctAccount(slug: string, project: string, player: string, current: string, replacement: string | null) {
    return this.write<{ id: string; user: string | null; account_link_held: boolean }>(
      "post",
      `${this.rosterPath(slug, project)}${player}/account-correction/`,
      { expected_user_id: current, replacement_user_id: replacement }
    );
  }

  async getCorrectionTarget(slug: string, project: string, player: string): Promise<RosterCorrectionTarget> {
    return (await this.get(`${this.rosterPath(slug, project)}${player}/account-correction/`)).data;
  }
}
