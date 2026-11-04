import { useState, useRef, useEffect } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { Lock, Play, Video } from "lucide-react";
import { API_BASE_URL } from "@plane/constants";
import { Avatar, Button, CustomSelect } from "@plane/ui";
import { useUser } from "@/hooks/store/user";
import { APIService } from "@/services/api.service";
import { PrivateClipControls, PrivateClipPlayer } from "./private-clip-controls";
import { privateMessage, privatePage, privateRecipients, privateReply } from "./private-thread-model";

import type { ClipSelection, PrivateClip } from "./private-thread-model";

class PrivateThreadService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
}
const service = new PrivateThreadService();
type Props = { issueId: string; workspaceSlug: string; projectId: string; disabled: boolean };
const basePath = ({ workspaceSlug, projectId, issueId }: Props) =>
  `/api/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/coaching-cards/${encodeURIComponent(issueId)}/private-threads/`;

export const CoachPrivateConversation = observer((props: Props) => {
  const { data: currentUser } = useUser();
  const coach = currentUser?.id || "";
  const [selected, setSelected] = useState("");
  const base = basePath(props);
  const {
    data: recipients,
    error,
    isLoading,
    mutate,
  } = useSWR(
    coach ? ["private-card-recipients", coach, base] : null,
    async () => privateRecipients((await service.get(base)).data, props.issueId, coach),
    { revalidateOnFocus: true, refreshInterval: 10000, keepPreviousData: false }
  );
  const recipient = recipients?.find((r) => r.id === selected) || recipients?.[0];
  return (
    <section aria-label="Private player conversations" className="space-y-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-custom-text-100">Conversation</h3>
        <span className="flex items-center gap-1 text-xs text-custom-text-300">
          <Lock className="size-3" aria-hidden="true" />
          Private
        </span>
      </div>
      {error ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>
            Private conversations are available only to this card’s authoring coach. The server must support private
            messaging.
          </p>
          <Button variant="neutral-primary" size="sm" onClick={() => void mutate()}>
            Refresh conversations
          </Button>
        </div>
      ) : isLoading ? (
        <p className="text-sm">Loading assigned players…</p>
      ) : !recipient ? (
        <p className="text-sm text-custom-text-300">No eligible linked players are currently assigned.</p>
      ) : (
        <>
          <div className="flex items-center gap-3 text-xs text-custom-text-200">
            <span>Player</span>
            <CustomSelect
              value={recipient.id}
              label={<span className="truncate">{recipient.name}</span>}
              onChange={setSelected}
              className="min-w-0 max-w-64 flex-1"
              buttonClassName="w-full rounded border border-custom-border-200 bg-custom-background-100 px-2.5 py-1.5 text-xs text-custom-text-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100"
              optionsClassName="z-50 w-64 max-w-[calc(100vw-2rem)]"
            >
              {recipients?.map((player) => (
                <CustomSelect.Option key={player.id} value={player.id}>
                  {player.name}
                </CustomSelect.Option>
              ))}
            </CustomSelect>
          </div>
          <RecipientConversation
            key={`${coach}:${base}:${recipient.id}`}
            {...props}
            coach={coach}
            recipient={recipient.id}
            recipientName={recipient.name}
          />
        </>
      )}
    </section>
  );
});

