"use client";

import { forwardRef } from "react";
import NextImage from "next/image";
import type { ImageProps } from "next/image";
import { DEFAULT_IMAGE, useImageFallback } from "@plane/ui";

const Image = forwardRef<HTMLImageElement, ImageProps>(({ src, onError, unoptimized, ...props }, ref) => {
  const staticImage = typeof src !== "string" && src ? ("default" in src ? src.default : src) : undefined;
  const source = typeof src === "string" ? src : staticImage?.src;
  const fallback = useImageFallback(source);
  const fallbackSource = staticImage ? { ...staticImage, src: DEFAULT_IMAGE } : DEFAULT_IMAGE;
  return (
    <NextImage
      {...props}
      ref={ref}
      data-image-fallback={fallback.isFallback || undefined}
      src={fallback.isFallback ? fallbackSource : src}
      placeholder={fallback.isFallback ? "empty" : props.placeholder}
      unoptimized={fallback.isFallback || unoptimized}
      onError={(event) => {
        fallback.onError();
        onError?.(event);
      }}
    />
  );
});
Image.displayName = "ImageWithFallback";
export default Image;
