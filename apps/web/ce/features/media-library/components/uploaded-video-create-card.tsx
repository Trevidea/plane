import { useMemo, useState } from "react";
import useSWR from "swr";
import { v4 as uuidv4 } from "uuid";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CreateCardModal } from "@/components/issues/issue-detail/sg-event-detail-page/create-card-modal";
import type { CardFormValues } from "@/components/issues/issue-detail/sg-event-detail-page/create-card-model";
import { useProject } from "@/hooks/store/use-project";
import { IssueService } from "@/services/issue/issue.service";
import { RosterService } from "@/services/roster.service";
import type { TMediaItem } from "../types/media-library.types";
import { buildUploadedVideoCardPlaylist } from "../utils/uploaded-video-card";

type Props = {
  item: TMediaItem;
  workspaceSlug: string;
  projectId: string;
  durationSeconds: number | null;
  onClose: () => void;
};

export const UploadedVideoCreateCard = ({ item, workspaceSlug, projectId, durationSeconds, onClose }: Props) => {
  const [requestId] = useState(() => uuidv4());
  const issueService = useMemo(() => new IssueService(), []);
  const rosterService = useMemo(() => new RosterService(), []);
  const { getProjectById } = useProject();
  const project = getProjectById(projectId);
  const {
    data: players,
    error,
    isLoading,
    mutate,
  } = useSWR(`PROJECT_ROSTER_${workspaceSlug}_${projectId}`, () => rosterService.getRoster(workspaceSlug, projectId), {
    revalidateOnFocus: false,
  });
  const playlists = useMemo(() => [buildUploadedVideoCardPlaylist(item, durationSeconds)], [item, durationSeconds]);
  const metaText = (key: string) => (typeof item.meta?.[key] === "string" ? String(item.meta[key]).trim() : "");
  const sport = metaText("sport") || project?.sport?.trim();
  const handleSubmit = async (values: CardFormValues) => {
    if (!item.packageId) throw new Error("The uploaded video is unavailable.");
    const response = await issueService.createCoachingCards(workspaceSlug, projectId, {
      request_id: requestId,
      source_media: { package_id: item.packageId, artifact_id: item.id },
      player_ids: values.playerIds,
      title: values.title,
      feedback: values.feedback,
      card_type: values.cardType,
      priority: values.priority,
      sport_label: values.context.sport ?? "",
      context: values.context,
    });
    const count = response.cards.length;
    setToast({
      type: TOAST_TYPE.SUCCESS,
      title: count === 1 ? "Coaching card created" : "Coaching cards created",
      message: `${count} card${count === 1 ? "" : "s"} added to the New column on the coaching board.`,
    });
  };
  return (
    <CreateCardModal
      playlists={playlists}
      rows={[]}
      rosterPlayers={players ?? []}
      isRosterLoading={isLoading}
      hasRosterError={Boolean(error)}
      onRetryRoster={() => void mutate().catch(() => undefined)}
      initialContext={{
        sport: sport || null,
        level: metaText("level") || null,
        program: metaText("program") || null,
        season: metaText("season") || metaText("year") || null,
      }}
      onSubmit={handleSubmit}
      onClose={onClose}
    />
  );
};
