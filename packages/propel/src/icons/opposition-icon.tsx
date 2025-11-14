import * as React from "react";
import { ISvgIcons } from "./type";

export const OppositionIcon: React.FC<ISvgIcons> = ({
  width = "16",
  height = "16",
  className,
  color = "currentColor",
}) => {
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={width}
    height={height}
    viewBox="0 0 16 16"
    fill={color}
    className={className}
  >
    <path d="M18 21a8 8 0 0 0-16 0" />
    <circle cx="10" cy="8" r="5" />
    <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" fill={color} />
  </svg>;
};
