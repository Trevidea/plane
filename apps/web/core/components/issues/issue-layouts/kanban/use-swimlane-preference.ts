"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@/hooks/store/user";
import { SWIMLANE_VIEWS } from "./coaching-swimlane-model";
import type { SwimlaneView } from "./coaching-swimlane-model";

const VIEW_CHANGE_EVENT = "kanban-swimlane-view-change";

const validView = (value: unknown): value is SwimlaneView =>
  typeof value === "string" && SWIMLANE_VIEWS.some((option) => option.value === value);

export const useSwimlanePreference = (
  workspaceSlug: string | undefined,
  boardId: string | undefined,
  defaultView: SwimlaneView = "stage"
) => {
  const { data: user } = useUser();
  const preferenceKey = useMemo(
    () => `kanban-swimlane:${workspaceSlug || ""}:${boardId || ""}:${user?.id || ""}`,
    [workspaceSlug, boardId, user?.id]
  );
  const [view, setView] = useState<SwimlaneView>(defaultView);

  useEffect(() => {
    if (!boardId || !user?.id) return;
    const readPreference = () => {
      try {
        const saved = window.localStorage.getItem(preferenceKey);
        setView(validView(saved) ? saved : defaultView);
      } catch {
        setView(defaultView);
      }
    };
    readPreference();
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; view: SwimlaneView }>).detail;
      if (detail?.key === preferenceKey) setView(detail.view);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === preferenceKey) readPreference();
    };
    window.addEventListener(VIEW_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(VIEW_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [boardId, defaultView, preferenceKey, user?.id]);

  const selectView = useCallback(
    (next: SwimlaneView) => {
      if (!boardId || !user?.id) return;
      setView(next);
      try {
        window.localStorage.setItem(preferenceKey, next);
      } catch {
        // View selection still works in memory when storage is unavailable.
      }
      window.dispatchEvent(new CustomEvent(VIEW_CHANGE_EVENT, { detail: { key: preferenceKey, view: next } }));
    },
    [boardId, preferenceKey, user?.id]
  );

  return { view, selectView, preferenceKey };
};
