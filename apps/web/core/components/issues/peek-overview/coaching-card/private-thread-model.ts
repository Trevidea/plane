export type PrivateRecipient = { id: string; name: string };
export type PrivateMessage = {
  id: string;
  actor: string;
  author: string;
  text: string;
  createdAt: string;
  attachment?: PrivateClip;
};
export type PrivatePage = { total: number; results: PrivateMessage[] };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid private conversation");
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 20000): string => {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid private conversation");
  return value;
};
const id = (value: unknown) => {
  const result = text(value, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new Error("Invalid private conversation");
  return result;
};
const audience = (row: Record<string, unknown>, card: string, coach: string) => {
  if (row.visibility !== "private" || row.issue !== card || row.coach_id !== coach)
    throw new Error("Private conversation is unavailable");
};
export function privateRecipients(value: unknown, card: string, coach: string): PrivateRecipient[] {
  const row = object(value);
  audience(row, card, coach);
  if (!Array.isArray(row.recipients) || row.recipients.length > 500) throw new Error("Invalid private recipients");
  const recipients = row.recipients.map((item) => {
    const r = object(item);
    return { id: id(r.id), name: text(r.name, 255) };
  });
  if (new Set(recipients.map((r) => r.id)).size !== recipients.length) throw new Error("Invalid private recipients");
  return recipients;
}
export function privateMessage(value: unknown, card: string, coach: string, recipient: string): PrivateMessage {
  const row = object(value);
  audience(row, card, coach);
  const actor = id(row.actor);
  if (row.recipient_id !== recipient || row.access !== "PRIVATE" || ![coach, recipient].includes(actor))
    throw new Error("Invalid private audience");
  const details = row.actor_detail == null ? undefined : object(row.actor_detail);
  if (details && details.id !== actor) throw new Error("Invalid message author");
  const createdAt = text(row.created_at, 64);
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Invalid message date");
  return {
    id: id(row.id),
    actor,
    author: details?.display_name ? text(details.display_name, 255) : actor === coach ? "You" : "Player",
    text: text(row.comment_stripped),
    createdAt,
    ...(row.attachment == null ? {} : { attachment: privateClip(row.attachment) }),
  };
}
export function privatePage(
  value: unknown,
  card: string,
  coach: string,
  recipient: string,
  offset: number
): PrivatePage {
  const row = object(value);
  audience(row, card, coach);
  if (
    row.recipient_id !== recipient ||
    row.limit !== 50 ||
    row.offset !== offset ||
    typeof row.total_count !== "number" ||
    !Number.isSafeInteger(row.total_count) ||
    row.total_count < 0 ||
    !Array.isArray(row.results) ||
    row.results.length > 50 ||
    (row.results.length > 0 && offset + row.results.length > row.total_count)
  )
    throw new Error("Invalid private page");
  const results = row.results.map((item) => privateMessage(item, card, coach, recipient));
  if (new Set(results.map((r) => r.id)).size !== results.length) throw new Error("Invalid private page");
  return { total: row.total_count, results };
}
export function privateReply(textValue: string, attachment?: ClipSelection, clientId?: string) {
  const value = textValue.trim();
  if ((!value && !attachment) || value.length > 300) throw new Error("Write a reply of up to 300 characters");
  const escaped = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r?\n/g, "<br>");
  if (attachment && (!clientId || !/^[A-Za-z0-9_-]{1,128}$/.test(clientId))) throw new Error("Invalid send ID");
  return {
    visibility: "private",
    comment_html: value ? `<p>${escaped}</p>` : "",
    ...(attachment ? { attachment: clipSelection(attachment), client_id: clientId } : {}),
  };
}

export type ClipSelection =
  | { kind: "upload"; id: string }
  | { kind: "card_clip"; clip_index: number; revision: string };
export type ClipOption = Extract<ClipSelection, { kind: "card_clip" }> & { name: string };
export type PrivateClip = {
  id: string;
  kind: "upload" | "card_clip";
  name: string;
  size: number;
  media_type?: "video" | "image" | "document";
  content_type?: string;
  duration: number;
  start_seconds: number;
  end_seconds: number | null;
};
export const PRIVATE_ATTACHMENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const privateAttachmentMime = (name: string) =>
  PRIVATE_ATTACHMENT_TYPES[name.split(".").pop()?.toLowerCase() || ""];
