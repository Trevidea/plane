"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LucideIcon } from "lucide-react";
import { ChartNoAxesCombined, Cpu, HardDrive, MemoryStick, Network } from "lucide-react";
import { cn } from "@plane/utils";
import { formatBytes, formatMilliseconds, historyPoints, resourceSnapshot, resourceTone } from "./model";
import type { DiagnosticsOverview, DiagnosticsRun, HealthTone } from "./types";

const COLORS = { good: "#22a681", warning: "#e5a52d", critical: "#ef6464", unknown: "rgb(var(--color-border-200))" };
const AXIS = { fill: "rgb(var(--color-text-300))", fontSize: 11 };
const TOOLTIP = {
  background: "rgb(var(--color-background-100))",
  border: "1px solid rgb(var(--color-border-200))",
  borderRadius: 6,
  fontSize: 12,
  color: "rgb(var(--color-text-100))",
};

function Gauge({ value, tone }: { value: number | null; tone: HealthTone }) {
  return (
    <div className="relative h-[88px] w-[88px] shrink-0" aria-hidden="true">
      <PieChart width={88} height={88}>
        <Pie
          data={[{ value: value ?? 0 }, { value: 1 - (value ?? 0) }]}
          dataKey="value"
          innerRadius={32}
          outerRadius={39}
          startAngle={90}
          endAngle={-270}
          stroke="none"
          isAnimationActive={false}
        >
          <Cell fill={COLORS[tone]} />
          <Cell fill="rgb(var(--color-border-100))" />
        </Pie>
      </PieChart>
      <span className="absolute inset-0 grid place-items-center text-base font-semibold tabular-nums">
        {value == null ? "--" : `${Math.round(value * 100)}%`}
      </span>
    </div>
  );
}

function ResourceMetric({
  title,
  icon: Icon,
  ratio,
  value,
  detail,
  tone,
}: {
  title: string;
  icon: LucideIcon;
  ratio: number | null;
  value: string;
  detail: string;
  tone: HealthTone;
}) {
  return (
    <div className="min-w-0 px-4 py-5 first:pl-0" data-resource={title}>
      <h3 className="flex items-center gap-2 text-xs font-medium text-custom-text-200">
        <Icon className="size-4" aria-hidden="true" />
        {title}
      </h3>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-3">
        <Gauge value={ratio} tone={tone} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-custom-text-300">{detail}</p>
        </div>
      </div>
      <span
        className={cn(
          "mt-2 inline-flex items-center gap-1.5 text-xs",
          tone === "critical"
            ? "text-red-700 [[data-theme^=dark]_&]:text-red-400"
            : tone === "warning"
              ? "text-amber-700 [[data-theme^=dark]_&]:text-amber-400"
              : "text-custom-text-300"
        )}
      >
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: COLORS[tone] }} />
        {tone === "unknown"
          ? "Not measured"
          : tone === "good"
            ? "Within resource thresholds"
            : tone === "critical"
              ? "High utilization"
              : "Resource pressure"}
      </span>
    </div>
  );
}

