export type TagRosterMember = { id: string; jersey: string };
export type RosterIdentity = { id: string; player_name: string; jersey_number?: string | null; status?: string };

export const getTagRosterMembers = (context: Readonly<Record<string, string>> | undefined): TagRosterMember[] => {
  try {
    const value: unknown = JSON.parse(context?.roster_members ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const byId = new Map<string, TagRosterMember>();
    Object.values(value).forEach((member: unknown) => {
      if (!member || typeof member !== "object") return;
      const record = member as Record<string, unknown>;
      const id = record.member_id ?? record.id;
      if (
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
        (record.member_id != null &&
          record.id != null &&
          (typeof record.id !== "string" || record.id.toLowerCase() !== id.toLowerCase()))
      )
        return;
      byId.set(id.toLowerCase(), {
        id: id.toLowerCase(),
        jersey: typeof record.jersey === "string" ? record.jersey : "",
      });
    });
    return [...byId.values()];
  } catch {
    return [];
  }
};

export const getRosterMemberLabel = (member: TagRosterMember, labelsById: ReadonlyMap<string, string>) => {
  const name = labelsById.get(member.id);
  return [name || "Player", member.jersey ? `#${member.jersey.replace(/^#/, "")}` : ""].filter(Boolean).join(", ");
};

export const getNestedRosterContext = (tag: Record<string, unknown>): string | undefined => {
  const from = (context: unknown) =>
    context && typeof context === "object" ? (context as Record<string, unknown>).roster_members : undefined;
  const references = from(tag.context) ?? from(tag.event_context) ?? tag.roster_members;
  if (typeof references === "string") return references;
  if (references && typeof references === "object" && !Array.isArray(references)) return JSON.stringify(references);
  return undefined;
};
