"use client";

import { useParams } from "next/navigation";
import { MediaShareView } from "@/components/media-library/share-view";

const MediaSharePage = () => {
  const { token } = useParams();
  if (!token) return null;
  return <MediaShareView token={token.toString()} />;
};

export default MediaSharePage;
