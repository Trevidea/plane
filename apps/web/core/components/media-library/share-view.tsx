"use client";

import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
// plane imports
import type { TMediaAssetDetail } from "@plane/types";
import { convertBytesToSize } from "@plane/utils";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { getFileIcon } from "@/components/icons";
// services
import { MediaService } from "@/services/media.service";

type TShareViewProps = {
  token: string;
};

export const MediaShareView: FC<TShareViewProps> = ({ token }) => {
  const mediaService = useMemo(() => new MediaService(), []);
  const searchParams = useSearchParams();
  const [asset, setAsset] = useState<TMediaAssetDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchShare = async () => {
      setIsLoading(true);
      try {
        const workspaceParam = searchParams.get("workspace") || searchParams.get("slug");
        const projectParam = searchParams.get("project_id");
        const params =
          workspaceParam && projectParam ? { workspace: workspaceParam, project_id: projectParam } : undefined;
        const data = await mediaService.getShare(token, params);
        setAsset(data.asset);
      } finally {
        setIsLoading(false);
      }
    };
    fetchShare();
  }, [mediaService, searchParams, token]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LogoSpinner />
      </div>
    );
  }

  if (!asset) {
    return <div className="flex h-full items-center justify-center text-custom-text-300">Share link not found.</div>;
  }

  const fileExtension = asset.file_name.split(".").pop() || "";
  const fallbackIcon = getFileIcon(fileExtension, 40);

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-custom-text-100">{asset.title || asset.file_name}</h1>
        <p className="text-sm text-custom-text-400">
          {asset.mime_type} - {convertBytesToSize(asset.size)}
        </p>
      </div>
      <div className="rounded-2xl border border-custom-border-200 bg-custom-background-90 p-4">
        {asset.media_kind === "VIDEO" && asset.preview_url ? (
          <video
            controls
            src={asset.preview_url}
            poster={asset.thumbnail_url || undefined}
            className="w-full rounded-xl"
          />
        ) : asset.media_kind === "AUDIO" && asset.preview_url ? (
          <audio controls src={asset.preview_url} className="w-full" />
        ) : asset.media_kind === "IMAGE" && asset.preview_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.preview_url} alt={asset.title} className="w-full rounded-xl object-contain" />
        ) : asset.media_kind === "DOCUMENT" && asset.mime_type === "application/pdf" && asset.preview_url ? (
          <iframe src={asset.preview_url} title="Document preview" className="h-[70vh] w-full rounded-xl" />
        ) : (
          <div className="flex h-64 items-center justify-center text-custom-text-400">{fallbackIcon}</div>
        )}
      </div>
      {asset.download_url && (
        <a
          href={asset.download_url}
          className="inline-flex w-fit items-center rounded-lg border border-custom-border-200 px-4 py-2 text-sm font-semibold text-custom-text-200 hover:border-custom-primary-200 hover:text-custom-primary-100"
        >
          Download original
        </a>
      )}
    </div>
  );
};
