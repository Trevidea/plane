"use client";

import type { FC } from "react";
import { observer } from "mobx-react";
import Link from "next/link";

// hooks
import { ModuleIcon } from "@plane/propel/icons";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent } from "./";
// icons

type TIssueModuleActivity = { activityId: string; ends: "top" | "bottom" | undefined };

export const IssueModuleActivity: FC<TIssueModuleActivity> = observer((props) => {
  const { activityId, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<ModuleIcon className="h-4 w-4 flex-shrink-0 text-custom-text-200" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        {activity.verb === "created" ? (
          <>
            <span>added this work item to the module </span>
            <Link
              prefetch={false}
              href={`/${activity.workspace_detail?.slug}/projects/${activity.project}/modules/${activity.new_identifier}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 truncate font-medium text-custom-text-100 hover:underline"
            >
              <span className="truncate">{activity.new_value}</span>
            </Link>
          </>
        ) : activity.verb === "updated" ? (
          <>
            <span>set the module to </span>
            <Link
              prefetch={false}
              href={`/${activity.workspace_detail?.slug}/projects/${activity.project}/modules/${activity.new_identifier}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 truncate font-medium text-custom-text-100 hover:underline"
            >
              <span className="truncate"> {activity.new_value}</span>
            </Link>
          </>
        ) : (
          <>
            <span>removed the work item from the module </span>
            <Link
              prefetch={false}
              href={`/${activity.workspace_detail?.slug}/projects/${activity.project}/modules/${activity.old_identifier}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 truncate font-medium text-custom-text-100 hover:underline"
            >
              <span className="truncate"> {activity.old_value}</span>
            </Link>
          </>
        )}
      </>
    </IssueActivityBlockComponent>
  );
});
