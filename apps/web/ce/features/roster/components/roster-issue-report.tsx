"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Send } from "lucide-react";
import { getRosterIssue, subscribeRosterIssue } from "@plane/logger/diagnostics-browser";
import type { RosterIssue } from "@plane/logger/diagnostics-browser";
import { AuthService } from "@/services/auth.service";
import { APIService } from "@/services/api.service";
import { API_BASE_URL } from "@plane/constants";

const auth = new AuthService();
class EnrollmentReports extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
}
const service = new EnrollmentReports();
type Incident = {
  id: string;
  reference: string;
  support_reference?: string;
  analysis_status: string;
  submission_status: string;
  can_share: boolean;
};

export function RosterIssueReport() {
  const path = usePathname();
  const issue = useSyncExternalStore(subscribeRosterIssue, getRosterIssue, () => null);
  const [selected, setSelected] = useState<RosterIssue | null>(null);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
  }, [selected]);
  if (!issue || issue.path !== path) return null;

  const submit = async (mode: "save" | "status" | "send") => {
    if (busy || !selected) return;
    setBusy(true);
    setError("");
    try {
      const { csrf_token } = await auth.requestCSRFToken();
      const response = await service.post(
        "/api/player/enrollment-diagnostics/",
        {
          mode,
          operation_id: selected.operationId,
          ...(mode === "save" ? { observation: selected.observation } : { incident_id: incident?.id }),
        },
        { timeout: 12_000, headers: { "X-CSRFToken": csrf_token } }
      );
      if (!response.data?.incident?.id) throw new Error("No report reference");
      setIncident(response.data.incident);
    } catch {
      setError("Reporting is unavailable for this attempt. Your roster operation was not retried.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded border border-custom-border-200 px-2.5 py-1.5 text-sm"
        onClick={() => {
          setSelected(issue);
          setIncident(null);
          setError("");
        }}
      >
        <Send className="size-3.5" aria-hidden /> Report issue
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="roster-issue-title"
        onClose={() => setSelected(null)}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        className="m-auto w-[440px] max-w-[calc(100vw-2rem)] rounded-md border border-custom-border-200 bg-custom-background-100 p-5 text-custom-text-100 backdrop:bg-black/50"
      >
        <h2 id="roster-issue-title" className="font-semibold">
          Report roster issue
        </h2>
        {incident ? (
          <p role="status" className="mt-3 text-sm">
            {incident.support_reference || incident.reference} · Analysis: {incident.analysis_status} ·{" "}
            {incident.submission_status === "not-submitted"
              ? "Stored locally, not shared"
              : incident.submission_status === "received"
                ? "Received by Kanavio"
                : incident.submission_status}
          </p>
        ) : (
          <p className="mt-3 text-sm">Only the selected attempt’s diagnostic outcome and timing are included.</p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-500">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2 text-sm">
          <button
            type="button"
            disabled={busy}
            className="rounded border px-3 py-2"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
          {incident ? (
            <>
              <button
                type="button"
                disabled={busy}
                className="rounded border px-3 py-2"
                onClick={() => void submit("status")}
              >
                Refresh status
              </button>
              {incident.can_share && incident.submission_status === "not-submitted" && (
                <button
                  type="button"
                  disabled={busy}
                  className="rounded bg-custom-primary-100 px-3 py-2 text-white"
                  onClick={() => void submit("send")}
                >
                  Send to Kanavio
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="rounded bg-custom-primary-100 px-3 py-2 text-white"
              onClick={() => void submit("save")}
            >
              {busy ? "Saving…" : "Save locally"}
            </button>
          )}
        </div>
      </dialog>
    </>
  );
}
