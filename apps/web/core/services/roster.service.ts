import { API_BASE_URL } from "@plane/constants";
import { beginRosterUI, rosterUIFailure } from "@plane/logger/diagnostics-browser";
import type {
  IRosterImportPayload,
  IRosterImportResponse,
  IRosterLifecycleEvent,
  IRosterPlayer,
  IRosterPlayerPayload,
} from "@plane/types";
import { APIService } from "@/services/api.service";
import { AuthService } from "@/services/auth.service";

const authService = new AuthService();

export type TRosterRegistration = {
  url: string;
  token: string;
  short_code?: string;
  version?: string;
  workspace_name: string;
  program_name: string;
  expires_at: string;
};

export type RosterAccountDeletionPreview = {
  enabled: boolean;
  confirmation: string | null;
  impact: {
    workspace_memberships: number;
    program_memberships: number;
    roster_entries: number;
    personal_cards: number;
    shared_cards: number;
    profile_images: number;
    legacy_profile_image: boolean;
    private_messages: number;
    private_attachments: number;
    activity_progress: number;
    join_records: number;
    roster_notices?: number;
  };
};

type TRosterAccountMatches = {
  results: { id: string; email: string }[];
  has_more: boolean;
};

export type TRosterImportMatchQuery = { player_name: string; graduation_year: string };
export type TRosterImportMatches = {
  results: { id: string; email: string; previous_program: string | null }[];
  has_more: boolean;
};

export type StaffRosterNoticePage = {
  total_count: number;
  unread_count: number;
  results: { id: string; program_id: string; program_name: string; created_at: string; read_at: string | null }[];
};

