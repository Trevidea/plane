import type { DiagnosticsOverview, DiagnosticsResponse, DiagnosticsRun, HealthTone } from "./types";

export const FRESHNESS_MS = 120_000;

export const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nullableNumber = (value: unknown) => value == null || finiteNumber(value);

function validStatistics(value: unknown) {
  if (!isRecord(value) || !isRecord(value.summary) || !isRecord(value.summary.latency_ms)) return false;
  const summary = value.summary;
  const latency = value.summary.latency_ms;
  return (
    typeof value.coverage === "string" &&
    finiteNumber(summary.operations) &&
    finiteNumber(summary.error_events) &&
    ["p50", "p95", "p99"].every((key) => nullableNumber(latency[key]))
  );
}

export function parseDiagnosticsResponse(value: unknown): DiagnosticsResponse {
  if (isRecord(value) && value.version === 1 && value.enabled === false) return { version: 1, enabled: false };
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.observed_at !== "string" ||
    !isRecord(value.current) ||
    !Array.isArray(value.current.samples) ||
    !isRecord(value.current.interval) ||
    !isRecord(value.automation) ||
    typeof value.automation.enabled !== "boolean" ||
    typeof value.automation.status !== "string" ||
    typeof value.automation.overdue !== "boolean" ||
    !finiteNumber(value.automation.pending_runs) ||
    !Array.isArray(value.runs) ||
    value.runs.length > 20 ||
    !Array.isArray(value.incidents) ||
    value.incidents.length > 50 ||
    typeof value.sharing_enabled !== "boolean"
  )
    throw new Error("Diagnostics returned an invalid overview.");
  for (const sample of value.current.samples) {
    if (
      !isRecord(sample) ||
      typeof sample.observed_at !== "string" ||
      !isRecord(sample.activity) ||
      typeof sample.activity.status !== "string" ||
      !Array.isArray(sample.missing) ||
      !sample.missing.every((item) => typeof item === "string")
    ) {
      throw new Error("Diagnostics returned invalid resource observations.");
    }
  }
  for (const run of value.runs) {
    if (
      !isRecord(run) ||
      typeof run.id !== "string" ||
      typeof run.status !== "string" ||
      typeof run.kind !== "string" ||
      typeof run.reason_code !== "string" ||
      !isRecord(run.window) ||
      typeof run.window.from !== "string" ||
      typeof run.window.to !== "string" ||
      (run.customer_summary != null &&
        (!isRecord(run.customer_summary) ||
          typeof run.customer_summary.headline !== "string" ||
          !Array.isArray(run.customer_summary.actions) ||
          !run.customer_summary.actions.every(
            (action) =>
              isRecord(action) &&
              typeof action.check_id === "string" &&
              typeof action.title === "string" &&
              typeof action.severity === "string"
          ))) ||
      (run.statistics != null && !validStatistics(run.statistics))
    ) {
      throw new Error("Diagnostics returned invalid analysis history.");
    }
  }
  if (
    !value.incidents.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.reference === "string" &&
        typeof item.action === "string" &&
        typeof item.analysis_status === "string" &&
        (item.submission_reason == null || typeof item.submission_reason === "string") &&
        (item.support_reference == null || typeof item.support_reference === "string") &&
        typeof item.submission_status === "string"
    )
  ) {
    throw new Error("Diagnostics returned invalid reported issues.");
  }
  return value as DiagnosticsOverview;
}

export const label = (value: string | null | undefined) => (value ? value.replaceAll(/[-_]/g, " ") : "Not recorded");

export function formatBytes(value: number | null | undefined) {
  if (!finiteNumber(value)) return "Not measured";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = value === 0 ? 0 : Math.max(0, Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1));
  return `${(value / 1024 ** index).toFixed(index === 0 && Number.isInteger(value) ? 0 : 1)} ${units[index]}`;
}

export const formatMilliseconds = (value: number | null | undefined) =>
  finiteNumber(value) ? `${Math.round(value).toLocaleString("en-US")} ms` : "Not measured";

