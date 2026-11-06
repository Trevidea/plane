"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { API_BASE_URL } from "@plane/constants";
import { Button } from "@plane/ui";
import { useUser } from "@/hooks/store/user";
import { playerActivityPath, playerActivityService as service } from "@/services/player-activity.service";
import type { PlayerActivity, PlayerComment } from "@/services/player-activity.service";

const ClipPlayer = dynamic(
  () =>
    import("@/components/issues/issue-detail/coaching-card-clip-player").then(
      (module) => module.CoachingCardClipPlayer
    ),
  { ssr: false }
);
const reactions = ["👍", "💪", "✅"];
const errorText = "Unable to save your changes. Please try again.";

function ReactionButtons({ activity, commentId }: { activity: PlayerActivity; commentId?: string }) {
  const { data: user } = useUser();
  const { data = [], mutate } = useSWR([user?.id, playerActivityPath(activity), "reactions", commentId], () =>
    service.reactions(activity, commentId)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="flex items-center gap-2">
      {reactions.map((reaction) => (
        <button
          key={reaction}
          type="button"
          aria-label={`React ${reaction}`}
          aria-pressed={data.includes(reaction)}
          disabled={busy}
          className={`rounded border px-2 py-1 ${data.includes(reaction) ? "border-custom-primary-100" : "border-custom-border-200"}`}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await service.react(activity, reaction, data.includes(reaction), commentId);
              await mutate();
            } catch {
              setError(errorText);
            } finally {
              setBusy(false);
            }
          }}
        >
          {reaction}
        </button>
      ))}
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

