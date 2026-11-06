import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FRESHNESS_MS,
  formatBytes,
  formatDate,
  historyPoints,
  parseDiagnosticsResponse,
  resourceSnapshot,
  resourceTone,
} from "../model.ts";

const now = Date.parse("2026-10-31T06:00:00Z");
const overview = () => ({
  version: 1,
  observed_at: new Date(now).toISOString(),
  current: {
    status: "observed",
    samples: [
      {
        observed_at: new Date(now - 1000).toISOString(),
        memory_total_bytes: 16 * 1024 ** 3,
        memory_available_bytes: 10 * 1024 ** 3,
        storage_total_bytes: 200 * 1024 ** 3,
        storage_available_bytes: 140 * 1024 ** 3,
        missing: [],
        activity: { status: "observed", live_streams: 0, media_jobs: 0 },
      },
    ],
    interval: {
      seconds: 30,
      cpu_busy_ratio: 0.2,
      network_rx_bytes_per_second: 0,
      network_tx_bytes_per_second: 100,
      network_errors_delta: 0,
      network_dropped_delta: 0,
    },
  },
  automation: { enabled: true, status: "idle", pending_runs: 0, overdue: false, last_completed_at: null },
  sharing_enabled: false,
  runs: [],
  incidents: [],
});

test("fresh observed metrics retain zero as a real measurement", () => {
  const value = overview();
  value.current.interval.cpu_busy_ratio = 0;
  const result = resourceSnapshot(value, now);
  assert.equal(result.cpu, 0);
  assert.equal(result.rx, 0);
  assert.equal(result.tone, "good");
});
test("missing CPU measurement does not become zero or healthy", () => {
  const value = overview();
  value.current.interval.cpu_busy_ratio = null;
  const result = resourceSnapshot(value, now);
  assert.equal(result.cpu, null);
  assert.equal(result.tone, "unknown");
});
test("stale, future and offline samples hide all current utilization", () => {
  for (const timestamp of [now - FRESHNESS_MS - 1, now + 5000]) {
    const value = overview();
    value.current.samples[0].observed_at = new Date(timestamp).toISOString();
    const result = resourceSnapshot(value, now);
    assert.equal(result.stale, true);
    assert.equal(result.cpu, null);
    assert.equal(result.memory, null);
    assert.equal(result.rx, null);
  }
  assert.equal(resourceSnapshot(overview(), Infinity).stale, true);
});
test("empty or invalid counters are explicitly unknown", () => {
  const value = overview();
  value.current.samples = [];
  assert.equal(resourceSnapshot(value, now).tone, "unknown");
  const invalid = overview();
  invalid.current.samples[0].memory_available_bytes = 30 * 1024 ** 3;
  invalid.current.interval.cpu_busy_ratio = 2;
  const result = resourceSnapshot(invalid, now);
  assert.equal(result.memory, null);
  assert.equal(result.cpu, null);
  assert.equal(result.tone, "unknown");
});
test("interface errors and overdue work produce visible warnings", () => {
  const value = overview();
  value.current.interval.network_errors_delta = 1;
  assert.equal(resourceSnapshot(value, now).tone, "warning");
  assert.equal(resourceSnapshot(value, now).networkWarning, true);
  value.current.interval.network_errors_delta = 0;
  value.automation.overdue = true;
  assert.equal(resourceSnapshot(value, now).tone, "warning");
});
test("resource thresholds never label absent values healthy", () => {
  assert.equal(resourceTone(null), "unknown");
  assert.equal(resourceTone(0.2), "good");
  assert.equal(resourceTone(0.91), "warning");
  assert.equal(resourceTone(0.96), "critical");
  assert.equal(resourceTone(NaN), "unknown");
  assert.equal(resourceTone(-1), "unknown");
  assert.equal(resourceTone(2), "unknown");
  assert.equal(resourceTone(0.8, 256 * 1024 ** 2), "warning");
});

test("malformed nested statistics fail before rendering charts or tables", () => {
  const value = overview();
  value.runs = [
    {
      id: "bad",
      status: "completed",
      kind: "scheduled",
      reason_code: "",
      window: { from: "2026-10-30T00:00:00Z", to: "2026-10-31T00:00:00Z" },
      customer_summary: null,
      statistics: {
        coverage: "partial",
        summary: { operations: { secret: "not a number" }, error_events: 0, latency_ms: {} },
      },
    },
  ];
  assert.throws(() => parseDiagnosticsResponse(value));
});
test("byte formatting handles zero, sub-byte rates and missing measurements", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(0.5), "0.5 B");
  assert.equal(formatBytes(null), "Not measured");
  assert.equal(formatBytes(NaN), "Not measured");
  assert.equal(formatBytes(1024 ** 3), "1.0 GiB");
  assert.equal(formatDate("bad"), "Not recorded");
});
test("history charts retain gaps, zero errors and chronological order", () => {
  const run = (id, end, p95, status = "completed") => ({
    id,
    status,
    window: { from: "2026-10-30T00:00:00Z", to: end },
    statistics: { summary: { operations: 10, error_events: 0, latency_ms: { p50: null, p95 } } },
  });
  const points = historyPoints([
    run("late", "2026-10-31T06:00:00Z", 500),
    run("gap", "2026-10-31T05:00:00Z", null),
    run("skip", "2026-10-31T04:00:00Z", 100, "failed"),
  ]);
  assert.deepEqual(
    points.map((p) => p.id),
    ["gap", "late"]
  );
  assert.equal(points[0].p95, null);
  assert.equal(points[0].errors, 0);
});
test("disabled, malformed and valid API responses have distinct states", () => {
  assert.deepEqual(parseDiagnosticsResponse({ version: 1, enabled: false }), { version: 1, enabled: false });
  assert.equal(parseDiagnosticsResponse(overview()).version, 1);
  for (const invalid of [
    null,
    {},
    { ...overview(), runs: [{}] },
    { ...overview(), current: {} },
    { ...overview(), incidents: [{}] },
  ])
    assert.throws(() => parseDiagnosticsResponse(invalid));
});
