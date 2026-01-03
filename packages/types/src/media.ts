export type TMediaAssetStatus = "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
export type TMediaKind = "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" | "ARCHIVE" | "OTHER";
export type TMediaRenditionKind = "THUMBNAIL" | "PREVIEW" | "HLS" | "DERIVATIVE";

export type TMediaTag = {
  id: string;
  name: string;
  slug: string;
  asset_count?: number;
  created_at: string;
  updated_at: string;
};

export type TMediaCollection = {
  id: string;
  name: string;
  slug: string;
  description: string;
  parent: string | null;
  asset_count?: number;
  created_at: string;
  updated_at: string;
};

export type TMediaRendition = {
  id: string;
  kind: TMediaRenditionKind;
  format: string;
  path: string;
  url?: string | null;
  mime_type: string;
  size: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  bitrate?: number | null;
  is_primary: boolean;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
};

export type TMediaAsset = {
  id: string;
  title: string;
  description: string;
  file_name: string;
  mime_type: string;
  size: number;
  status: TMediaAssetStatus;
  media_kind: TMediaKind;
  is_uploaded: boolean;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  created_at: string;
  thumbnail_url?: string | null;
};

export type TMediaAssetDetail = TMediaAsset & {
  tags: TMediaTag[];
  collections: TMediaCollection[];
  renditions: TMediaRendition[];
  download_url?: string | null;
  preview_url?: string | null;
};

export type TMediaShare = {
  id: string;
  token: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
};

export type TMediaUploadPayload = {
  name: string;
  size: number;
  type: string;
  title?: string;
  description?: string;
  tags?: string[];
  collection_ids?: string[];
};

export type TMediaUploadResponse = {
  asset_id: string;
  upload_data?: {
    url: string;
    fields: Record<string, string>;
  };
  asset: TMediaAsset;
};
