import { useState, useRef } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { API_BASE_URL } from "@plane/constants";
import { Button, CustomSelect } from "@plane/ui";
import { useUser } from "@/hooks/store/user";
import { APIService } from "@/services/api.service";
import { privateMessage, privatePage, privateRecipients, privateReply } from "./private-thread-model";

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
    <section aria-label="Private player conversations" className="space-y-3 py-3">
      <h3 className="text-sm font-medium text-custom-text-100">Private player conversations</h3>
      <p className="text-xs text-custom-text-300">Each conversation is visible only to you and the selected player.</p>
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
          <div className="flex flex-wrap items-center gap-3 border-b border-custom-border-200 pb-4">
            <span className="text-xs font-medium text-custom-text-300">Conversation with</span>
            <CustomSelect
              value={recipient.id}
              label={<span className="truncate">{recipient.name}</span>}
              onChange={setSelected}
              className="w-full sm:w-64"
              buttonClassName="w-full rounded-md border border-custom-border-200 bg-custom-background-90 px-3 py-2 text-sm text-custom-text-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100"
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
          />
        </>
      )}
    </section>
  );
});

function RecipientConversation(props: Props & { coach: string; recipient: string }) {
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
    if (inFlight.current || sending || uncertain || !page || error || props.disabled || !draft.trim()) return;
    inFlight.current = true;
    setSending(true);
    try {
      privateMessage((await service.post(path, privateReply(draft))).data, props.issueId, props.coach, props.recipient);
      setDraft("");
      setUncertain(false);
    } catch {
      setUncertain(true);
      return;
    } finally {
      inFlight.current = false;
      setSending(false);
    }
    await mutate().catch(() => undefined);
  };
  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="text-sm">
          Private messages could not be loaded.
        </p>
      ) : isLoading ? (
        <p>Loading private messages…</p>
      ) : (
        <>
          {!page?.results.length && (
            <div className="rounded-md border border-dashed border-custom-border-200 bg-custom-background-90 px-4 py-6 text-center">
              <p className="text-sm text-custom-text-200">No private messages yet.</p>
              <p className="mt-1 text-xs text-custom-text-300">Send a reply to start this conversation.</p>
            </div>
          )}
          {page?.results.map((message) => (
            <article key={message.id} className="rounded border border-custom-border-200 p-3 text-sm">
              <div className="flex justify-between gap-2 text-xs text-custom-text-300">
                <span>{message.author}</span>
                <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words">{message.text}</p>
            </article>
          ))}
          {page && page.total > 50 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="neutral-primary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous messages
              </Button>
              <Button
                size="sm"
                variant="neutral-primary"
                disabled={!page || offset + page.results.length >= page.total}
                onClick={() => setOffset(offset + 50)}
              >
                Next messages
              </Button>
            </div>
          )}
        </>
      )}
      {uncertain && (
        <p role="alert" className="text-sm">
          Reply could not be confirmed. Your draft is kept. Refresh and check the conversation before sending again.
        </p>
      )}
      <Button size="sm" variant="neutral-primary" onClick={() => void refresh()}>
        Refresh private messages
      </Button>
      <label className="block space-y-2 text-sm">
        Private reply
        <textarea
          aria-label="Private reply to selected player"
          value={draft}
          maxLength={300}
          disabled={sending || props.disabled}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a private reply…"
          className="block min-h-24 w-full resize-y rounded-md border border-custom-border-200 bg-custom-background-90 px-3 py-2 text-sm text-custom-text-100 placeholder:text-custom-text-400 focus:border-custom-primary-100 focus:outline-none focus:ring-1 focus:ring-custom-primary-100 disabled:opacity-50"
        />
      </label>
      <Button
        size="sm"
        variant="primary"
        disabled={props.disabled || sending || uncertain || isLoading || !page || !!error || !draft.trim()}
        onClick={() => void send()}
      >
        Send private reply
      </Button>
    </div>
  );
}
