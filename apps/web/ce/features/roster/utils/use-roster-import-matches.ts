import { useCallback, useRef, useState } from "react";
import type { IRosterPlayerPayload } from "@plane/types";
import { RosterService } from "@/services/roster.service";
import type { TRosterImportMatches, TRosterImportMatchQuery } from "@/services/roster.service";

const rosterService = new RosterService();
const BATCH_SIZE = 50;

export const canCheckRosterImportMatch = (row: IRosterPlayerPayload) =>
  Boolean(
    row.player_name.trim() &&
    row.player_name.trim().length <= 255 &&
    /^\d{4}$/.test(row.class_year?.trim() ?? "") &&
    (!row.status || row.status === "active")
  );

export const useRosterImportMatches = (workspaceSlug: string, projectId: string) => {
  const [results, setResults] = useState<Record<number, TRosterImportMatches | undefined>>({});
  const [decisions, setDecisions] = useState<Record<number, string | undefined>>({});
  const [isChecking, setIsChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [skipMissing, setSkipMissing] = useState(false);
  const version = useRef(0);

  const reset = useCallback(() => {
    version.current += 1;
    setResults({});
    setDecisions({});
    setIsChecking(false);
    setFailed(false);
    setSkipMissing(false);
  }, []);

  const invalidate = (index: number, recheck: boolean) => {
    if (recheck) setResults((current) => ({ ...current, [index]: undefined }));
    setDecisions((current) => ({ ...current, [index]: undefined }));
    setSkipMissing(false);
  };

  const check = async (rows: IRosterPlayerPayload[], excluded: ReadonlySet<number>, fresh = false) => {
    if (fresh) reset();
    const queries: { index: number; query: TRosterImportMatchQuery }[] = [];
    rows.forEach((row, index) => {
      if (!excluded.has(index) && (fresh || !results[index]) && canCheckRosterImportMatch(row))
        queries.push({
          index,
          query: { player_name: row.player_name.trim(), graduation_year: row.class_year!.trim() },
        });
    });
    if (!queries.length) return;
    const requestVersion = ++version.current;
    setIsChecking(true);
    setFailed(false);
    setSkipMissing(false);
    try {
      for (let offset = 0; offset < queries.length; offset += BATCH_SIZE) {
        const batch = queries.slice(offset, offset + BATCH_SIZE);
        const response = await rosterService.findImportReturningAccounts(
          workspaceSlug,
          projectId,
          batch.map(({ query }) => query)
        );
        if (version.current !== requestVersion) return;
        if (response.rows.length !== batch.length) throw new Error("Incomplete roster match response");
        setResults((current) => ({
          ...current,
          ...Object.fromEntries(batch.map(({ index }, i) => [index, response.rows[i]])),
        }));
      }
    } catch {
      if (version.current === requestVersion) setFailed(true);
    } finally {
      if (version.current === requestVersion) setIsChecking(false);
    }
  };

  return {
    results,
    decisions,
    isChecking,
    failed,
    skipMissing,
    reset,
    invalidate,
    check,
    skip: () => setSkipMissing(true),
    choose: (index: number, account: string) => setDecisions((current) => ({ ...current, [index]: account })),
  };
};