export function ResourceCharts({ data, now }: { data: DiagnosticsOverview; now: number }) {
  const snapshot = resourceSnapshot(data, now);
  const { sample, stale, cpu, memory, storage, rx, tx } = snapshot;
  return (
    <section
      aria-label="Current resource utilization"
      className="grid min-w-0 grid-cols-1 divide-y divide-custom-border-100 border-b border-custom-border-200 sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4"
    >
      <ResourceMetric
        title="CPU utilization"
        icon={Cpu}
        ratio={cpu}
        value={cpu == null ? "Not measured" : `${(cpu * 100).toFixed(1)}% busy`}
        detail={
          cpu == null
            ? "Awaiting two fresh samples"
            : `${Math.round(data.current.interval.seconds!)}-second observation`
        }
        tone={resourceTone(cpu)}
      />
      <ResourceMetric
        title="Memory utilization"
        icon={MemoryStick}
        ratio={memory}
        value={stale ? "Not measured" : `${formatBytes(sample?.memory_available_bytes)} available`}
        detail={stale ? "No fresh observation" : `${formatBytes(sample?.memory_total_bytes)} total`}
        tone={resourceTone(memory, sample?.memory_available_bytes)}
      />
      <ResourceMetric
        title="Storage utilization"
        icon={HardDrive}
        ratio={storage}
        value={stale ? "Not measured" : `${formatBytes(sample?.storage_available_bytes)} free`}
        detail={stale ? "No fresh observation" : `${formatBytes(sample?.storage_total_bytes)} configured filesystem`}
        tone={resourceTone(storage, sample?.storage_available_bytes)}
      />
      <div className="min-w-0 px-4 py-5">
        <h3 className="flex items-center gap-2 text-xs font-medium text-custom-text-200">
          <Network className="size-4" aria-hidden="true" />
          Network activity
        </h3>
        <dl className="mt-5 space-y-3 text-sm">
          {[
            { label: "Receive", value: rx, color: "#3aa9d6" },
            { label: "Send", value: tx, color: "#22a681" },
          ].map((item) => (
            <div key={item.label}>
              <div className="flex flex-wrap justify-between gap-1">
                <dt className="text-custom-text-300">{item.label}</dt>
                <dd className="font-medium tabular-nums">
                  {item.value == null ? "Not measured" : `${formatBytes(item.value)}/s`}
                </dd>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-custom-background-80" aria-hidden="true">
                <div
                  className="h-full rounded-sm"
                  style={{
                    background: item.color,
                    width: item.value == null ? "0%" : `${(item.value / Math.max(rx ?? 0, tx ?? 0, 1)) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </dl>
        <p
          className={cn(
            "mt-4 text-xs",
            snapshot.networkWarning ? "text-amber-700 [[data-theme^=dark]_&]:text-amber-400" : "text-custom-text-300"
          )}
        >
          {snapshot.networkWarning
            ? "Interface errors or drops observed"
            : snapshot.networkMeasured
              ? "No interface errors observed"
              : "Interface health not measured"}
        </p>
        <p className="mt-1 text-xs text-custom-text-300">Internet quality and packet loss: not measured</p>
      </div>
    </section>
  );
}

function EmptyChart({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-3 text-center text-sm text-custom-text-300">
      <ChartNoAxesCombined className="size-8 opacity-60" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function HistoryCharts({ runs }: { runs: DiagnosticsRun[] }) {
  const points = historyPoints(runs);
  const hasLatency = points.some((point) => point.p50 != null || point.p95 != null);
  const hasCounts = points.some((point) => point.operations != null || point.errors != null);
  return (
    <section
      className="grid min-w-0 grid-cols-1 gap-8 border-b border-custom-border-200 py-6 lg:grid-cols-2"
      aria-label="Historical analysis charts"
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Recorded confirmation latency</h2>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-custom-text-300">
          <span>Retained analyses · UTC</span>
          <span className="flex gap-3">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-[#3aa9d6]" />
              P50
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-[#e5a52d]" />
              P95
            </span>
          </span>
        </div>
        <div
          className="mt-4 h-[220px] w-full min-w-0"
          role="img"
          aria-label={
            hasLatency
              ? "Median and 95th-percentile confirmation times by completed analysis, in milliseconds"
              : "No measured confirmation timings in retained analyses"
          }
        >
          {hasLatency ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={points} margin={{ top: 10, right: 10, bottom: 0, left: 0 }} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="rgb(var(--color-border-100))" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={40} height={36} />
                <YAxis
                  tick={AXIS}
                  axisLine={false}
                  tickLine={false}
                  width={55}
                  tickFormatter={(value: number) => `${value}ms`}
                />
                <Tooltip contentStyle={TOOLTIP} formatter={(value: number) => formatMilliseconds(value)} />
                <Line
                  dataKey="p50"
                  name="P50"
                  type="linear"
                  stroke="#3aa9d6"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="p95"
                  name="P95"
                  type="linear"
                  stroke="#e5a52d"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart>No complete confirmation measurements</EmptyChart>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Recorded operations and error events</h2>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-custom-text-300">
          <span>Per analysis window · UTC</span>
          <span className="flex gap-3">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-[#22a681]" />
              Operations
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-[#ef6464]" />
              Error events
            </span>
          </span>
        </div>
        <div
          className="mt-4 h-[220px] w-full min-w-0"
          role="img"
          aria-label={
            hasCounts
              ? "Recorded operation and error-event counts per completed analysis"
              : "No recorded operation counts in retained analyses"
          }
        >
          {hasCounts ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={points} margin={{ top: 10, right: 10, bottom: 0, left: 0 }} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="rgb(var(--color-border-100))" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={40} height={36} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgb(var(--color-background-80))" }} />
                <Bar
                  dataKey="operations"
                  name="Operations"
                  fill="#22a681"
                  radius={[2, 2, 0, 0]}
                  maxBarSize={28}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="errors"
                  name="Error events"
                  fill="#ef6464"
                  radius={[2, 2, 0, 0]}
                  maxBarSize={28}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart>No recorded analysis statistics</EmptyChart>
          )}
        </div>
      </div>
    </section>
  );
}
