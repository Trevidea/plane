"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, FileClock, Inbox } from "lucide-react";
import { cn } from "@plane/utils";
import { formatDate, formatMilliseconds, label, submissionLabel } from "./model";
import { ReportExportButton } from "./report-export-button";
import type { DiagnosticsIncident, DiagnosticsRun } from "./types";

export function StateBadge({ value }: { value: string }) {
  const tone = ["completed", "received"].includes(value)
    ? "bg-emerald-500/10 text-emerald-700 [[data-theme^=dark]_&]:text-emerald-400"
    : ["failed", "blocked"].includes(value)
      ? "bg-red-500/10 text-red-700 [[data-theme^=dark]_&]:text-red-400"
      : ["queued", "running", "retry", "deferred", "waiting-analysis", "sending"].includes(value)
        ? "bg-amber-500/10 text-amber-700 [[data-theme^=dark]_&]:text-amber-400"
        : "bg-custom-background-80 text-custom-text-200";
  return (
    <span className={cn("inline-flex max-w-full rounded px-2 py-0.5 text-xs font-medium capitalize", tone)}>
      {label(value)}
    </span>
  );
}

export function AnalysisHistory({ runs, exportUrl }: { runs: DiagnosticsRun[]; exportUrl?: (id: string) => string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!runs.length)
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-sm text-custom-text-300">
        <FileClock className="size-8" aria-hidden="true" />
        <p>No retained analyses yet.</p>
      </div>
    );
  return (
    <div className="overflow-x-auto py-4">
      <table className="w-full min-w-[720px] text-left text-sm">
        <caption className="sr-only">Retained diagnostics analyses</caption>
        <thead className="border-b border-custom-border-200 text-xs text-custom-text-300">
          <tr>
            {[
              "",
              "Analysis · UTC",
              "Status",
              "Evidence",
              "Operations",
              "P95 confirmation",
              "Error events",
              "Export",
            ].map((name) => (
              <th key={name} scope="col" className="px-3 py-3 font-medium">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <Fragment key={run.id}>
              <tr className="border-b border-custom-border-100">
                <td className="w-9 px-1">
                  <button
                    type="button"
                    aria-label={`View analysis ${formatDate(run.updated_at)}`}
                    aria-expanded={expanded === run.id}
                    aria-controls={`analysis-${run.id}`}
                    onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                    className="grid size-8 place-items-center rounded hover:bg-custom-background-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-custom-primary-100"
                  >
                    {expanded === run.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </button>
                </td>
                <th scope="row" className="px-3 py-4 font-normal">
                  <span className="block whitespace-nowrap">{formatDate(run.updated_at)}</span>
                  <span className="mt-1 block text-xs capitalize text-custom-text-300">{label(run.kind)}</span>
                </th>
                <td className="px-3 py-4">
                  <StateBadge value={run.status} />
                </td>
                <td className="px-3 py-4 capitalize">{label(run.statistics?.coverage)}</td>
                <td className="px-3 py-4 tabular-nums">{run.statistics?.summary.operations ?? "Not recorded"}</td>
                <td className="whitespace-nowrap px-3 py-4 tabular-nums">
                  {formatMilliseconds(run.statistics?.summary.latency_ms.p95)}
                </td>
                <td className="px-3 py-4 tabular-nums">{run.statistics?.summary.error_events ?? "Not recorded"}</td>
                <td className="px-3 py-4">
                  {exportUrl && run.status === "completed" && run.report_available ? (
                    <ReportExportButton id={run.id} url={exportUrl(run.id)} />
                  ) : null}
                </td>
              </tr>
              {expanded === run.id ? (
                <tr id={`analysis-${run.id}`} className="border-b border-custom-border-200">
                  <td colSpan={8} className="bg-custom-background-90 px-5 py-4">
                    <p className="font-medium">
                      {run.customer_summary?.headline || "No customer summary is available."}
                    </p>
                    <p className="mt-2 text-xs text-custom-text-300">
                      {formatDate(run.window.from)} – {formatDate(run.window.to)} UTC
                    </p>
                    {run.reason_code ? (
                      <p className="mt-2 text-xs text-custom-text-200">Result: {label(run.reason_code)}</p>
                    ) : null}
                    {run.customer_summary?.actions.length ? (
                      <ul className="mt-3 space-y-2 text-sm">
                        {run.customer_summary.actions.map((action, index) => (
                          <li key={`${action.check_id}-${index}`} className="border-l-2 border-amber-500 pl-3">
                            {action.title}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportedIssues({
  incidents,
  exportUrl,
}: {
  incidents: DiagnosticsIncident[];
  exportUrl?: (id: string) => string;
}) {
  const [filter, setFilter] = useState("all");
  const visible = incidents.filter(
    (item) =>
      filter === "all" ||
      (filter === "received" ? item.submission_status === "received" : item.submission_status !== "received")
  );
  return (
    <section className="py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Reported issues <span className="ml-1 font-normal text-custom-text-300">{visible.length}</span>
        </h2>
        <select
          aria-label="Filter reported issues"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="rounded border border-custom-border-200 bg-custom-background-100 px-3 py-1.5 text-xs outline-none focus:border-custom-primary-100"
        >
          <option value="all">All issues</option>
          <option value="received">Received by Kanavio</option>
          <option value="local">Not yet received</option>
        </select>
      </div>
      {visible.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <caption className="sr-only">Customer-reported issues and support delivery status</caption>
            <thead className="border-b border-custom-border-200 text-xs text-custom-text-300">
              <tr>
                {["Reference", "Reported · UTC", "Action", "Local analysis", "Support delivery", "Export"].map(
                  (name) => (
                    <th key={name} scope="col" className="px-3 py-3 font-medium">
                      {name}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((incident) => (
                <tr key={incident.id} className="border-b border-custom-border-100">
                  <th scope="row" className="px-3 py-4 font-medium">
                    {incident.support_reference || incident.reference}
                  </th>
                  <td className="whitespace-nowrap px-3 py-4 text-custom-text-200">
                    {formatDate(incident.received_at)}
                  </td>
                  <td className="px-3 py-4 capitalize">{label(incident.action)}</td>
                  <td className="px-3 py-4">
                    <StateBadge value={incident.analysis_status} />
                  </td>
                  <td className="px-3 py-4">
                    <p>{submissionLabel(incident.submission_status)}</p>
                    {incident.support_update?.update ? (
                      <div className="mt-2 max-w-md space-y-1 break-words text-xs">
                        <p className="font-medium">Support: {label(incident.support_update.update.status)}</p>
                        <p className="whitespace-pre-wrap">{incident.support_update.update.message}</p>
                        <p className="text-custom-text-300">
                          Last checked: {formatDate(new Date(incident.support_update.checked_at * 1000).toISOString())}
                        </p>
                      </div>
                    ) : incident.submission_status === "received" ? (
                      <p className="mt-1 text-xs text-custom-text-300">No support update synchronized yet.</p>
                    ) : null}
                    {incident.submission_reason ? (
                      <p className="mt-1 text-xs text-custom-text-300">{label(incident.submission_reason)}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-4">
                    {exportUrl && incident.analysis_status === "completed" && incident.analysis_id ? (
                      <ReportExportButton id={incident.analysis_id} url={exportUrl(incident.analysis_id)} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-sm text-custom-text-300">
          <Inbox className="size-8" aria-hidden="true" />
          <p>{incidents.length ? "No issues match this filter." : "No issues have been reported."}</p>
        </div>
      )}
    </section>
  );
}