export const MAX_PRIVATE_VIDEO_BYTES = 1024 * 1024 * 1024;
export function clipSelection(value: ClipSelection): ClipSelection {
  if (value.kind === "upload") return { kind: "upload", id: id(value.id) };
  if (
    value.kind !== "card_clip" ||
    !Number.isSafeInteger(value.clip_index) ||
    value.clip_index < 0 ||
    !/^[a-f0-9]{64}$/.test(value.revision)
  )
    throw new Error("Invalid clip selection");
  return { kind: "card_clip", clip_index: value.clip_index, revision: value.revision };
}
export function privateClip(value: unknown): PrivateClip {
  const row = object(value);
  if (
    !["upload", "card_clip"].includes(String(row.kind)) ||
    typeof row.size !== "number" ||
    !Number.isSafeInteger(row.size) ||
    row.size < 0 ||
    row.size > MAX_PRIVATE_VIDEO_BYTES ||
    typeof row.duration !== "number" ||
    !Number.isFinite(row.duration) ||
    row.duration < 0 ||
    typeof row.start_seconds !== "number" ||
    !Number.isFinite(row.start_seconds) ||
    row.start_seconds < 0 ||
    (row.end_seconds !== null &&
      (typeof row.end_seconds !== "number" ||
        !Number.isFinite(row.end_seconds) ||
        row.end_seconds <= row.start_seconds))
  )
    throw new Error("Invalid private video");
  if (
    row.media_type !== undefined &&
    (!["video", "image", "document"].includes(String(row.media_type)) ||
      !Object.values(PRIVATE_ATTACHMENT_TYPES).includes(String(row.content_type)) ||
      (row.media_type === "image" && !String(row.content_type).startsWith("image/")) ||
      (row.media_type === "video" && !String(row.content_type).startsWith("video/")) ||
      (row.media_type === "document" && !String(row.content_type).startsWith("application/")) ||
      (row.kind === "card_clip" && row.media_type !== "video"))
  )
    throw new Error("Invalid attachment type");
  return {
    ...(row.media_type === undefined
      ? {}
      : { media_type: row.media_type as "video" | "image" | "document", content_type: row.content_type as string }),
    id: id(row.id),
    kind: row.kind as PrivateClip["kind"],
    name: text(row.name, 255),
    size: row.size,
    duration: row.duration,
    start_seconds: row.start_seconds,
    end_seconds: row.end_seconds as number | null,
  };
}
export function privateClipOptions(value: unknown, card: string, coach: string, recipient: string): ClipOption[] {
  const row = object(value);
  audience(row, card, coach);
  if (
    row.recipient_id !== recipient ||
    row.max_bytes !== MAX_PRIVATE_VIDEO_BYTES ||
    !Array.isArray(row.clips) ||
    row.clips.length > 200
  )
    throw new Error("Invalid private clip options");
  return row.clips.map((value) => {
    const clip = object(value);
    const choice = clipSelection({
      kind: clip.kind,
      clip_index: clip.clip_index,
      revision: clip.revision,
    } as ClipOption);
    if (choice.kind !== "card_clip") throw new Error("Invalid card clip");
    return { ...choice, name: text(clip.name, 255) };
  });
}
export function privateClipGrant(value: unknown) {
  const row = object(value);
  const path = text(row.source_url, 4096);
  if (
    !/^\/api\/player\/media\/[A-Za-z0-9_.:-]{20,2048}\/(?:[A-Za-z0-9_@+-][A-Za-z0-9_.@+-]*\/)*[A-Za-z0-9_@+-][A-Za-z0-9_.@+-]*$/.test(
      path
    ) ||
    !["hls", "progressive"].includes(String(row.content_type)) ||
    !Number.isFinite(Date.parse(text(row.expires_at, 64))) ||
    Date.parse(String(row.expires_at)) <= Date.now() ||
    typeof row.start_seconds !== "number" ||
    !Number.isFinite(row.start_seconds) ||
    row.start_seconds < 0 ||
    (row.end_seconds !== null &&
      (typeof row.end_seconds !== "number" ||
        !Number.isFinite(row.end_seconds) ||
        row.end_seconds <= row.start_seconds))
  )
    throw new Error("Invalid private playback");
  return {
    path,
    contentType: row.content_type as "hls" | "progressive",
    start: row.start_seconds,
    end: row.end_seconds as number | null,
    clock: row.clock,
  };
}

export function privateClipBounds(value: unknown, duration: number): { start: number; end: number } {
  const row = object(value);
  for (const key of [
    "start_seconds",
    "end_seconds",
    "source_start_seconds",
    "playlist_start_seconds",
    "playlist_duration_seconds",
    "duration_seconds",
  ])
    if (row[key] != null && (typeof row[key] !== "number" || !Number.isFinite(row[key]) || (row[key] as number) < 0))
      throw new Error("Invalid clip clock");
  if (row.playback_mode != null && row.playback_mode !== "source" && row.playback_mode !== "clip")
    throw new Error("Invalid clip clock");
  const start = (row.start_seconds as number) || 0;
  let offset = 0;
  if (row.playback_mode === "clip") offset = (row.source_start_seconds as number) ?? start;
  else if (
    !row.playback_mode &&
    typeof row.source_url === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,511}\.m3u8$/i.test(row.source_url)
  ) {
    const total = (row.playlist_duration_seconds as number) || 0,
      position = (row.playlist_start_seconds as number) || 0;
    const span = (row.duration_seconds as number) || ((row.end_seconds as number) || 0) - start;
    if (total > 0 && position < duration && Math.abs(duration - total) <= Math.max(0.5, total * 0.02))
      offset = start - position;
    else if (start >= duration && (total <= 0 || (span > 0 && Math.abs(duration - span) <= Math.max(0.5, span * 0.02))))
      offset = start;
  }
  const from = Math.max(0, start - offset);
  if (!Number.isFinite(duration) || duration <= 0 || from >= duration)
    throw new Error("Clip is outside available video");
  const to =
    row.end_seconds != null
      ? (row.end_seconds as number) - offset
      : row.duration_seconds
        ? from + (row.duration_seconds as number)
        : duration;
  return { start: from, end: Math.max(from, Math.min(to, duration)) };
}

export function privateFileGrant(value: unknown) {
  const row = object(value);
  const path = text(row.source_url, 4096);
  if (
    !/^\/api\/player\/media\/[A-Za-z0-9_.:-]{20,2048}\/attachment\.(jpg|jpeg|png|webp|pdf|doc|docx|xls|xlsx|ppt|pptx)$/.test(
      path
    ) ||
    !["image", "document"].includes(String(row.content_type)) ||
    !Object.values(PRIVATE_ATTACHMENT_TYPES).includes(String(row.mime_type)) ||
    (row.content_type === "image" && !String(row.mime_type).startsWith("image/")) ||
    (row.content_type === "document" && !String(row.mime_type).startsWith("application/")) ||
    !Number.isFinite(Date.parse(text(row.expires_at, 64))) ||
    Date.parse(String(row.expires_at)) <= Date.now()
  )
    throw new Error("Attachment unavailable");
  return { path, type: row.content_type as "image" | "document" };
}
