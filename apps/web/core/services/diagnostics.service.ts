import { API_BASE_URL } from "@plane/constants";
import { parseDiagnosticsResponse } from "@/components/profile/diagnostics/model";
import { APIService } from "@/services/api.service";

export class DiagnosticsService extends APIService {
  async operation<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const config = { timeout: 12000, signal };
    const response =
      body === undefined ? await this.get(url, {}, config) : await this.post(url, body as object, config);
    return response.data as T;
  }
  constructor() {
    super(API_BASE_URL);
  }

  async overview(workspaceSlug: string) {
    const response = await this.get(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/diagnostics/`,
      {},
      { timeout: 20000 }
    );
    return parseDiagnosticsResponse(response.data);
  }
}
