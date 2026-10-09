import { useEffect, useRef } from "react";
import { useParams, usePathname } from "next/navigation";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { cardIdFromUrl, cardPeekUrl } from "./model";

// Route selection is an adapter to Plane's existing MobX peek store.
export const useCoachingPeekUrl = (enabled: boolean) => {
  const params = useParams();
  const pathname = usePathname();
  const workspaceSlug = params.workspaceSlug?.toString();
  const projectId = params.projectId?.toString();
  const {
    peekIssue,
    setPeekIssue,
    issue: { getIssueById },
  } = useIssueDetail();
  const lastSelection = useRef<string | null>(null);
  const skipFirstSync = useRef(true);
  const selectedIssue = peekIssue ? getIssueById(peekIssue.issueId) : undefined;
  const selectedId = peekIssue?.issueId;
  const isCoaching = selectedIssue?.category === "Coaching Card";

  useEffect(() => {
    if (!enabled || !workspaceSlug || !projectId) return;
    skipFirstSync.current = true;
    const restore = () => {
      const cardId = cardIdFromUrl(window.location.href);
      lastSelection.current = cardId;
      if (cardId) setPeekIssue({ workspaceSlug, projectId, issueId: cardId });
      else setPeekIssue(undefined);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [enabled, workspaceSlug, projectId, pathname, setPeekIssue]);

  useEffect(() => {
    if (!enabled || !workspaceSlug || !projectId) return;
    if (skipFirstSync.current) {
      skipFirstSync.current = false;
      return;
    }
    // Wait for the normal detail fetch to identify a newly opened issue.
    if (selectedId && !selectedIssue) return;
    const cardId = isCoaching ? (selectedId ?? null) : null;
    if (cardId === lastSelection.current) return;
    const previous = lastSelection.current;
    lastSelection.current = cardId;
    const href = cardPeekUrl(window.location.href, cardId);
    if (cardId) {
      const state = {
        ...window.history.state,
        kanavioCardPeek: true,
        kanavioBoardUrl:
          previous && window.history.state?.kanavioCardPeek
            ? window.history.state.kanavioBoardUrl
            : cardPeekUrl(window.location.href, null),
      };
      if (previous && window.history.state?.kanavioCardPeek) window.history.replaceState(state, "", href);
      else window.history.pushState(state, "", href);
    } else if (previous) {
      // Back is safe only while the surrounding board URL is unchanged.
      // Preserve filters changed behind the peek by removing selection in place.
      if (!selectedId && window.history.state?.kanavioCardPeek && window.history.state.kanavioBoardUrl === href)
        window.history.back();
      else window.history.replaceState(window.history.state, "", href);
    }
  }, [enabled, workspaceSlug, projectId, selectedId, selectedIssue, isCoaching]);
};
