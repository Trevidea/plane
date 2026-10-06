import { createContext } from "react";
import type { TIssue } from "@plane/types";

export type CardStageRequest = { stageId: string; reason?: string };
export type RequestCardStageChange = (issue: TIssue, stageId: string) => Promise<CardStageRequest | null>;

export const CoachingCardStageRequestContext = createContext<RequestCardStageChange | undefined>(undefined);
