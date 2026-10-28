"use client";

import type { FC } from "react";
import { useState } from "react";

import { observer } from "mobx-react";
import { Pencil } from "lucide-react";
import { EIconSize, STATE_GROUPS } from "@plane/constants";
import { StateGroupIcon } from "@plane/propel/icons";
import type { IState, TStateGroups, TStateOperationsCallbacks } from "@plane/types";
import { Button } from "@plane/ui";
import { getProgramLifecycleStates } from "@/helpers/program-states";
import { StateCreate } from "./create-update/create";
import { StateItem } from "./state-item";

type TLifecycleStateList = {
  groupedStates: Record<string, IState[]>;
  stateOperationsCallbacks: TStateOperationsCallbacks;
  isEditable: boolean;
  shouldTrackEvents: boolean;
};

// Keep existing state records and card references. Show bound lifecycle roles as
// flat rows; older boards fall back to one representative per lifecycle group.
export const LifecycleStateList: FC<TLifecycleStateList> = observer((props) => {
  const { groupedStates, stateOperationsCallbacks, isEditable, shouldTrackEvents } = props;
  const [creatingGroup, setCreatingGroup] = useState<TStateGroups | null>(null);
  const representatives = getProgramLifecycleStates(Object.values(groupedStates).flat());

  if (representatives.some((state) => state.lifecycle_role))
    return (
      <div className="space-y-3">
        {representatives.map((state) => (
          <StateItem
            key={state.id}
            groupKey={state.group}
            groupedStates={groupedStates}
            totalStates={1}
            state={state}
            disabled={!isEditable}
            stateOperationsCallbacks={stateOperationsCallbacks}
            shouldTrackEvents={shouldTrackEvents}
          />
        ))}
      </div>
    );

  return (
    <div className="space-y-3">
      {(Object.keys(STATE_GROUPS) as TStateGroups[]).map((groupKey) => {
        const state = representatives.find((item) => item.group === groupKey);

        if (state)
          return (
            <StateItem
              key={groupKey}
              groupKey={groupKey}
              groupedStates={groupedStates}
              totalStates={1}
              state={state}
              disabled={!isEditable}
              stateOperationsCallbacks={stateOperationsCallbacks}
              shouldTrackEvents={shouldTrackEvents}
            />
          );

        if (creatingGroup === groupKey && isEditable)
          return (
            <StateCreate
              key={groupKey}
              groupKey={groupKey}
              createStateCallback={stateOperationsCallbacks.createState}
              handleClose={() => setCreatingGroup(null)}
              shouldTrackEvents={shouldTrackEvents}
            />
          );

        return (
          <div
            key={groupKey}
            className="flex items-center justify-between rounded border border-custom-border-100 bg-custom-background-100 px-3.5 py-3"
          >
            <div className="flex items-center gap-3 px-1">
              <StateGroupIcon stateGroup={groupKey} size={EIconSize.XL} />
              <span className="text-sm font-medium">{STATE_GROUPS[groupKey].label}</span>
            </div>
            {isEditable && (
              <Button
                unstyled
                type="button"
                aria-label={`Set up ${STATE_GROUPS[groupKey].label} state`}
                onClick={() => setCreatingGroup(groupKey)}
                className="flex size-5 items-center justify-center rounded text-custom-text-200 hover:bg-custom-background-80 hover:text-custom-text-100"
              >
                <Pencil className="size-3" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
});
