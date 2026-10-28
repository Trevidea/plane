import { useState } from "react";
import { cn } from "@plane/utils";
import Image from "@/components/common/image-with-fallback";
import { buildCustomPlaylistThumbnailUrl } from "../../utils";

type Props = {
  className?: string;
  thumbnail?: string | null;
  fallbackThumbnail?: string | null;
};

export const PlaylistClipThumbnail = ({ className, thumbnail, fallbackThumbnail }: Props) => {
  const primarySource = buildCustomPlaylistThumbnailUrl(thumbnail);
  const fallbackSource = buildCustomPlaylistThumbnailUrl(fallbackThumbnail);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = primarySource && primarySource !== failedSource ? primarySource : fallbackSource;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex select-none shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-[var(--sg-matrix-grid-border)] bg-[var(--sg-matrix-panel)]",
        className
      )}
    >
      <Image
        key={source}
        src={source}
        onError={() => setFailedSource(primarySource)}
        alt=""
        fill
        sizes="64px"
        className="object-cover"
        draggable={false}
        unoptimized
      />
    </span>
  );
};
