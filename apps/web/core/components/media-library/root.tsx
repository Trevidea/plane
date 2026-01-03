"use client";

import type { ChangeEvent, FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TMediaAsset, TMediaCollection, TMediaTag } from "@plane/types";
import { convertBytesToSize } from "@plane/utils";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { MediaCard } from "@/components/media-library/media-card";
// services
import { MediaService } from "@/services/media.service";

type TUploadItem = {
  assetId: string;
  name: string;
  size: number;
  progress: number;
  status: "uploading" | "processing" | "failed";
};

export const MediaLibraryRoot: FC = () => {
  const { workspaceSlug, projectId } = useParams();
  const { t } = useTranslation();
  const mediaService = useMemo(() => new MediaService(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [assets, setAssets] = useState<TMediaAsset[]>([]);
  const [collections, setCollections] = useState<TMediaCollection[]>([]);
  const [tags, setTags] = useState<TMediaTag[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<TUploadItem[]>([]);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);

  const fetchCollections = useCallback(async () => {
    if (!workspaceSlug || !projectId) return;
    const data = await mediaService.listCollections(workspaceSlug.toString(), projectId.toString());
    setCollections(data);
  }, [mediaService, workspaceSlug, projectId]);

  const fetchTags = useCallback(async () => {
    if (!workspaceSlug || !projectId) return;
    const data = await mediaService.listTags(workspaceSlug.toString(), projectId.toString());
    setTags(data);
  }, [mediaService, workspaceSlug, projectId]);

  const fetchAssets = useCallback(
    async (cursor?: string | null, append = false) => {
      if (!workspaceSlug || !projectId) return;
      const params: Record<string, string | number | undefined> = {
        search: search || undefined,
        collection_id: selectedCollection || undefined,
        tag_ids: selectedTags.length > 0 ? selectedTags.join(",") : undefined,
        cursor: cursor || undefined,
        per_page: 24,
      };

      if (!append) setIsLoading(true);
      if (append) setIsLoadingMore(true);

      try {
        const response = await mediaService.listMediaAssets(workspaceSlug.toString(), projectId.toString(), params);
        setAssets((prev) => (append ? [...prev, ...(response?.results || [])] : response?.results || []));
        setNextCursor(response?.next_page_results ? response?.next_cursor || null : null);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [mediaService, workspaceSlug, projectId, search, selectedCollection, selectedTags]
  );

  useEffect(() => {
    fetchCollections();
    fetchTags();
  }, [fetchCollections, fetchTags]);

  useEffect(() => {
    fetchAssets(null, false);
  }, [fetchAssets]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (!files.length || !workspaceSlug || !projectId) return;
    event.target.value = "";

    const payloads = await Promise.all(
      files.map(async (file) => {
        const meta = await mediaService.getFileMetaData(file);
        const selectedTagNames = tags.filter((tag) => selectedTags.includes(tag.id)).map((tag) => tag.name);
        return {
          ...meta,
          collection_ids: selectedCollection ? [selectedCollection] : [],
          tags: selectedTagNames,
        };
      })
    );

    const uploadResponses = await mediaService.requestMediaUploads(
      workspaceSlug.toString(),
      projectId.toString(),
      payloads
    );

    const uploads: TUploadItem[] = uploadResponses.map((item, index) => ({
      assetId: item.asset_id,
      name: files[index]?.name || item.asset.file_name,
      size: files[index]?.size || 0,
      progress: 0,
      status: "uploading",
    }));

    setUploadQueue((prev) => [...uploads, ...prev]);

    const uploadTasks = uploadResponses.map((signedResponse, index) =>
      mediaService.uploadToSignedUrl(signedResponse, files[index], (progressEvent) => {
        const percent = progressEvent.total
          ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
          : 0;
        setUploadQueue((prev) =>
          prev.map((item) =>
            item.assetId === signedResponse.asset_id ? { ...item, progress: percent } : item
          )
        );
      })
    );

    try {
      await Promise.all(uploadTasks);
      await mediaService.completeMediaUploads(
        workspaceSlug.toString(),
        projectId.toString(),
        uploadResponses.map((item) => item.asset_id)
      );
      setUploadQueue((prev) =>
        prev.map((item) =>
          uploadResponses.find((resp) => resp.asset_id === item.assetId)
            ? { ...item, status: "processing", progress: 100 }
            : item
        )
      );
      fetchAssets(null, false);
    } catch (_error) {
      setUploadQueue((prev) => prev.map((item) => ({ ...item, status: "failed" })));
    }
  };

  const toggleTagFilter = (tagId: string) => {
    setSelectedTags((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim() || !workspaceSlug || !projectId) return;
    setIsCreatingCollection(true);
    try {
      const collection = await mediaService.createCollection(workspaceSlug.toString(), projectId.toString(), {
        name: newCollectionName.trim(),
      });
      setCollections((prev) => [collection, ...prev]);
      setNewCollectionName("");
    } finally {
      setIsCreatingCollection(false);
    }
  };

  return (
    <div className="flex h-full w-full">
      <aside className="hidden h-full w-72 flex-col border-r border-custom-border-200 bg-custom-background-90 p-4 md:flex">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-custom-text-100">Collections</h3>
          <button
            className="rounded-md border border-custom-border-200 px-2 py-1 text-xs text-custom-text-200"
            onClick={handleCreateCollection}
            disabled={isCreatingCollection || !newCollectionName.trim()}
          >
            Add
          </button>
        </div>
        <input
          value={newCollectionName}
          onChange={(event) => setNewCollectionName(event.target.value)}
          placeholder="New collection"
          className="mt-2 rounded-md border border-custom-border-200 bg-custom-background-100 px-2 py-1 text-xs text-custom-text-100"
        />
        <div className="mt-4 space-y-1">
          <button
            className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-xs ${
              selectedCollection === null ? "bg-custom-primary-100/10 text-custom-primary-100" : "text-custom-text-200"
            }`}
            onClick={() => setSelectedCollection(null)}
          >
            <span>All media</span>
          </button>
          {collections.map((collection) => (
            <button
              key={collection.id}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-xs ${
                selectedCollection === collection.id
                  ? "bg-custom-primary-100/10 text-custom-primary-100"
                  : "text-custom-text-200"
              }`}
              onClick={() => setSelectedCollection(collection.id)}
            >
              <span className="truncate">{collection.name}</span>
              <span className="text-[10px] text-custom-text-400">{collection.asset_count ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-custom-text-100">Tags</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag.id}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${
                  selectedTags.includes(tag.id)
                    ? "border-custom-primary-200 bg-custom-primary-100/10 text-custom-primary-100"
                    : "border-custom-border-200 text-custom-text-300"
                }`}
                onClick={() => toggleTagFilter(tag.id)}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="flex h-full flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-custom-border-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-custom-text-100">{t("sidebar.media_library")}</h2>
            <p className="text-xs text-custom-text-400">Upload, organize, and share project media.</p>
          </div>
          <div className="flex flex-1 items-center justify-end gap-3">
            <div className="flex w-full max-w-md items-center gap-2 rounded-full border border-custom-border-200 bg-custom-background-100 px-3 py-1.5">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search media..."
                className="w-full bg-transparent text-sm text-custom-text-100 outline-none"
              />
            </div>
            <button
              className="rounded-full border border-custom-border-200 bg-custom-background-100 px-4 py-2 text-sm font-medium text-custom-text-100 hover:border-custom-primary-200 hover:text-custom-primary-100"
              onClick={handleUploadClick}
            >
              Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFilesSelected}
            />
          </div>
        </div>

        {uploadQueue.length > 0 && (
          <div className="border-b border-custom-border-200 bg-custom-background-90 px-6 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-custom-text-300">
              Upload queue
              <span className="text-custom-text-400">{uploadQueue.length}</span>
            </div>
            <div className="mt-2 space-y-2">
              {uploadQueue.map((item) => (
                <div
                  key={item.assetId}
                  className="flex items-center gap-3 rounded-lg border border-custom-border-200 bg-custom-background-100 px-3 py-2"
                >
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs text-custom-text-200">
                      <span className="truncate">{item.name}</span>
                      <span className="text-custom-text-400">{convertBytesToSize(item.size || 0)}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-custom-background-80">
                      <div
                        className="h-1.5 rounded-full bg-custom-primary-100 transition-all"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-[10px] uppercase text-custom-text-400">
                    {item.status === "uploading" ? "Uploading" : item.status === "processing" ? "Processing" : "Failed"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <LogoSpinner />
            </div>
          ) : assets.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-custom-text-400">
              <div className="text-base font-medium text-custom-text-200">No media yet</div>
              <div className="text-sm">Upload videos, PDFs, and visuals to build your library.</div>
            </div>
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {assets.map((asset) => (
                  <MediaCard
                    key={asset.id}
                    asset={asset}
                    href={`/${workspaceSlug}/projects/${projectId}/media/${asset.id}`}
                  />
                ))}
              </div>
              {nextCursor && (
                <div className="mt-6 flex justify-center">
                  <button
                    className="rounded-full border border-custom-border-200 px-4 py-2 text-sm text-custom-text-200"
                    onClick={() => fetchAssets(nextCursor, true)}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? "Loading..." : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
};
