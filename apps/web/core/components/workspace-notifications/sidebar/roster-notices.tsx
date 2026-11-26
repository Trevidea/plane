"use client";

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
import { Bell, Check, ChevronDown } from "lucide-react";
import { useUser } from "@/hooks/store/user";
import { RosterService } from "@/services/roster.service";

const roster = new RosterService();
const pageSize = 10;

export const RosterNotices = observer(({ workspace }: { workspace: string }) => {
  const { data: user } = useUser();
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(
    user?.id ? ["roster-notices", workspace, user.id, offset] : null,
    () => roster.staffNotices(workspace, offset)
  );

  const mark = async (id: string) => {
    setSaving(id);
    setReadError(false);
    try {
      await roster.markStaffNoticeRead(workspace, id);
      await mutate();
    } catch {
      setReadError(true);
    } finally {
      setSaving(null);
    }
  };

  return (
    <details className="group shrink-0 border-b border-custom-border-200">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-custom-text-100 hover:bg-custom-background-90">
        <Bell className="size-4" aria-hidden /> Roster updates
        {!!data?.unread_count && <span className="text-xs text-custom-primary-100">{data.unread_count} unread</span>}
        <ChevronDown className="ml-auto size-4 shrink-0 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="max-h-72 overflow-y-auto px-3 pb-2 text-sm">
        {isLoading && (
          <p role="status" className="py-2">
            Loading roster updates...
          </p>
        )}
        {error && (
          <button type="button" className="py-2 underline" onClick={() => void mutate()}>
            Could not load roster updates. Retry
          </button>
        )}
        {readError && (
          <p role="alert" className="py-2 text-red-500">
            Could not mark the notice read. Try again.
          </p>
        )}
        {data?.results.length === 0 && !error && <p className="py-2 text-custom-text-300">No roster updates.</p>}
        <ul>
          {data?.results.map((notice) => (
            <li
              key={notice.id}
              className="flex items-center justify-between gap-2 border-t border-custom-border-200 py-2"
            >
              <div className="min-w-0 break-words">
                <Link
                  href={`/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(notice.program_id)}/roster/?view=join-requests`}
                  className="font-medium hover:underline"
                >
                  Join request: {notice.program_name}
                </Link>
                <p className="text-xs text-custom-text-300">
                  <time dateTime={notice.created_at}>{new Date(notice.created_at).toLocaleString()}</time>
                  {notice.read_at ? " · Read" : " · Unread"}
                </p>
              </div>
              {!notice.read_at && (
                <button
                  type="button"
                  title="Mark as read"
                  aria-label={`Mark ${notice.program_name} notice as read`}
                  disabled={saving !== null}
                  onClick={() => void mark(notice.id)}
                  className="grid size-9 shrink-0 place-items-center rounded hover:bg-custom-background-90 disabled:opacity-50"
                >
                  <Check className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {(offset > 0 || (data && offset + pageSize < data.total_count)) && (
          <div className="flex justify-between pt-2 text-xs">
            <button
              type="button"
              className="underline disabled:opacity-50"
              disabled={offset === 0 || saving !== null}
              onClick={() => setOffset(offset - pageSize)}
            >
              Previous
            </button>
            <button
              type="button"
              className="underline disabled:opacity-50"
              disabled={!data || offset + pageSize >= data.total_count || saving !== null}
              onClick={() => setOffset(offset + pageSize)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </details>
  );
});