function RecipientConversation(props: Props & { coach: string; recipient: string; recipientName: string }) {
  const [attachment, setAttachment] = useState<ClipSelection>();
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState<PrivateClip | null>(null);
  const [attachmentVersion, setAttachmentVersion] = useState(0);
  const identity = useRef({ fingerprint: "", id: "" });
  const active = useRef(true);
  const sendingController = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      sendingController.current?.abort();
    };
  }, []);
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const path = `${basePath(props)}${encodeURIComponent(props.recipient)}/`;
  const {
    data: page,
    error,
    isLoading,
    mutate,
  } = useSWR(
    ["private-card-messages", props.coach, path, offset],
    async () =>
      privatePage(
        (await service.get(`${path}?limit=50&offset=${offset}`)).data,
        props.issueId,
        props.coach,
        props.recipient,
        offset
      ),
    { refreshInterval: 10000, revalidateOnFocus: true, keepPreviousData: false }
  );
  const refresh = async () => {
    try {
      await mutate();
      setUncertain(false);
    } catch {
      /* Keep sending blocked. */
    }
  };
  const send = async () => {
    if (
      inFlight.current ||
      sending ||
      uncertain ||
      !page ||
      error ||
      props.disabled ||
      uploading ||
      (!draft.trim() && !attachment)
    )
      return;
    inFlight.current = true;
    setSending(true);
    try {
      const fingerprint = JSON.stringify([draft, attachment]);
      if (identity.current.fingerprint !== fingerprint) identity.current = { fingerprint, id: crypto.randomUUID() };
      const controller = new AbortController();
      sendingController.current = controller;
      const sent = privateMessage(
        (
          await service.post(path, privateReply(draft, attachment, attachment ? identity.current.id : undefined), {
            signal: controller.signal,
          })
        ).data,
        props.issueId,
        props.coach,
        props.recipient
      );
      if (
        attachment &&
        (!sent.attachment ||
          sent.attachment.kind !== attachment.kind ||
          (attachment.kind === "upload" && sent.attachment.id !== attachment.id))
      )
        throw new Error("Attachment was not confirmed");
      if (!active.current) return;
      setAttachment(undefined);
      setAttachmentVersion((v) => v + 1);
      identity.current = { fingerprint: "", id: "" };
      setDraft("");
      setUncertain(false);
    } catch {
      if (active.current) setUncertain(true);
      return;
    } finally {
      inFlight.current = false;
      sendingController.current = null;
      if (active.current) setSending(false);
    }
    if (!active.current) return;
    await mutate().catch(() => undefined);
  };
  return (
    <div className="min-w-0">
      <div role="region" aria-label={`Conversation with ${props.recipientName}`} tabIndex={0} className="space-y-1">
        {error ? (
          <p role="alert" className="rounded-lg bg-custom-background-100 p-3 text-sm">
            Private messages could not be loaded.
          </p>
        ) : isLoading ? (
          <p role="status" className="py-10 text-center text-sm text-custom-text-300">
            Loading conversation…
          </p>
        ) : (
          <>
            {!page?.results.length && (
              <div className="space-y-1 py-5 text-sm text-custom-text-300">
                <p className="font-medium text-custom-text-200">No comments yet</p>
                <p className="text-xs text-custom-text-300">
                  Send a message or upload a video to share feedback with {props.recipientName}.
                </p>
              </div>
            )}
            {page?.results.map((message) => {
              const own = message.actor === props.coach;
              const clip = message.attachment;
              return (
                <article
                  key={message.id}
                  aria-label={`${own ? "You" : message.author} message`}
                  className="relative flex gap-3 py-3"
                >
                  <div
                    className="absolute bottom-0 left-[13px] top-0 w-0.5 bg-custom-background-80"
                    aria-hidden="true"
                  />
                  <div className="relative z-[1] flex h-6 w-7 shrink-0 items-center justify-center self-start bg-custom-background-100">
                    <Avatar size="base" name={message.author} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="font-medium text-custom-text-100">
                        {message.author}
                        {own ? " (you)" : ""}
                      </span>
                      <time
                        dateTime={message.createdAt}
                        title={new Date(message.createdAt).toLocaleString()}
                        className="text-custom-text-300"
                      >
                        {new Date(message.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
                        at{" "}
                        {new Date(message.createdAt).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    {message.text && (
                      <p className="whitespace-pre-wrap break-words text-sm text-custom-text-100">{message.text}</p>
                    )}
                    {clip &&
                      (playing?.id === clip.id ? (
                        <PrivateClipPlayer service={service} path={path} clip={clip} onClose={() => setPlaying(null)} />
                      ) : (
                        <button
                          type="button"
                          aria-label={`Play clip: ${clip.name}`}
                          onClick={() => setPlaying(clip)}
                          className="flex w-full max-w-md items-center gap-3 rounded-md border border-custom-border-200 bg-custom-background-100 px-3 py-2.5 text-left hover:bg-custom-background-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100"
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded bg-custom-background-80 text-custom-text-200">
                            <Video className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-custom-text-100">{clip.name}</span>
                            <span className="mt-0.5 block text-xs text-custom-text-300">
                              Video · {Math.floor(clip.duration / 60)}:
                              {String(Math.floor(clip.duration % 60)).padStart(2, "0")}
                              {clip.size > 0 ? ` · ${(clip.size / (1024 * 1024)).toFixed(1)} MB` : ""}
                            </span>
                          </span>
                          <Play className="size-4 shrink-0 text-custom-text-200" aria-hidden="true" />
                        </button>
                      ))}
                  </div>
                </article>
              );
            })}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 py-2">
        {page && (offset > 0 || page.total > 50) && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="neutral-primary"
              disabled={offset === 0}
              onClick={() => {
                setPlaying(null);
                setOffset(Math.max(0, offset - 50));
              }}
            >
              Previous messages
            </Button>
            <Button
              size="sm"
              variant="neutral-primary"
              disabled={offset + page.results.length >= page.total}
              onClick={() => {
                setPlaying(null);
                setOffset(offset + 50);
              }}
            >
              Next messages
            </Button>
          </div>
        )}
        <Button size="sm" variant="neutral-primary" onClick={() => void refresh()}>
          Refresh private messages
        </Button>
      </div>
      <div className="mt-3 space-y-3 rounded-md border border-custom-border-200 bg-custom-background-100 p-3 focus-within:border-custom-primary-100">
        {uncertain && (
          <p role="alert" className="text-sm text-custom-text-200">
            Reply could not be confirmed. Your draft is kept. Refresh and check the conversation before sending again.
          </p>
        )}
        <label className="block">
          <span className="sr-only">Private reply</span>
          <textarea
            aria-label="Private reply to selected player"
            placeholder="Add a comment…"
            value={draft}
            maxLength={300}
            disabled={sending || uploading || props.disabled}
            onChange={(event) => setDraft(event.target.value)}
            className="block min-h-20 w-full resize-y bg-transparent py-1 text-sm text-custom-text-100 placeholder:text-custom-text-300 focus:outline-none"
          />
        </label>
        <PrivateClipControls
          key={attachmentVersion}
          service={service}
          path={path}
          disabled={props.disabled || sending || uncertain || isLoading || !page || !!error}
          onSelect={setAttachment}
          onBusy={setUploading}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-custom-text-300">
            {uploading ? "Uploading video…" : `${draft.length}/300 · Private conversation`}
          </span>
          <Button
            size="sm"
            variant="primary"
            disabled={
              props.disabled ||
              sending ||
              uploading ||
              uncertain ||
              isLoading ||
              !page ||
              !!error ||
              (!draft.trim() && !attachment)
            }
            onClick={() => void send()}
          >
            {sending ? "Sending…" : "Send private reply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
