import React from "react";
import Image from "@/components/common/image-with-fallback";
// image
import SheetFileIcon from "@/public/attachment/excel-icon.png";
// type
import type { ImageIconPros } from "../types";

export const SheetIcon: React.FC<ImageIconPros> = ({ width, height }) => (
  <Image src={SheetFileIcon} height={height} width={width} alt="SheetFileIcon" />
);