function Comment({
  activity,
  comment,
  refresh,
}: {
  activity: PlayerActivity;
  comment: PlayerComment;
  refresh: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (remove = false) => {
    setBusy(true);
    setError("");
    try {
      if (remove) await service.removeComment(activity, comment.id);
      else await service.editComment(activity, comment.id, text);
      setEditing(false);
      await refresh();
    } catch {
      setError(errorText);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="space-y-2 rounded border border-custom-border-200 p-3">
      <p className="text-xs text-custom-text-300">{comment.is_own ? "You" : comment.author}</p>
      {editing ? (
        <textarea
          aria-label="Edit your comment"
          maxLength={10000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded border p-2 bg-custom-background-100"
        />
      ) : (
        <p className="whitespace-pre-wrap">{comment.text}</p>
      )}
      {comment.is_own && (
        <div className="flex gap-3 text-xs">
          {editing ? (
            <>
              <button disabled={busy || !text.trim()} onClick={() => void save()}>
                Save
              </button>
              <button disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setText(comment.text);
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
          <button disabled={busy} onClick={() => void save(true)}>
            Delete
          </button>
        </div>
      )}
      <ReactionButtons activity={activity} commentId={comment.id} />
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
    </li>
  );
}

function Activity({ activity, refresh }: { activity: PlayerActivity; refresh: () => Promise<unknown> }) {
  const { data: user } = useUser();
  const [percent, setPercent] = useState(activity.progress.percent);
  const [note, setNote] = useState(activity.progress.note);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const comments = useSWR([user?.id, playerActivityPath(activity), "comments"], () => service.comments(activity));
  const save = async (completed: boolean) => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await service.progress(activity, { percent: completed ? 100 : percent, note });
      if (completed) setPercent(100);
      await refresh();
      setSaved(true);
    } catch {
      setError(errorText);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="space-y-4 rounded-xl border border-custom-border-200 bg-custom-background-100 p-5">
      <div>
        <p className="text-xs text-custom-text-300">
          {activity.category || "Activity"} · {activity.state?.name}
        </p>
        <h2 className="text-lg font-semibold">{activity.name}</h2>
      </div>
      {activity.description && <p className="whitespace-pre-wrap">{activity.description}</p>}
      {activity.feedback && (
        <p className="whitespace-pre-wrap rounded bg-custom-background-90 p-3">{activity.feedback}</p>
      )}
      {activity.clips
        .filter((clip) => clip.sourceUrl)
        .map((clip, index) => (
          <div key={`${clip.key}:${index}`} className="max-w-3xl">
            <p className="mb-2 text-sm font-medium">{clip.title}</p>
            <ClipPlayer
              clip={{ ...clip, slot: index, playlistName: "", thumbnail: null, addedAt: "" }}
              src={clip.sourceUrl.startsWith("/api/player/") ? `${API_BASE_URL}${clip.sourceUrl}` : clip.sourceUrl}
              autoPlay={false}
              showPrecisionControls={false}
            />
          </div>
        ))}
      <div className="space-y-2">
        <label className="block text-sm" htmlFor={`progress-${activity.id}`}>
          Your progress: {percent}%
        </label>
        <input
          id={`progress-${activity.id}`}
          type="range"
          min="0"
          max="100"
          value={percent}
          disabled={busy}
          onChange={(e) => setPercent(Number(e.target.value))}
          className="w-full"
        />
        <textarea
          aria-label="Your progress notes"
          maxLength={5000}
          placeholder="Your progress notes"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded border border-custom-border-200 bg-custom-background-100 p-2"
        />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void save(false)}>
            Save progress
          </Button>
          <Button disabled={busy} onClick={() => void save(true)}>
            Complete my activity
          </Button>
        </div>
        {saved && (
          <p role="status" className="text-sm text-custom-text-300">
            Your progress is saved.
          </p>
        )}
        <p className="text-xs text-custom-text-300">
          Completion records your progress. It does not change anyone else’s activity status.
        </p>
      </div>
      <ReactionButtons activity={activity} />
      <div className="space-y-3">
        <h3 className="font-medium">Comments and shared feedback</h3>
        {comments.error && <p role="alert">Unable to load comments.</p>}
        <ul className="space-y-2">
          {comments.data?.map((comment) => (
            <Comment key={comment.id} activity={activity} comment={comment} refresh={() => comments.mutate()} />
          ))}
        </ul>
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await service.addComment(activity, text);
              setText("");
              await comments.mutate();
            } catch {
              setError(errorText);
            } finally {
              setBusy(false);
            }
          }}
        >
          <textarea
            aria-label="Add a comment"
            placeholder="Add a comment"
            maxLength={10000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded border border-custom-border-200 bg-custom-background-100 p-2"
          />
          <Button type="submit" disabled={busy || !text.trim()}>
            Post comment
          </Button>
        </form>
      </div>
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
    </article>
  );
}

export function PlayerArea() {
  const { signOut, data: user } = useUser();
  const programs = useSWR(["PLAYER_ASSIGNMENTS", user?.id], () => service.programs());
  const [selected, setSelected] = useState("");
  const [offset, setOffset] = useState(0);
  const [logoutError, setLogoutError] = useState("");
  const program = programs.data?.find((value) => value.id === selected) ?? programs.data?.[0];
  useEffect(() => setOffset(0), [program?.id]);
  const activities = useSWR(program ? ["PLAYER_ACTIVITIES", user?.id, program.id, offset] : null, () =>
    service.activities(program!.id, offset)
  );
  return (
    <main className="h-screen overflow-y-auto bg-custom-background-90 text-custom-text-100">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">My activities</h1>
            <p className="text-sm text-custom-text-300">Your assigned programs, activities, and personal feedback.</p>
          </div>
          <Button onClick={() => void signOut().catch(() => setLogoutError("Unable to sign out. Please try again."))}>
            Sign out
          </Button>
        </header>
        {logoutError && <p role="alert">{logoutError}</p>}
        {programs.isLoading && <p role="status">Loading your programs…</p>}
        {programs.error && (
          <p role="alert">
            Unable to load your programs. <button onClick={() => void programs.mutate()}>Retry</button>
          </p>
        )}
        {programs.data?.length === 0 && (
          <p>No programs assigned yet. Ask your coach to link your roster account or assign you to a program.</p>
        )}
        {program && (
          <label className="block space-y-2">
            <span>Program</span>
            <select
              aria-label="Program"
              value={program.id}
              onChange={(event) => {
                setSelected(event.target.value);
                setOffset(0);
              }}
              className="block w-full rounded border border-custom-border-200 bg-custom-background-100 p-2"
            >
              {programs.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.workspace_name} · {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {activities.isLoading && <p role="status">Loading your activities…</p>}
        {activities.error && (
          <p role="alert">
            Unable to load your activities. <button onClick={() => void activities.mutate()}>Retry</button>
          </p>
        )}
        {activities.data?.results.length === 0 && <p>No activities or feedback assigned yet.</p>}
        {activities.data?.results.map((activity) => (
          <Activity key={`${user?.id}:${activity.id}`} activity={activity} refresh={() => activities.mutate()} />
        ))}
        {activities.data && (
          <nav aria-label="Activity pages" className="flex gap-3">
            <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
              Previous
            </Button>
            <Button disabled={offset + 50 >= activities.data.total_count} onClick={() => setOffset(offset + 50)}>
              Next
            </Button>
          </nav>
        )}
      </div>
    </main>
  );
}
