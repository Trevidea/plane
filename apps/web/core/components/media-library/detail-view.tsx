"use client";

import type { FC } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
// plane imports
import type { TMediaAssetDetail, TMediaCollection } from "@plane/types";
import { convertBytesToSize } from "@plane/utils";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { getFileIcon } from "@/components/icons";
// services
import { MediaService } from "@/services/media.service";

export const MediaDetailView: FC = () => {
  const { workspaceSlug, projectId, assetId } = useParams();
  const mediaService = useMemo(() => new MediaService(), []);

  const [asset, setAsset] = useState<TMediaAssetDetail | null>(null);
  const [collections, setCollections] = useState<TMediaCollection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");

  const fetchAsset = useCallback(async () => {
    if (!workspaceSlug || !projectId || !assetId) return;
    setIsLoading(true);
    try {
      const data = await mediaService.getMediaAsset(
        workspaceSlug.toString(),
        projectId.toString(),
        assetId.toString()
      );
      setAsset(data);
    } finally {
      setIsLoading(false);
    }
  }, [mediaService, workspaceSlug, projectId, assetId]);

  const fetchCollections = useCallback(async () => {
    if (!workspaceSlug || !projectId) return;
    const data = await mediaService.listCollections(workspaceSlug.toString(), projectId.toString());
    setCollections(data);
  }, [mediaService, workspaceSlug, projectId]);

  useEffect(() => {
    fetchAsset();
    fetchCollections();
  }, [fetchAsset, fetchCollections]);

  const updateAsset = async (payload: { tags?: string[]; collection_ids?: string[] }) => {
    if (!workspaceSlug || !projectId || !assetId) return;
    const updated = await mediaService.updateMediaAsset(
      workspaceSlug.toString(),
      projectId.toString(),
      assetId.toString(),
      payload
    );
    setAsset(updated);
  };

  const handleAddTag = async () => {
    if (!tagInput.trim() || !asset) return;
    const newTags = Array.from(new Set([...(asset.tags?.map((tag) => tag.name) || []), tagInput.trim()]));
    setTagInput("");
    await updateAsset({ tags: newTags });
  };

  const handleRemoveTag = async (tagName: string) => {
    if (!asset) return;
    const newTags = asset.tags?.map((tag) => tag.name).filter((name) => name !== tagName) || [];
    await updateAsset({ tags: newTags });
  };

  const handleToggleCollection = async (collectionId: string) => {
    if (!asset) return;
    const currentIds = asset.collections?.map((collection) => collection.id) || [];
    const nextIds = currentIds.includes(collectionId)
      ? currentIds.filter((id) => id !== collectionId)
      : [...currentIds, collectionId];
    await updateAsset({ collection_ids: nextIds });
  };

  const handleCreateShare = async () => {
    if (!workspaceSlug || !projectId || !assetId) return;
    const response = await mediaService.createShare(
      workspaceSlug.toString(),
      projectId.toString(),
      assetId.toString()
    );
    setShareUrl(response.share_url);
  };

  const handleCopyShare = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
  };

  if (isLoading || !asset) {
    return (
      <div className="flex h-full items-center justify-center">
        <LogoSpinner />
      </div>
    );
  }

  const fileExtension = asset.file_name.split(".").pop() || "";
  const fallbackIcon = getFileIcon(fileExtension, 48);

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="flex-1 overflow-y-auto border-b border-custom-border-200 bg-custom-background-100 p-6 md:border-b-0 md:border-r">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-custom-text-100">{asset.title || asset.file_name}</h1>
          <p className="text-sm text-custom-text-400">{asset.file_name}</p>
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
      </div>
      <div className="w-full border-t border-custom-border-200 bg-custom-background-90 p-6 md:w-[360px] md:border-l md:border-t-0">
        <div className="space-y-4">
          <div className="rounded-xl border border-custom-border-200 bg-custom-background-100 p-4">
            <div className="text-xs font-semibold uppercase text-custom-text-400">File details</div>
            <div className="mt-3 space-y-2 text-sm text-custom-text-200">
              <div className="flex justify-between">
                <span>Type</span>
                <span className="text-custom-text-100">{asset.mime_type}</span>
              </div>
              <div className="flex justify-between">
                <span>Size</span>
                <span className="text-custom-text-100">{convertBytesToSize(asset.size)}</span>
              </div>
              <div className="flex justify-between">
                <span>Status</span>
                <span className="text-custom-text-100">{asset.status.toLowerCase()}</span>
              </div>
              {asset.width && asset.height && (
                <div className="flex justify-between">
                  <span>Dimensions</span>
                  <span className="text-custom-text-100">
                    {asset.width} x {asset.height}
                  </span>
                </div>
              )}
              {asset.duration && (
                <div className="flex justify-between">
                  <span>Duration</span>
                  <span className="text-custom-text-100">{Math.round(asset.duration)}s</span>
                </div>
              )}
              {asset.download_url && (
                <a
                  href={asset.download_url}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-custom-border-200 px-3 py-2 text-xs font-semibold text-custom-text-200 hover:border-custom-primary-200 hover:text-custom-primary-100"
                >
                  Download original
                </a>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-custom-border-200 bg-custom-background-100 p-4">
            <div className="text-xs font-semibold uppercase text-custom-text-400">Tags</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {asset.tags?.map((tag) => (
                <button
                  key={tag.id}
                  className="rounded-full border border-custom-border-200 px-2 py-0.5 text-[11px] text-custom-text-200"
                  onClick={() => handleRemoveTag(tag.name)}
                >
                  {tag.name} x
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                placeholder="Add tag"
                className="flex-1 rounded-md border border-custom-border-200 bg-custom-background-90 px-2 py-1 text-xs text-custom-text-100"
              />
              <button
                onClick={handleAddTag}
                className="rounded-md border border-custom-border-200 px-3 py-1 text-xs text-custom-text-200"
              >
                Add
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-custom-border-200 bg-custom-background-100 p-4">
            <div className="text-xs font-semibold uppercase text-custom-text-400">Collections</div>
            <div className="mt-3 space-y-2">
              {collections.map((collection) => {
                const isSelected = asset.collections?.some((item) => item.id === collection.id);
                return (
                  <label key={collection.id} className="flex items-center gap-2 text-xs text-custom-text-200">
                    <input
                      type="checkbox"
                      checked={!!isSelected}
                      onChange={() => handleToggleCollection(collection.id)}
                    />
                    <span>{collection.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-custom-border-200 bg-custom-background-100 p-4">
            <div className="text-xs font-semibold uppercase text-custom-text-400">Share</div>
            <div className="mt-3 space-y-2">
              <button
                onClick={handleCreateShare}
                className="w-full rounded-lg border border-custom-border-200 px-3 py-2 text-xs font-semibold text-custom-text-200 hover:border-custom-primary-200 hover:text-custom-primary-100"
              >
                Generate share link
              </button>
              {shareUrl && (
                <div className="rounded-lg border border-custom-border-200 bg-custom-background-90 px-3 py-2 text-xs text-custom-text-200">
                  <div className="break-all">{shareUrl}</div>
                  <button
                    className="mt-2 text-[11px] font-semibold text-custom-primary-100"
                    onClick={handleCopyShare}
                  >
                    Copy link
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
