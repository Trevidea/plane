"use client";

import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { observer } from "mobx-react";
import useSWR from "swr";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileClock,
  HeartPulse,
  Inbox,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { Tab } from "@headlessui/react";
import { cn } from "@plane/utils";
import { PageHead } from "@/components/core/page-title";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUser } from "@/hooks/store/user";
import { DiagnosticsService } from "@/services/diagnostics.service";
import { HistoryCharts, ResourceCharts } from "./charts";
import { AnalysisHistory, ReportedIssues, StateBadge } from "./history";
import { formatDate, label, resourceSnapshot } from "./model";
import { PipelineStatus } from "./pipeline-status";
import type { DiagnosticsOverview } from "./types";

const service = new DiagnosticsService();
const TABS = [
  { title: "Overview", icon: Activity },
  { title: "Analysis history", icon: FileClock },
  { title: "Reported issues", icon: Inbox },
];

function FindingsAndSchedule({ data, now }: { data: DiagnosticsOverview; now: number }) {
  const latest = data.runs
    .filter((run) => run.status === "completed" && run.customer_summary)
    .sort((a, b) => Date.parse(b.window.to) - Date.parse(a.window.to))[0];
  const snapshot = resourceSnapshot(data, now);
  const activity = snapshot.sample?.activity;
  return (
    <section className="grid min-w-0 grid-cols-1 gap-8 py-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Latest findings</h2>
          {latest ? <span className="text-xs text-custom-text-300">{formatDate(latest.window.to)} UTC</span> : null}
        </div>
        {latest ? (
          <>
            <p className="mt-4 text-sm font-medium">{latest.customer_summary!.headline}</p>
            <p className="mt-1 text-xs text-custom-text-300">
              Evidence: {label(latest.statistics?.coverage)}. Historical analysis, not a current health check.
            </p>
            <ul className="mt-4 divide-y divide-custom-border-100">
              {latest.customer_summary!.actions.slice(0, 5).map((action, index) => (
                <li key={`${action.check_id}-${index}`} className="flex items-start gap-3 py-3 text-sm">
                  <AlertTriangle
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      action.severity === "critical" || action.severity === "error"
                        ? "text-red-500"
                        : action.severity === "warning" || action.severity === "warn"
                          ? "text-amber-500"
                          : "text-custom-text-300"
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 break-words">{action.title}</span>
                </li>
              ))}
            </ul>
            {!latest.customer_summary!.actions.length ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-custom-text-200">
                <CheckCircle2 className="size-4 text-emerald-500" aria-hidden="true" />
                No corrective actions in this report.
              </p>
            ) : null}
          </>
        ) : (
          <p className="py-8 text-sm text-custom-text-300">No completed analysis is available.</p>
        )}
      </div>
      <div className="min-w-0 lg:border-l lg:border-custom-border-100 lg:pl-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4 text-custom-text-300" aria-hidden="true" />
          Scheduled analysis
        </h2>
        <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-3 gap-y-4 text-xs">
          <dt className="text-custom-text-300">State</dt>
          <dd>
            <StateBadge value={data.automation.enabled ? data.automation.status : "disabled"} />
          </dd>
          <dt className="text-custom-text-300">Daily schedule</dt>
          <dd className="break-words font-medium">
            {data.automation.daily_at
              ? `${data.automation.daily_at} ${data.automation.timezone || ""}`
              : "Not configured"}
          </dd>
          <dt className="text-custom-text-300">Last completed</dt>
          <dd className="break-words">
            {data.automation.last_completed_at
              ? `${formatDate(data.automation.last_completed_at)} UTC`
              : "Not recorded"}
          </dd>
          <dt className="text-custom-text-300">Waiting analyses</dt>
          <dd className="tabular-nums">{data.automation.pending_runs}</dd>
          <dt className="text-custom-text-300">Current activity</dt>
          <dd>
            {!snapshot.stale &&
            activity?.status === "observed" &&
            activity.live_streams != null &&
            activity.media_jobs != null
              ? `${activity.live_streams} live streams, ${activity.media_jobs} media jobs`
              : "Not measured"}
          </dd>
          <dt className="text-custom-text-300">Support sharing</dt>
          <dd className="flex items-start gap-1.5">
            <ShieldCheck className="size-3.5 shrink-0 text-custom-text-300" aria-hidden="true" />
            <span>{data.sharing_enabled ? "Requires explicit approval" : "Disabled - reports stay local"}</span>
          </dd>
        </dl>
        {data.automation.overdue ? (
          <p
            role="status"
            className="mt-4 border-l-2 border-amber-500 pl-3 text-xs text-amber-700 [[data-theme^=dark]_&]:text-amber-400"
          >
            Scheduled analysis is overdue. Activity and resource safety checks remain enforced.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Dashboard({
  data,
  now,
  online,
  workspaceSlug,
}: {
  data: DiagnosticsOverview;
  now: number;
  online: boolean;
  workspaceSlug: string;
}) {
  const snapshot = resourceSnapshot(data, online ? now : Infinity);
  const color =
    snapshot.tone === "good"
      ? "text-emerald-700 [[data-theme^=dark]_&]:text-emerald-400"
      : snapshot.tone === "warning"
        ? "text-amber-700 [[data-theme^=dark]_&]:text-amber-400"
        : "text-custom-text-300";
  return (
    <>
      <section
        className="flex flex-wrap items-start justify-between gap-4 border-b border-custom-border-200 py-5"
        aria-label="Observation status"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-custom-background-90", color)}
          >
            {snapshot.tone === "warning" ? (
              <AlertTriangle className="size-5" aria-hidden="true" />
            ) : (
              <HeartPulse className="size-5" aria-hidden="true" />
            )}
          </div>
          <div>
            <h2 className={cn("text-sm font-semibold", color)}>
              {snapshot.tone === "warning"
                ? "Attention required"
                : snapshot.tone === "good"
                  ? "Resources within observed thresholds"
                  : "Current health is not fully measured"}
            </h2>
            <p className="mt-1 text-xs text-custom-text-300">
              {snapshot.stale
                ? "Current measurements are missing, stale or offline."
                : `Observed ${formatDate(snapshot.sample?.observed_at)} UTC`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-custom-text-300">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Customer-local analysis
        </div>
      </section>
      <Tab.Group>
        <Tab.List
          className="flex gap-4 overflow-x-auto border-b border-custom-border-200"
          aria-label="Diagnostics views"
        >
          {TABS.map(({ title, icon: Icon }) => (
            <Tab
              key={title}
              className={({ selected }) =>
                cn(
                  "flex shrink-0 items-center gap-2 border-b-2 px-1 py-3.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-custom-primary-100",
                  selected
                    ? "border-custom-primary-100 text-custom-primary-100"
                    : "border-transparent text-custom-text-300 hover:text-custom-text-100"
                )
              }
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {title}
            </Tab>
          ))}
        </Tab.List>
        <Tab.Panels>
          <Tab.Panel className="outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100">
            <ResourceCharts data={data} now={online ? now : Infinity} />
            {snapshot.sample?.missing.length ? (
              <p className="border-b border-custom-border-100 py-3 text-xs text-amber-700 [[data-theme^=dark]_&]:text-amber-400">
                Missing observations: {snapshot.sample.missing.map(label).join(", ")}
              </p>
            ) : null}
            <PipelineStatus data={data.pipeline} online={online} />
            <HistoryCharts runs={data.runs} />
            <FindingsAndSchedule data={data} now={online ? now : Infinity} />
          </Tab.Panel>
          <Tab.Panel className="outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100">
            <AnalysisHistory
              runs={data.runs}
              exportUrl={
                data.export_enabled
                  ? (id) => `/api/workspaces/${encodeURIComponent(workspaceSlug)}/diagnostics/reports/${id}/export/`
                  : undefined
              }
            />
          </Tab.Panel>
          <Tab.Panel className="outline-none focus-visible:ring-2 focus-visible:ring-custom-primary-100">
            <ReportedIssues
              incidents={data.incidents}
              exportUrl={
                data.export_enabled
                  ? (id) => `/api/workspaces/${encodeURIComponent(workspaceSlug)}/diagnostics/reports/${id}/export/`
                  : undefined
              }
            />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </>
  );
}

export const AccountDiagnosticsPage = observer(function AccountDiagnosticsPage({
  workspaceSlug,
}: {
  workspaceSlug: string;
}) {
  const { data: user } = useUser();
  const { getWorkspaceBySlug } = useWorkspace();
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    user?.id && workspaceSlug ? ["account-diagnostics", workspaceSlug, user.id] : null,
    () => service.overview(workspaceSlug),
    {
      refreshInterval: 30000,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      dedupingInterval: 15000,
      focusThrottleInterval: 30000,
      shouldRetryOnError: false,
    }
  );
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      setNow(Date.now());
    };
    update();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") update();
    }, 30000);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const forbidden = isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0);
  const message =
    isAxiosError(error) && typeof error.response?.data?.error === "string"
      ? error.response.data.error
      : "Diagnostics is temporarily unavailable. Please try again later.";
  const disabled = data && "enabled" in data && data.enabled === false;
  const overview = data && "current" in data ? data : null;
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1280px] px-4 md:px-0" aria-busy={isLoading}>
      <PageHead title="Diagnostics - Account Settings" />
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-custom-border-200 pb-5">
        <div className="min-w-0 max-w-full">
          <h1 className="flex items-center gap-2 text-xl font-medium">
            <HeartPulse className="size-5 text-custom-primary-100" aria-hidden="true" />
            Diagnostics
          </h1>
          <p className="mt-1 break-words text-xs text-custom-text-300">
            {getWorkspaceBySlug(workspaceSlug)?.name || workspaceSlug} / Installation health
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-custom-text-300" role="status">
            {isValidating
              ? "Refreshing"
              : !online
                ? "Offline"
                : overview
                  ? `Updated ${formatDate(overview.observed_at, true)} UTC`
                  : ""}
          </span>
          <button
            type="button"
            aria-label="Refresh diagnostics"
            title="Refresh diagnostics"
            disabled={isValidating || !online || !user}
            onClick={() => {
              setNow(Date.now());
              void mutate().catch(() => undefined);
            }}
            className="grid size-8 shrink-0 place-items-center rounded border border-custom-border-200 text-custom-text-200 hover:bg-custom-background-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-custom-primary-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw
              className={cn("size-4", isValidating && "animate-spin motion-reduce:animate-none")}
              aria-hidden="true"
            />
          </button>
        </div>
      </header>
      {!online ? (
        <div
          className="mt-4 flex items-center gap-2 border-l-2 border-amber-500 py-2 pl-3 text-sm text-amber-700 [[data-theme^=dark]_&]:text-amber-400"
          role="status"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden="true" />
          Offline. Current observations are unavailable.
        </div>
      ) : null}
      {error ? (
        <div
          className="my-5 flex items-start gap-3 rounded border border-custom-border-200 bg-custom-background-90 p-4"
          role="alert"
        >
          {forbidden ? (
            <LockKeyhole className="mt-0.5 size-5 shrink-0 text-custom-text-300" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" aria-hidden="true" />
          )}
          <div>
            <h2 className="text-sm font-medium">
              {forbidden ? "Diagnostics access unavailable" : "Unable to refresh diagnostics"}
            </h2>
            <p className="mt-1 text-sm text-custom-text-200">{message}</p>
            {overview && !forbidden ? (
              <p className="mt-1 text-xs text-custom-text-300">Previously observed data is shown below.</p>
            ) : null}
          </div>
        </div>
      ) : null}
      {disabled && !forbidden ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
          <HeartPulse className="size-9 text-custom-text-300" aria-hidden="true" />
          <h2 className="text-base font-medium">Diagnostics is not enabled</h2>
          <p className="max-w-md text-sm text-custom-text-300">
            Customer diagnostics has not been configured for this installation.
          </p>
        </div>
      ) : overview && !forbidden ? (
        <Dashboard
          key={workspaceSlug}
          data={overview}
          now={Math.max(now, Date.now())}
          online={online}
          workspaceSlug={workspaceSlug}
        />
      ) : !error ? (
        <div className="py-8" role="status">
          <span className="sr-only">Loading diagnostics</span>
          <div className="h-16 animate-pulse rounded bg-custom-background-90 motion-reduce:animate-none" />
          <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <div
                key={key}
                className="h-[160px] animate-pulse rounded bg-custom-background-90 motion-reduce:animate-none"
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});
