import { API_BASE_URL } from "@plane/constants";
import type { CoachingCardDetailClip } from "@/components/issues/issue-detail/coaching-card-clips-model";
import { APIService } from "./api.service";

export type PlayerRole = { workspaces: string[]; projects: string[]; project_workspaces: string[] };
export type PlayerProgram = { id: string; name: string; workspace_slug: string; workspace_name: string };
export type PlayerProgress = { percent: number; note: string; completed_at: string | null };
export type PlayerActivity = {
  id: string;
  name: string;
  category: string | null;
  description: string;
  feedback: string;
  project: { id: string; name: string; workspace_slug: string };
  state: { id: string; name: string } | null;
  target_date: string | null;
  progress: PlayerProgress;
  clips: Array<
    Pick<
      CoachingCardDetailClip,
      | "key"
      | "title"
      | "sourceUrl"
      | "startSeconds"
      | "endSeconds"
      | "durationSeconds"
      | "playbackMode"
      | "sourceStartSeconds"
    >
  >;
};
export type PlayerComment = { id: string; text: string; author: string; is_own: boolean; created_at: string };
export const playerActivityPath = (activity: PlayerActivity) =>
  `/api/player/workspaces/${encodeURIComponent(activity.project.workspace_slug)}/projects/${activity.project.id}/activities/${activity.id}/`;

class PlayerActivityService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  async role(): Promise<PlayerRole> {
    return (await this.get("/api/player/role/")).data;
  }
  async programs(): Promise<PlayerProgram[]> {
    return (await this.get("/api/player/assignments/")).data;
  }
  async activities(projectId: string, offset = 0): Promise<{ results: PlayerActivity[]; total_count: number }> {
    return (await this.get("/api/player/activities/", { params: { project_id: projectId, limit: 50, offset } })).data;
  }
  async progress(
    activity: PlayerActivity,
    progress: Pick<PlayerProgress, "percent" | "note">
  ): Promise<PlayerProgress> {
    return (await this.patch(playerActivityPath(activity) + "progress/", progress)).data;
  }
  async comments(activity: PlayerActivity): Promise<PlayerComment[]> {
    return (await this.get(playerActivityPath(activity) + "comments/")).data;
  }
  async addComment(activity: PlayerActivity, text: string) {
    return (await this.post(playerActivityPath(activity) + "comments/", { text })).data;
  }
  async editComment(activity: PlayerActivity, id: string, text: string) {
    return (await this.patch(playerActivityPath(activity) + `comments/${id}/`, { text })).data;
  }
  async removeComment(activity: PlayerActivity, id: string) {
    await this.delete(playerActivityPath(activity) + `comments/${id}/`);
  }
  async reactions(activity: PlayerActivity, commentId?: string): Promise<string[]> {
    return (await this.get(playerActivityPath(activity) + (commentId ? `comments/${commentId}/` : "") + "reactions/"))
      .data;
  }
  async react(activity: PlayerActivity, reaction: string, remove = false, commentId?: string) {
    const path = playerActivityPath(activity) + (commentId ? `comments/${commentId}/` : "") + "reactions/";
    if (remove) await this.delete(path, { reaction });
    else await this.post(path, { reaction });
  }
}
export const playerActivityService = new PlayerActivityService();
