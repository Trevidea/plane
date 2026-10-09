import { observer } from "mobx-react";
import { Video } from "lucide-react";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { IssueActivityBlockComponent } from "./helpers/activity-block";

export const CoachingClipActivity = observer(
  ({ activityId, ends }: { activityId: string; ends: "top" | "bottom" | undefined }) => {
    const {
      activity: { getActivityById },
    } = useIssueDetail();
    const activity = getActivityById(activityId);
    if (!activity) return null;
    return (
      <IssueActivityBlockComponent
        activityId={activityId}
        ends={ends}
        icon={<Video size={14} className="text-custom-text-200" aria-hidden="true" />}
      >
        <span>
          {activity.verb === "created" ? "added" : activity.verb === "deleted" ? "removed" : "updated"} a coaching clip
          {activity.new_value && (
            <>
              {" "}
              · <span className="font-medium text-custom-text-100">{activity.new_value}</span>
            </>
          )}
          .
        </span>
      </IssueActivityBlockComponent>
    );
  }
);
