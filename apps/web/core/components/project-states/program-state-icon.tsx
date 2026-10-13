import { BadgeCheck, LockKeyhole } from "lucide-react";
import { EIconSize } from "@plane/constants";
import { StateGroupIcon } from "@plane/propel/icons";
import type { IState } from "@plane/types";

type Props = {
  state: Pick<IState, "group" | "color" | "lifecycle_role">;
  size?: EIconSize;
  percentage?: number;
};

export const ProgramStateIcon = ({ state, size = EIconSize.LG, percentage }: Props) => {
  const pixels = { [EIconSize.XS]: 10, [EIconSize.SM]: 12, [EIconSize.MD]: 14, [EIconSize.LG]: 16, [EIconSize.XL]: 18 }[
    size
  ];
  if (state.lifecycle_role === "verified")
    return <BadgeCheck size={pixels} className="shrink-0 text-green-500" aria-label="Verified" />;
  if (state.lifecycle_role === "closed")
    return <LockKeyhole size={pixels} className="shrink-0 text-custom-text-300" aria-label="Closed" />;
  return <StateGroupIcon stateGroup={state.group} color={state.color} size={size} percentage={percentage} />;
};
