import { API_BASE_URL } from "@plane/constants";
import type { IRosterLifecycleEvent, IRosterPlayer, IRosterPlayerPayload } from "@plane/types";
import { APIService } from "@/services/api.service";

export type TRosterRegistration = {
  url: string;
  token: string;
  join_code: string;
  workspace_name: string;
  program_name: string;
  expires_at: string;
};

type TRosterImportPayload = {
  players: IRosterPlayerPayload[];
};

type TRosterImportResponse = {
  success: boolean;
  data: IRosterPlayer[];
  imported_count: number;
  message: string;
};

export class RosterService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getRegistration(slug: string, projectId: string): Promise<TRosterRegistration | null> {
    return this.get(`/api/workspaces/${slug}/projects/${projectId}/roster/registration/`).then(
      (response) => response.data
    );
  }

  async generateRegistration(slug: string, projectId: string): Promise<TRosterRegistration> {
    return this.post(`/api/workspaces/${slug}/projects/${projectId}/roster/registration/`, {}).then(
      (response) => response.data
    );
  }

  async closeRegistration(slug: string, projectId: string): Promise<void> {
    await this.delete(`/api/workspaces/${slug}/projects/${projectId}/roster/registration/`);
  }

  async approvePlayer(slug: string, projectId: string, playerId: string): Promise<IRosterPlayer> {
    return this.post(`/api/workspaces/${slug}/projects/${projectId}/roster/${playerId}/approve/`, {}).then(
      (response) => response.data
    );
  }

  async getRoster(workspaceSlug: string, projectId: string): Promise<IRosterPlayer[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getRosterPlayer(workspaceSlug: string, projectId: string, playerId: string): Promise<IRosterPlayer> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/${playerId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createRosterPlayer(
    workspaceSlug: string,
    projectId: string,
    payload: IRosterPlayerPayload
  ): Promise<IRosterPlayer> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/`, payload)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateRosterPlayer(
    workspaceSlug: string,
    projectId: string,
    playerId: string,
    payload: Partial<IRosterPlayerPayload>
  ): Promise<IRosterPlayer> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/${playerId}/`, payload)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteRosterPlayer(workspaceSlug: string, projectId: string, playerId: string): Promise<{ message: string }> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/${playerId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async declinePlayer(workspaceSlug: string, projectId: string, playerId: string): Promise<{ message: string }> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/${playerId}/decline/`, {})
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getRosterEvents(workspaceSlug: string, projectId: string): Promise<IRosterLifecycleEvent[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/events/`)
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deletePlayerAccount(workspaceSlug: string, projectId: string, playerId: string): Promise<void> {
    await this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/${playerId}/account/`).catch(
      (error) => {
        throw error?.response?.data;
      }
    );
  }

  async importRoster(
    workspaceSlug: string,
    projectId: string,
    payload: TRosterImportPayload
  ): Promise<TRosterImportResponse> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/import/`, payload)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
