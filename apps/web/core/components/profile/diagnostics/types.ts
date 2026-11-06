export type DiagnosticsRun = {
  id: string;
  kind: string;
  status: string;
  reason_code: string;
  created_at: string;
  updated_at: string;
  window: { from: string; to: string };
  report_available: boolean;
  customer_summary: {
    headline: string;
    status: string;
    actions: { check_id: string; title: string; severity: string }[];
  } | null;
  statistics: {
    coverage: string;
    summary: {
      operations: number;
      error_events: number;
      latency_ms: { p50: number | null; p95: number | null; p99: number | null };
    };
  } | null;
};

export type DiagnosticsIncident = {
  id: string;
  analysis_id?: string;
  reference: string;
  action: string;
  received_at: string;
  analysis_status: string;
  analysis_reason: string;
  submission_status: string;
  submission_reason: string | null;
  support_reference: string | null;
  evidence_preservation: string;
  support_update?: {
    checked_at: number;
    update: { status: string; message: string; updated_at: string } | null;
  } | null;
};

export type DiagnosticsObservation = {
  observed_at: string;
  memory_total_bytes: number | null;
  memory_available_bytes: number | null;
  storage_total_bytes: number | null;
  storage_available_bytes: number | null;
  missing: string[];
  activity: { status: string; live_streams: number | null; media_jobs: number | null };
};

export type DiagnosticsOverview = {
  version: 1;
  export_enabled?: boolean;
  observed_at: string;
  current: {
    status: string;
    samples: DiagnosticsObservation[];
    interval: {
      seconds: number | null;
      cpu_busy_ratio: number | null;
      network_rx_bytes_per_second: number | null;
      network_tx_bytes_per_second: number | null;
      network_errors_delta: number | null;
      network_dropped_delta: number | null;
    };
  };
  pipeline?: {
    version: 1;
    observed_at: string;
    collection: {
      state: string;
      observed_at: string | null;
      sources: number | null;
      failed_sources: number | null;
      limited_sources: number | null;
      reason: string;
    };
    analysis: { state: string; pending: number | null; failed_recent: number | null; reason: string };
    delivery: { state: string; pending: number | null; blocked: number | null; reason: string };
  };
  automation: {
    enabled: boolean;
    status: string;
    daily_at?: string;
    timezone?: string;
    pending_runs: number;
    overdue: boolean;
    last_completed_at: string | null;
    last_run_reason?: string;
  };
  runs: DiagnosticsRun[];
  incidents: DiagnosticsIncident[];
  sharing_enabled: boolean;
};

export type DiagnosticsResponse = DiagnosticsOverview | { version: 1; enabled: false };
export type HealthTone = "good" | "warning" | "critical" | "unknown";
