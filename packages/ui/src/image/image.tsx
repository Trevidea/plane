"use client";

import React, { forwardRef, useState } from "react";

// Inline SVG stays available even when a remote image or the asset server is unavailable.
export const DEFAULT_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><rect width="160" height="120" rx="8" fill="#f1f3f5"/><rect x="48" y="32" width="64" height="56" rx="6" fill="none" stroke="#868e96" stroke-width="4"/><circle cx="68" cy="49" r="6" fill="#868e96"/><path d="m50 80 20-20 13 13 12-16 15 23" fill="none" stroke="#868e96" stroke-width="4" stroke-linejoin="round"/></svg>'
)}`;

export const useImageFallback = (source?: string, sourceSet?: string) => {
  const sourceKey = JSON.stringify([source, sourceSet]);
  const [status, setStatus] = useState({ sourceKey, failed: false });
  if (status.sourceKey !== sourceKey) setStatus({ sourceKey, failed: false });
  const isFallback = !source?.trim() || (status.sourceKey === sourceKey && status.failed);
  return {
    isFallback,
    onError: () => {
      if (!isFallback) setStatus({ sourceKey, failed: true });
    },
  };
};

export const ImageWithFallback = forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(
  ({ src, srcSet, onError, ...props }, ref) => {
    const fallback = useImageFallback(src, srcSet);
    return (
      <img
        {...props}
        ref={ref}
        data-image-fallback={fallback.isFallback || undefined}
        src={fallback.isFallback ? DEFAULT_IMAGE : src}
        srcSet={fallback.isFallback ? undefined : srcSet}
        onError={(event) => {
          fallback.onError();
          onError?.(event);
        }}
      />
    );
  }
);
ImageWithFallback.displayName = "ImageWithFallback";
