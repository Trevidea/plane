import { cn } from "@plane/utils";
import Image from "@/components/common/image-with-fallback";
import { buildCustomPlaylistThumbnailUrl } from "../../utils";

type Props = {
  className?: string;
  thumbnail?: string | null;
};

export const PlaylistClipThumbnail = ({ className, thumbnail }: Props) => {
  const source = buildCustomPlaylistThumbnailUrl(thumbnail);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-[var(--sg-matrix-grid-border)] bg-[var(--sg-matrix-panel)]",
        className
      )}
    >
      <Image src={source} alt="" fill sizes="64px" className="object-cover" draggable={false} unoptimized />
    </span>
  );
};
