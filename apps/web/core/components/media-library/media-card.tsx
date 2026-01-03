"use client";

import type { FC } from "react";
import Link from "next/link";
// plane types
import type { TMediaAsset } from "@plane/types";
// components
import { getFileIcon } from "@/components/icons";

type TMediaCardProps = {
  asset: TMediaAsset;
  href: string;
};

const getExtension = (fileName: string): string => {
  const parts = fileName.split(".");
  if (parts.length <= 1) return "";
  return parts[parts.length - 1].toLowerCase();
};

export const MediaCard: FC<TMediaCardProps> = ({ asset, href }) => {
  const extension = getExtension(asset.file_name);
  const fallbackIcon = getFileIcon(extension, 34);

  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-xl border border-custom-border-200 bg-custom-background-100 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-[4/3] w-full bg-custom-background-90">
        {asset.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnail_url}
            alt={asset.title || asset.file_name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-custom-text-400">{fallbackIcon}</div>
        )}
        {asset.status !== "READY" && (
          <div className="absolute inset-0 flex items-center justify-center bg-custom-background-100/80 text-xs font-semibold uppercase tracking-wide text-custom-text-300">
            {asset.status === "FAILED" ? "Processing failed" : "Processing"}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 border-t border-custom-border-200 px-3 py-2">
        <span className="truncate text-sm font-medium text-custom-text-100">{asset.title || asset.file_name}</span>
        <span className="text-xs text-custom-text-400">{asset.media_kind.toLowerCase()}</span>
      </div>
    </Link>
  );
};