export class RosterService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private async observed<T>(
    action: Parameters<typeof beginRosterUI>[0],
    run: (headers: Record<string, string>) => Promise<T>,
    uiHeaders?: Record<string, string>
  ) {
    if (uiHeaders) return run(uiHeaders);
    const operation = beginRosterUI(action);
    try {
      const result = await run(operation.headers);
      operation.finish("confirmed");
      return result;
    } catch (error) {
      operation.finish(rosterUIFailure(error));
      throw error;
    }
  }

  async staffNotices(slug: string, offset: number): Promise<StaffRosterNoticePage> {
    const response = await this.get(
      `/api/workspaces/${encodeURIComponent(slug)}/roster-notices/?limit=10&offset=${offset}`
    );
    return response.data;
  }

  async markStaffNoticeRead(slug: string, id: string): Promise<void> {
    await this.observed("notice-read", async (headers) => {
      const { csrf_token } = await authService.requestCSRFToken();
      if (!csrf_token) throw new Error("Missing security token.");
      await this.post(
        `/api/workspaces/${encodeURIComponent(slug)}/roster-notices/${encodeURIComponent(id)}/read/`,
        {},
        { headers: { ...headers, "X-CSRFToken": csrf_token } }
      );
    });
  }

  async getRegistration(slug: string, projectId: string): Promise<TRosterRegistration | null> {
    return this.get(`/api/workspaces/${slug}/projects/${projectId}/roster/registration/`).then(
      (response) => response.data
    );
  }

  async generateRegistration(slug: string, projectId: string, expected?: string): Promise<TRosterRegistration> {
    return this.observed("share-open", (headers) =>
      this.post(
        `/api/workspaces/${slug}/projects/${projectId}/roster/registration/`,
        {},
        {
          headers: { ...headers, ...(expected ? { "If-Match": `"${expected}"` } : {}) },
        }
      ).then((response) => response.data)
    );
  }

  async closeRegistration(slug: string, projectId: string, expected?: string): Promise<void> {
    await this.observed("share-close", (headers) =>
      this.delete(`/api/workspaces/${slug}/projects/${projectId}/roster/registration/`, undefined, {
        headers: { ...headers, ...(expected ? { "If-Match": `"${expected}"` } : {}) },
      })
    );
  }

  async approvePlayer(
    slug: string,
    projectId: string,
    playerId: string,
    uiHeaders?: Record<string, string>
  ): Promise<IRosterPlayer> {
    return this.observed(
      "approve",
      (headers) =>
        this.post(`/api/workspaces/${slug}/projects/${projectId}/roster/${playerId}/approve/`, {}, { headers }).then(
          (response) => response.data
        ),
      uiHeaders
    );
  }

  async resendPlayerInvitation(
    slug: string,
    projectId: string,
    playerId: string,
    uiHeaders?: Record<string, string>
  ): Promise<IRosterPlayer> {
    return this.observed(
      "invitation-retry",
      (headers) =>
        this.post(
          `/api/workspaces/${slug}/projects/${projectId}/roster/${playerId}/resend-invitation/`,
          {},
          { headers }
        ).then((response) => response.data),
      uiHeaders
    );
  }

  async issuePlayerResetCode(
    slug: string,
    projectId: string,
    playerId: string,
    userId: string,
    uiHeaders?: Record<string, string>
  ) {
    return this.observed(
      "reset-issue",
      async (headers) => {
        const { csrf_token } = await authService.requestCSRFToken();
        if (!csrf_token) throw new Error("Missing security token.");
        const response = await this.post(
          `/api/workspaces/${slug}/projects/${projectId}/roster/${playerId}/password-reset/`,
          {
            expected_user_id: userId,
          },
          { headers: { ...headers, "X-CSRFToken": csrf_token } }
        );
        const { code, expires_at } = response.data ?? {};
        if (
          typeof code !== "string" ||
          !/^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){3}$/.test(code) ||
          typeof expires_at !== "string" ||
          !Number.isFinite(Date.parse(expires_at))
        ) {
          throw new Error("Invalid reset response.");
        }
        return { code, expiresAt: expires_at };
      },
      uiHeaders
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

  async findReturningAccounts(
    workspaceSlug: string,
    projectId: string,
    playerName: string,
    graduationYear: string
  ): Promise<TRosterAccountMatches> {
    return this.observed("match", (headers) =>
      this.post(
        `/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/account-matches/`,
        {
          player_name: playerName,
          graduation_year: graduationYear,
        },
        { headers }
      ).then((response) => response.data)
    );
  }

  async findImportReturningAccounts(
    workspaceSlug: string,
    projectId: string,
    rows: TRosterImportMatchQuery[]
  ): Promise<{ rows: TRosterImportMatches[] }> {
    return this.observed("match", (headers) =>
      this.post(
        `/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/import-matches/`,
        { rows },
        { headers }
      ).then((response) => response.data)
    );
  }

  async createRosterPlayer(
    workspaceSlug: string,
    projectId: string,
    payload: IRosterPlayerPayload & { existing_account_id?: string },
    uiHeaders?: Record<string, string>
  ): Promise<IRosterPlayer> {
    return this.observed(
      "save",
      (headers) =>
        this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/`, payload, { headers }).then(
          (response) => response?.data
        ),
      uiHeaders
    ).catch((error) => {
      throw uiHeaders ? error : error?.response?.data;
    });
  }

  async updateRosterPlayer(
    workspaceSlug: string,
    projectId: string,
    playerId: string,
    payload: Partial<IRosterPlayerPayload>,
    uiHeaders?: Record<string, string>
  ): Promise<IRosterPlayer> {
    return this.observed(
      payload.status ? "status" : "save",
      (headers) =>
        this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/${playerId}/`, payload, {
          headers,
        }).then((response) => response?.data),
      uiHeaders
    ).catch((error) => {
      throw uiHeaders ? error : error?.response?.data;
    });
  }

  async deleteRosterPlayer(workspaceSlug: string, projectId: string, playerId: string): Promise<{ message: string }> {
    return this.observed("status", (headers) =>
      this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/${playerId}/`, undefined, {
        headers,
      }).then((response) => response?.data)
    ).catch((error) => {
      throw error?.response?.data;
    });
  }

  async declinePlayer(workspaceSlug: string, projectId: string, playerId: string): Promise<{ message: string }> {
    return this.observed("decline", (headers) =>
      this.post(
        `/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/${playerId}/decline/`,
        {},
        { headers }
      ).then((response) => response.data)
    ).catch((error) => {
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

  async isAccountDeletionEnabled(workspaceSlug: string, projectId: string): Promise<boolean> {
    const response = await this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/account-deletion/`);
    return response.data?.enabled === true;
  }

  async previewPlayerAccountDeletion(
    workspaceSlug: string,
    projectId: string,
    playerId: string
  ): Promise<RosterAccountDeletionPreview> {
    return (await this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/${playerId}/account/`)).data;
  }

  async deletePlayerAccount(
    workspaceSlug: string,
    projectId: string,
    playerId: string,
    confirmation: string
  ): Promise<void> {
    const { csrf_token } = await authService.requestCSRFToken();
    if (!csrf_token) throw new Error("Missing security token.");
    await this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/${playerId}/account/`,
      { confirmation },
      { headers: { "X-CSRFToken": csrf_token } }
    ).catch((error) => {
      throw error?.response?.data;
    });
  }

  async importRoster(
    workspaceSlug: string,
    projectId: string,
    payload: IRosterImportPayload,
    uiHeaders?: Record<string, string>,
    progress?: (loaded: number) => void
  ): Promise<IRosterImportResponse> {
    return this.observed(
      "import",
      (headers) =>
        this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/roster/import/`, payload, {
          headers,
          ...(progress ? { onUploadProgress: ({ loaded }) => progress(loaded) } : {}),
        }).then((response) => response.data),
      uiHeaders
    );
  }
}
