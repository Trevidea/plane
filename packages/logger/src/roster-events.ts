export const rosterActions = [
  "save",
  "status",
  "import",
  "export",
  "match",
  "approve",
  "decline",
  "share-open",
  "share-close",
  "invitation-retry",
  "reset-issue",
  "account-correction",
  "notice-read",
] as const;
export const rosterResults = ["confirmed", "failed", "interrupted", "unverified"] as const;
export type RosterAction = (typeof rosterActions)[number];
export type RosterResult = (typeof rosterResults)[number];
export const enrollmentId = /^enr-[a-f0-9]{32}$/;

export function decodeRosterUI(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    ![
      "action,duration_ms,event,operation_id,result",
      "action,duration_ms,event,inactivity_ms,operation_id,result",
    ].includes(Object.keys(row).sort().join(",")) ||
    row.event !== "roster.ui.completed" ||
    typeof row.operation_id !== "string" ||
    !enrollmentId.test(row.operation_id) ||
    !rosterActions.includes(row.action as RosterAction) ||
    !rosterResults.includes(row.result as RosterResult) ||
    typeof row.duration_ms !== "number" ||
    !Number.isFinite(row.duration_ms) ||
    row.duration_ms < 0 ||
    row.duration_ms > 3_600_000 ||
    ("inactivity_ms" in row &&
      (row.action !== "import" ||
        row.result !== "confirmed" ||
        typeof row.inactivity_ms !== "number" ||
        !Number.isFinite(row.inactivity_ms) ||
        row.inactivity_ms < 0 ||
        row.inactivity_ms > row.duration_ms))
  )
    return null;
  return {
    event: row.event,
    operation_id: row.operation_id,
    duration_ms: row.duration_ms,
    action: row.action as RosterAction,
    result: row.result as RosterResult,
    ...(typeof row.inactivity_ms === "number" ? { inactivity_ms: row.inactivity_ms } : {}),
  };
}