export function formatDate(value: string | null | undefined, compact = false) {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    ...(compact ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function usedRatio(total: number | null | undefined, available: number | null | undefined) {
  return finiteNumber(total) && total > 0 && finiteNumber(available) && available <= total
    ? (total - available) / total
    : null;
}

export function resourceTone(ratio: number | null, available?: number | null): HealthTone {
  if (!finiteNumber(ratio) || ratio > 1) return "unknown";
  return ratio >= 0.95
    ? "critical"
    : ratio >= 0.9 || (finiteNumber(available) && available < 512 * 1024 ** 2)
      ? "warning"
      : "good";
}

export function resourceSnapshot(data: DiagnosticsOverview, now: number) {
  const sample = data.current.samples.at(-1);
  const timestamp = sample ? Date.parse(sample.observed_at) : NaN;
  const stale = !Number.isFinite(timestamp) || timestamp > now || now - timestamp > FRESHNESS_MS;
  const interval = data.current.interval;
  const hasInterval = !stale && finiteNumber(interval.seconds) && interval.seconds > 0;
  const cpu =
    hasInterval && finiteNumber(interval.cpu_busy_ratio) && interval.cpu_busy_ratio <= 1
      ? interval.cpu_busy_ratio
      : null;
  const memory = stale ? null : usedRatio(sample?.memory_total_bytes, sample?.memory_available_bytes);
  const storage = stale ? null : usedRatio(sample?.storage_total_bytes, sample?.storage_available_bytes);
  const networkMeasured =
    hasInterval && finiteNumber(interval.network_errors_delta) && finiteNumber(interval.network_dropped_delta);
  const networkWarning =
    networkMeasured && ((interval.network_errors_delta ?? 0) > 0 || (interval.network_dropped_delta ?? 0) > 0);
  const lowAvailable =
    !stale &&
    [sample?.memory_available_bytes, sample?.storage_available_bytes].some(
      (value) => finiteNumber(value) && value < 512 * 1024 ** 2
    );
  const warning =
    data.automation.overdue ||
    lowAvailable ||
    networkWarning ||
    [cpu, memory, storage].some((value) => value != null && value >= 0.9);
  const incomplete =
    stale ||
    [cpu, memory, storage].some((value) => value === null) ||
    !networkMeasured ||
    Boolean(sample?.missing.length);
  return {
    sample,
    stale,
    cpu,
    memory,
    storage,
    networkMeasured,
    networkWarning,
    tone: (warning ? "warning" : incomplete ? "unknown" : "good") as HealthTone,
    rx: hasInterval && finiteNumber(interval.network_rx_bytes_per_second) ? interval.network_rx_bytes_per_second : null,
    tx: hasInterval && finiteNumber(interval.network_tx_bytes_per_second) ? interval.network_tx_bytes_per_second : null,
  };
}

export function historyPoints(runs: DiagnosticsRun[]) {
  return runs
    .filter((run) => run.status === "completed" && Number.isFinite(Date.parse(run.window.to)))
    .sort((a, b) => Date.parse(a.window.to) - Date.parse(b.window.to))
    .map((run) => ({
      id: run.id,
      label: formatDate(run.window.to, true),
      p50: finiteNumber(run.statistics?.summary.latency_ms.p50) ? run.statistics!.summary.latency_ms.p50 : null,
      p95: finiteNumber(run.statistics?.summary.latency_ms.p95) ? run.statistics!.summary.latency_ms.p95 : null,
      operations: finiteNumber(run.statistics?.summary.operations) ? run.statistics!.summary.operations : null,
      errors: finiteNumber(run.statistics?.summary.error_events) ? run.statistics!.summary.error_events : null,
    }));
}

export const submissionLabel = (value: string) =>
  ({
    "not-submitted": "Stored locally",
    "waiting-analysis": "Preparing report",
    queued: "Queued for support",
    sending: "Sending",
    retry: "Waiting to retry",
    deferred: "Waiting for idle resources",
    received: "Received by Kanavio",
    blocked: "Operator attention needed",
    expired: "Sharing approval expired",
  })[value] || label(value);
