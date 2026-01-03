import type { AxiosRequestConfig } from "axios";
// plane imports
import { API_BASE_URL } from "@plane/constants";
import { generateFileUploadPayload, getFileMetaDataForUpload } from "@plane/services";
import type {
  TMediaAsset,
  TMediaAssetDetail,
  TMediaCollection,
  TMediaShare,
  TMediaTag,
  TMediaUploadPayload,
  TMediaUploadResponse,
} from "@plane/types";
// services
import { APIService } from "@/services/api.service";
import { FileUploadService } from "@/services/file-upload.service";

export type TMediaAssetListResponse = {
  results: TMediaAsset[];
  next_cursor?: string;
  prev_cursor?: string;
  next_page_results?: boolean;
};

export class MediaService extends APIService {
  private fileUploadService: FileUploadService;

  constructor() {
    super(API_BASE_URL);
    this.fileUploadService = new FileUploadService();
  }

  async requestMediaUploads(
    workspaceSlug: string,
    projectId: string,
    payloads: TMediaUploadPayload[]
  ): Promise<TMediaUploadResponse[]> {
    return this.post(`/api/media/workspaces/${workspaceSlug}/projects/${projectId}/assets/`, {
      files: payloads,
    })
      .then((response) => response?.data?.assets ?? [])
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async completeMediaUploads(workspaceSlug: string, projectId: string, assetIds: string[]): Promise<void> {
    return this.post(`/api/media/workspaces/${workspaceSlug}/projects/${projectId}/assets/complete/`, {
      asset_ids: assetIds,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async uploadToSignedUrl(
    signedResponse: TMediaUploadResponse,
    file: File,
    uploadProgressHandler?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<void> {
    const payload = generateFileUploadPayload(
      {
        asset_id: signedResponse.asset_id,
        asset_url: "",
        upload_data: signedResponse.upload_data,
      },
      file
    );
    await this.fileUploadService.uploadFile(signedResponse.upload_data.url, payload, uploadProgressHandler);
  }

  async listMediaAssets(
    workspaceSlug: string,
    projectId: string,
    params?: Record<string, string | number | undefined>
  ): Promise<TMediaAssetListResponse> {
    return this.get(`/api/media/workspaces/${workspaceSlug}/projects/${projectId}/assets/`, {
      params,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getMediaAsset(
    workspaceSlug: string,
    projectId: string,
    assetId: string
  ): Promise<TMediaAssetDetail> {
    return this.get(`/api/media/workspaces/${workspaceSlug}/projects/${projectId}/assets/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateMediaAsset(
    workspaceSlug: string,
    projectId: string,
    assetId: string,
    data: Partial<TMediaAssetDetail> & { tags?: string[]; collection_ids?: string[] }
  ): Promise<TMediaAssetDetail> {
    return this.patch(`/api/media/workspaces/${workspaceSlug}/projects/${projectId}/assets/${assetId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteMediaAsset(workspaceSlug: string, projectId: string, assetId: string): Promise<void> {
    return this.delete(`/api/media/workspaces/${workspaceSlug}/projects/${projectId}/assets/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listCollections(workspaceSlug: string, projectId: string): Promise<TMediaCollection[]> {
    return this.get(`/api/media/workspaces/${workspaceSlug}/projects/${projectId}/collections/`)
      .then((response) => response?.data ?? [])
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createCollection(
    workspaceSlug: string,
    projectId: string,
    data: { name: string; description?: string; parent_id?: string | null }
  ): Promise<TMediaCollection> {
    return this.post(`/api/media/workspaces/${workspaceSlug}/projects/${projectId}/collections/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateCollection(
    workspaceSlug: string,
    projectId: string,
    collectionId: string,
    data: { name?: string; description?: string; parent_id?: string | null }
  ): Promise<TMediaCollection> {
    return this.patch(`/api/media/workspaces/${workspaceSlug}/projects/${projectId}/collections/${collectionId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteCollection(workspaceSlug: string, projectId: string, collectionId: string): Promise<void> {
    return this.delete(`/api/media/workspaces/${workspaceSlug}/projects/${projectId}/collections/${collectionId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listTags(workspaceSlug: string, projectId: string): Promise<TMediaTag[]> {
    return this.get(`/api/media/workspaces/${workspaceSlug}/projects/${projectId}/tags/`)
      .then((response) => response?.data ?? [])
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createShare(
    workspaceSlug: string,
    projectId: string,
    assetId: string,
    expires_at?: string
  ): Promise<{ share: TMediaShare; share_url: string }> {
    return this.post(`/api/media/workspaces/${workspaceSlug}/projects/${projectId}/assets/${assetId}/share/`, {
      expires_at,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async revokeShare(
    workspaceSlug: string,
    projectId: string,
    assetId: string,
    shareId: string
  ): Promise<void> {
    return this.delete(
      `/api/media/workspaces/${workspaceSlug}/projects/${projectId}/assets/${assetId}/share/${shareId}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getShare(token: string): Promise<{ share: TMediaShare; asset: TMediaAssetDetail }> {
    return this.get(`/api/media/shares/${token}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getFileMetaData(file: File): Promise<TMediaUploadPayload> {
    const meta = await getFileMetaDataForUpload(file);
    return {
      ...meta,
    };
  }
}
