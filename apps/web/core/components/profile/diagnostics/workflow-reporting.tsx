"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Send, X } from "lucide-react";
import {
  activateWorkflowDiagnostics,
  operationEndpoint,
  validWorkflowPolicy,
  WorkflowObserver,
} from "@/helpers/workflow-diagnostics";
import { DiagnosticsService } from "@/services/diagnostics.service";

const service = new DiagnosticsService();
type Incident = {
  id: string;
  reference: string;
  support_reference?: string;
  submission_status: string;
  analysis_status: string;
  support_update?: { update: { status: string } | null } | null;
};
function Notice({ observer, sharing }: { observer: WorkflowObserver; sharing: boolean }) {
  const notice = useSyncExternalStore(observer.subscribe, observer.getSnapshot, () => null);
  const [open, setOpen] = useState(false),
    [share, setShare] = useState(false),
    [busy, setBusy] = useState(false);
  const [incident, setIncident] = useState<Incident | null>(null),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false),
    latest = useRef(notice?.operation_id);
  latest.current = notice?.operation_id;
  useEffect(() => {
    setOpen(false);
    setIncident(null);
    setShare(false);
    setError("");
  }, [notice?.operation_id]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    return () => {
      if (element.open) element.close();
    };
  }, [open]);
  if (!notice) return null;
  const labels = {
    upload: "Upload",
    playback: "Playback",
    "coaching-card": "Card request",
    "media-finalization": "Media processing",
  };
  const title = `${labels[notice.action]} ${notice.status === "completed-late" ? "confirmed after a delay" : notice.status === "failed" ? "reported a failure" : notice.status === "unverified" ? "confirmation is unverified" : notice.action === "upload" ? "progress was delayed" : "is taking longer than expected"}`;
  const request = async (refresh = false) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const operation = notice.operation_id;
    try {
      const result = await service.operation<{ incident: Incident }>(
        operationEndpoint(
          observer.workspace,
          observer.project,
          refresh ? "incident" : incident ? "submit" : "report",
          incident?.id
        ),
        refresh
          ? undefined
          : incident
            ? { consent: true }
            : {
                action: notice.action,
                operation_id: operation,
                occurred_at: notice.occurred_at,
                elapsed_ms: observer.elapsed(operation),
                reason: notice.status === "failed" ? "failed" : notice.status === "unverified" ? "manual" : "slow",
                share,
              }
      );
      if (latest.current === operation) setIncident(result.incident);
    } catch {
      if (latest.current === operation) setError("Report status is unavailable. The operation was not retried.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <aside
        aria-label="Operation confirmation issue"
        className="fixed bottom-5 right-4 z-[90] w-[360px] max-w-[calc(100vw-2rem)] rounded-md border border-amber-500/40 bg-custom-background-100 p-4 text-custom-text-100 shadow-lg"
      >
        <p role="status" className="flex items-start gap-2 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
          {title}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={observer.ignore}
            className="rounded border border-custom-border-200 px-3 py-1.5 text-sm"
          >
            Ignore
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded bg-custom-primary-100 px-3 py-1.5 text-sm text-white"
          >
            <Send className="size-3.5" aria-hidden />
            Report issue
          </button>
        </div>
      </aside>
      <dialog
        ref={dialog}
        aria-labelledby="workflow-report-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setOpen(false);
        }}
        onClose={() => setOpen(false)}
        className="m-auto w-[460px] max-w-[calc(100vw-2rem)] rounded-md border border-custom-border-200 bg-custom-background-100 p-5 text-custom-text-100 shadow-xl backdrop:bg-black/50"
      >
        <div className="flex items-center justify-between">
          <h2 id="workflow-report-title" className="text-base font-semibold">
            Report issue
          </h2>
          <button type="button" disabled={busy} onClick={() => setOpen(false)} aria-label="Close report dialog">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-3 text-sm">
          {title}. Only sanitized diagnostics are included, not video, file names or account details.
        </p>
        {incident ? (
          <div role="status" className="mt-3 text-sm">
            <p>{incident.support_reference || incident.reference}</p>
            <p>
              {incident.submission_status === "received"
                ? "Received by Kanavio"
                : incident.submission_status === "not-submitted"
                  ? "Stored locally - not shared"
                  : `Delivery: ${incident.submission_status}`}
            </p>
            <p>Analysis: {incident.analysis_status}</p>
            {incident.support_update?.update ? (
              <p>Support: {incident.support_update.update.status.replaceAll("-", " ")}</p>
            ) : null}
          </div>
        ) : null}
        {!incident || incident.submission_status === "not-submitted" ? (
          <label className="mt-4 flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={share}
              disabled={!sharing || busy}
              onChange={(event) => setShare(event.target.checked)}
            />
            {sharing
              ? "Share this report with Kanavio support"
              : "Support sharing is not configured. Reports stay locally."}
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-500">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen(false)}
            className="rounded border border-custom-border-200 px-3 py-2 text-sm"
          >
            Close
          </button>
          {incident ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void request(true)}
              className="rounded border border-custom-border-200 px-3 py-2 text-sm"
            >
              Refresh status
            </button>
          ) : null}
          {!incident || (incident.submission_status === "not-submitted" && share) ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void request()}
              className="rounded bg-custom-primary-100 px-3 py-2 text-sm text-white"
            >
              {busy ? "Preparing..." : share ? "Report to Kanavio" : "Save report locally"}
            </button>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

export function WorkflowReporting() {
  const params = useParams();
  const workspace = typeof params.workspaceSlug === "string" ? params.workspaceSlug : "";
  const project = typeof params.projectId === "string" ? params.projectId : "";
  const [channel, setChannel] = useState<{ observer: WorkflowObserver; sharing: boolean } | null>(null);
  useEffect(() => {
    setChannel(null);
    if (!workspace || !project) return;
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    const endpoint = (view: string) => operationEndpoint(workspace, project, view);
    void service
      .operation<{ enabled: boolean; can_report: boolean; sharing_enabled: boolean; operation_policy?: unknown }>(
        endpoint("capabilities"),
        undefined,
        controller.signal
      )
      .then((capabilities) => {
        if (
          controller.signal.aborted ||
          !capabilities.enabled ||
          !capabilities.can_report ||
          !validWorkflowPolicy(capabilities.operation_policy)
        )
          return;
        const observer = new WorkflowObserver(workspace, project, capabilities.operation_policy, (body) => {
          void service.operation(endpoint("measurement"), body).catch(() => undefined);
        });
        dispose = activateWorkflowDiagnostics(observer);
        const suspend = () => {
          if (document.visibilityState !== "visible" || !navigator.onLine) observer.suspend();
        };
        document.addEventListener("visibilitychange", suspend);
        window.addEventListener("offline", suspend);
        const release = dispose;
        dispose = () => {
          release();
          document.removeEventListener("visibilitychange", suspend);
          window.removeEventListener("offline", suspend);
        };
        setChannel({ observer, sharing: capabilities.sharing_enabled });
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      dispose?.();
    };
  }, [workspace, project]);
  return channel?.observer.workspace === workspace && channel.observer.project === project ? (
    <Notice key={`${workspace}/${project}`} observer={channel.observer} sharing={channel.sharing} />
  ) : null;
}
