"use client";

import { Activity, Clock3, Send } from "lucide-react";
import type { DiagnosticsOverview } from "./types";

const LABELS: Record<string, string> = {
  observed: "Collecting",
  attention: "Attention required",
  stale: "Collection delayed",
  "not-configured": "Not configured",
  unknown: "Unknown",
  paused: "Paused",
  working: "Running",
  waiting: "Waiting",
  idle: "Idle",
  disabled: "Disabled",
  queued: "Queued",
};
const GUIDANCE: Record<string, string> = {
  LOW_DISK: "Collection is paused because available storage is low.",
  COLLECTION_FAILED: "Collection did not complete. Check the collector service.",
  COLLECTION_LIMITED: "Some source reads were truncated. Evidence may be incomplete.",
  COLLECTOR_STALE: "No fresh collection checkpoint. Check the collector and available storage.",
  RECENT_ANALYSIS_FAILURE: "An analysis did not complete. Review its history and reason.",
  ANALYSIS_DISABLED: "Automatic analysis is disabled.",
  DELIVERY_BLOCKED: "Delivery requires operator review. The report is not confirmed received.",
  REPEATED_DELIVERY_FAILURE: "Delivery has repeatedly failed. Check the configured connection and credentials.",
  SHARING_DISABLED: "Reports stay on this server.",
};
const count = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value.toLocaleString("en-US") : "Not measured";
const fresh = (value: string | null | undefined, now: number) => {
  const stamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(stamp) && stamp <= now && now - stamp <= 120000;
};

export function PipelineStatus({ data, online = true }: { data: DiagnosticsOverview["pipeline"]; online?: boolean }) {
  const now = Date.now();
  const current = online && fresh(data?.observed_at, now);
  if (data?.version !== 1 || !data.collection || !data.analysis || !data.delivery)
    return (
      <section className="border-b border-custom-border-200 py-5">
        <h2 className="text-sm font-semibold">Diagnostics pipeline</h2>
        <p className="mt-2 text-xs text-custom-text-300">Pipeline status is unavailable on this installation.</p>
      </section>
    );
  const collectionStale = data.collection.state === "observed" && !fresh(data.collection.observed_at, now);
  const entries = [
    {
      title: "Log collection",
      icon: Activity,
      state: collectionStale ? "stale" : data.collection.state,
      reason: collectionStale ? "COLLECTOR_STALE" : data.collection.reason,
      detail: `${count(data.collection.sources)} sources / ${count(data.collection.failed_sources)} failed / ${count(data.collection.limited_sources)} truncated`,
    },
    {
      title: "Analysis",
      icon: Clock3,
      ...data.analysis,
      detail: `${count(data.analysis.pending)} pending or running / ${count(data.analysis.failed_recent)} unsuccessful in 24 hours`,
    },
    {
      title: "Support delivery",
      icon: Send,
      ...data.delivery,
      detail:
        data.delivery.state === "disabled"
          ? "No report delivery is active."
          : `${count(data.delivery.pending)} pending / ${count(data.delivery.blocked)} blocked`,
    },
  ];
  return (
    <section className="border-b border-custom-border-200 py-6" aria-labelledby="pipeline-heading">
      <h2 id="pipeline-heading" className="text-sm font-semibold">
        Diagnostics pipeline
      </h2>
      <div className="mt-4 grid min-w-0 gap-6 lg:grid-cols-3">
        {entries.map((entry) => {
          const state = current ? entry.state : "unknown";
          return (
            <div key={entry.title} className="min-w-0" data-pipeline={entry.title}>
              <h3 className="flex items-center gap-2 text-xs font-medium text-custom-text-200">
                <entry.icon className="size-4" aria-hidden />
                {entry.title}
              </h3>
              <p className="mt-2 flex items-center gap-2 text-sm font-semibold">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${["attention", "stale"].includes(state) ? "bg-amber-500" : ["observed", "working"].includes(state) ? "bg-emerald-500" : "bg-custom-border-300"}`}
                  aria-hidden
                />
                {LABELS[state] || "Unknown"}
              </p>
              <p className="mt-2 break-words text-xs text-custom-text-300">
                {current ? entry.detail : "No fresh pipeline observation."}
              </p>
              {current && GUIDANCE[entry.reason] ? (
                <p className="mt-1 text-xs text-custom-text-200">{GUIDANCE[entry.reason]}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
