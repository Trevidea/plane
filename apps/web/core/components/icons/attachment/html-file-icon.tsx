import React from "react";
import Image from "@/components/common/image-with-fallback";
// image
import HtmlFileIcon from "@/public/attachment/html-icon.png";
// type
import type { ImageIconPros } from "../types";

export const HtmlIcon: React.FC<ImageIconPros> = ({ width, height }) => (
  <Image src={HtmlFileIcon} height={height} width={width} alt="HtmlFileIcon" />
);
