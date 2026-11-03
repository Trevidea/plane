export type PrivateRecipient = { id: string; name: string };
export type PrivateMessage = { id: string; actor: string; author: string; text: string; createdAt: string };
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
export function privateReply(textValue: string) {
  const value = textValue.trim();
  if (!value || value.length > 300) throw new Error("Write a reply of up to 300 characters");
  const escaped = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r?\n/g, "<br>");
  return { visibility: "private", comment_html: `<p>${escaped}</p>` };
}
