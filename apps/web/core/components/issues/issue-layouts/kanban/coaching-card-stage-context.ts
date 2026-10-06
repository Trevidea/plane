import { createContext } from "react";
import type { TCoachingCardStageConfig } from "@plane/types";

export const CoachingCardStageContext = createContext<TCoachingCardStageConfig | undefined>(undefined);
