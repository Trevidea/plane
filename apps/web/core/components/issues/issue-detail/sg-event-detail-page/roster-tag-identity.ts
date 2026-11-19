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
      if (
        typeof record.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.id)
      )
        return;
      byId.set(record.id, { id: record.id, jersey: typeof record.jersey === "string" ? record.jersey : "" });
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
  const context = tag.context && typeof tag.context === "object" ? (tag.context as Record<string, unknown>) : {};
  const references = context.roster_members ?? tag.roster_members;
  if (typeof references === "string") return references;
  if (references && typeof references === "object" && !Array.isArray(references)) return JSON.stringify(references);
  return undefined;
};
