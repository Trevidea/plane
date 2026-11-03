// Browser-only, bounded diagnostics; no business request cancellation or retries.
export type WorkflowAction = "upload" | "playback" | "coaching-card" | "media-finalization";
type Budget = {
  warning_after_ms: number;
  finding_after_ms: number;
  tracking_expiry_ms: number;
  request_timeout_ms: null;
  measurement: "elapsed" | "inactivity";
};
export type WorkflowPolicy = {
  version: 2;
  revision: string;
  policy_id: string;
  notice_cooldown_ms: number;
  operations: Record<WorkflowAction, Budget>;
};
export type WorkflowNotice = {
  operation_id: string;
  action: WorkflowAction;
  occurred_at: string;
  elapsed_ms: number;
  status: "slow" | "completed-late" | "failed" | "unverified";
};
export type WorkflowOperation = {
  headers: Record<string, string>;
  complete: () => void;
  fail: () => void;
  unverified: () => void;
  abandon: () => void;
  progress: (bytes: number) => void;
};
const terminals = {
  upload: "acknowledged",
  playback: "ready",
  "coaching-card": "acknowledged",
  "media-finalization": "completed",
};
let active: { scope: string; observer: WorkflowObserver } | null = null;

export function operationEndpoint(workspace: string, project: string, view: string, id?: string) {
  const query = new URLSearchParams({ view });
  if (id) query.set("id", id);
  return `/api/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/diagnostics/operations/?${query}`;
}

export function validWorkflowPolicy(value: unknown): value is WorkflowPolicy {
  if (!value || typeof value !== "object") return false;
  const policy = value as WorkflowPolicy;
  return (
    policy.version === 2 &&
    typeof policy.policy_id === "string" &&
    /^[a-f0-9]{64}$/.test(policy.policy_id) &&
    Number.isInteger(policy.notice_cooldown_ms) &&
    policy.notice_cooldown_ms >= 1000 &&
    policy.notice_cooldown_ms <= 600000 &&
    (Object.keys(terminals) as WorkflowAction[]).every((kind) => {
      const budget = policy.operations?.[kind];
      return (
        budget &&
        budget.request_timeout_ms === null &&
        budget.measurement === (kind === "upload" ? "inactivity" : "elapsed") &&
        [budget.warning_after_ms, budget.finding_after_ms, budget.tracking_expiry_ms].every(Number.isInteger) &&
        budget.warning_after_ms >= 500 &&
        budget.warning_after_ms <= 60000 &&
        budget.finding_after_ms >= budget.warning_after_ms &&
        budget.tracking_expiry_ms >= budget.finding_after_ms &&
        budget.tracking_expiry_ms <= 3600000
      );
    })
  );
}

export class WorkflowObserver {
  private value: WorkflowNotice | null = null;
  private listeners = new Set<() => void>();
  private records = new Map<string, { started: number; uncertain: boolean; ignored: boolean; cleanup: () => void }>();
  private shownAt = -Infinity;
  private disposed = false;
  constructor(
    readonly workspace: string,
    readonly project: string,
    readonly policy: WorkflowPolicy,
    private send: (body: Record<string, unknown>) => void,
    private clock = {
      now: () => performance.now(),
      wall: () => Date.now(),
      visible: () => document.visibilityState === "visible" && navigator.onLine,
      id: () => crypto.randomUUID(),
      timer: (callback: () => void, ms: number) => setTimeout(callback, ms),
      clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    }
  ) {}
  getSnapshot = () => this.value;
  elapsed = (id: string) => {
    const record = this.records.get(id);
    return record
      ? Math.min(3600000, Math.max(0, this.clock.now() - record.started))
      : this.value?.operation_id === id
        ? this.value.elapsed_ms
        : 0;
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: WorkflowNotice | null) {
    this.value = value;
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        /* Read-only observers cannot change writes. */
      }
    });
  }
  ignore = () => {
    if (this.value) {
      const record = this.records.get(this.value.operation_id);
      if (record) record.ignored = true;
    }
    this.publish(null);
  };
  suspend = () => {
    this.records.forEach((record) => {
      record.uncertain = true;
    });
    if (this.value) this.publish({ ...this.value, status: "unverified" });
  };
  dispose = () => {
    this.disposed = true;
    this.records.forEach((record) => record.cleanup());
    this.records.clear();
    this.publish(null);
    this.listeners.clear();
  };
  start(action: WorkflowAction): WorkflowOperation | null {
    try {
      if (this.disposed || this.records.size >= 32 || !validWorkflowPolicy(this.policy)) return null;
      const budget = this.policy.operations[action],
        id = this.clock.id(),
        started = this.clock.now();
      const notice: WorkflowNotice = {
        operation_id: id,
        action,
        occurred_at: new Date(this.clock.wall()).toISOString(),
        elapsed_ms: 0,
        status: "slow",
      };
      let terminal = false,
        lastProgress = started,
        lastBytes = 0,
        stalled = false,
        stallCount = 0,
        warned = false;
      const emit = (event: string, duration = this.clock.now() - started, offset = 0) => {
        try {
          this.send({
            action,
            operation_id: id,
            event_name: event,
            occurred_at: notice.occurred_at,
            duration_ms: Math.min(3600000, Math.max(0, duration)),
            policy_id: this.policy.policy_id,
            offset_ms: Math.max(0, offset),
          });
        } catch {
          /* Telemetry cannot fail operations. */
        }
      };
      const show = (status: WorkflowNotice["status"]) => {
        const record = this.records.get(id);
        if (!record || record.ignored || !this.clock.visible() || (record.uncertain && status === "slow")) return;
        if (
          this.value?.operation_id === id ||
          (!this.value && this.clock.now() - this.shownAt >= this.policy.notice_cooldown_ms)
        ) {
          this.shownAt = this.clock.now();
          this.publish({
            ...notice,
            elapsed_ms: Math.max(0, this.clock.now() - started),
            status: record.uncertain ? "unverified" : status,
          });
        }
      };
      let timer: ReturnType<typeof setTimeout>, stallTimer: ReturnType<typeof setTimeout>;
      const arm = () => {
        timer = this.clock.timer(() => {
          show("slow");
          if (!warned && !this.records.get(id)?.uncertain && this.clock.visible()) {
            warned = true;
            emit(
              `${action}.waiting`,
              this.clock.now() - (action === "upload" ? lastProgress : started),
              action === "upload" ? lastProgress - started : 0
            );
          }
        }, budget.warning_after_ms);
        stallTimer = this.clock.timer(() => {
          if (!this.records.get(id)?.uncertain && this.clock.visible() && stallCount < 1) {
            stalled = true;
            stallCount++;
            emit(
              action === "upload" ? "upload.stalled" : `${action}.budget-exceeded`,
              this.clock.now() - (action === "upload" ? lastProgress : started),
              action === "upload" ? lastProgress - started : 0
            );
          }
        }, budget.finding_after_ms);
      };
      const finish = (result: "complete" | "failed" | "unverified") => {
        if (terminal || this.disposed) return;
        terminal = true;
        const certain = !this.records.get(id)?.uncertain && this.clock.visible();
        const state = certain ? result : "unverified";
        emit(
          `${action}.${state === "complete" ? terminals[action] : state === "failed" ? "failed" : "confirmation-unverified"}`
        );
        if (state === "failed" || state === "unverified") show(state);
        else if (this.value?.operation_id === id) show("completed-late");
        this.records.get(id)?.cleanup();
        this.records.delete(id);
      };
      arm();
      const expiry = this.clock.timer(() => finish("unverified"), budget.tracking_expiry_ms);
      this.records.set(id, {
        started,
        uncertain: false,
        ignored: false,
        cleanup: () => {
          this.clock.clear(timer);
          this.clock.clear(stallTimer);
          this.clock.clear(expiry);
        },
      });
      const safe = (callback: () => void) => () => {
        try {
          callback();
        } catch {
          /* Diagnostic APIs never replace business results. */
        }
      };
      return {
        headers: {
          "X-Kanavio-Operation-ID": id,
          "X-Request-ID": id,
          "X-Trace-ID": id,
          "X-Kanavio-Scope": `${this.workspace}/${this.project}`,
          "X-Kanavio-Operation-Kind": "other",
        },
        complete: safe(() => finish("complete")),
        fail: safe(() => finish("failed")),
        unverified: safe(() => finish("unverified")),
        abandon: safe(() => {
          if (terminal || this.disposed) return;
          terminal = true;
          emit(`${action}.confirmation-unverified`);
          this.records.get(id)?.cleanup();
          this.records.delete(id);
        }),
        progress: (bytes) => {
          try {
            if (terminal || this.disposed || action !== "upload" || !Number.isFinite(bytes) || bytes <= lastBytes)
              return;
            if (
              !stalled &&
              stallCount < 1 &&
              this.clock.now() - lastProgress >= budget.finding_after_ms &&
              !this.records.get(id)?.uncertain
            ) {
              stallCount++;
              emit("upload.stalled", this.clock.now() - lastProgress, lastProgress - started);
            }
            lastBytes = bytes;
            lastProgress = this.clock.now();
            stalled = false;
            this.clock.clear(timer);
            this.clock.clear(stallTimer);
            arm();
          } catch {
            /* Upload progress must never throw. */
          }
        },
      };
    } catch {
      return null;
    }
  }
}

export function activateWorkflowDiagnostics(observer: WorkflowObserver) {
  active?.observer.dispose();
  active = { scope: `${observer.workspace}/${observer.project}`, observer };
  return () => {
    if (active?.observer === observer) active = null;
    observer.dispose();
  };
}
export function beginWorkflow(workspace: string, project: string, action: WorkflowAction) {
  return active?.scope === `${workspace}/${project}` ? active.observer.start(action) : null;
}
export function beginCurrentWorkflow(action: WorkflowAction) {
  return active?.observer.start(action) || null;
}

export function observeVideoReadiness(video: HTMLVideoElement, autoPlay: boolean) {
  let operation: WorkflowOperation | null = null,
    frame: number | null = null,
    settled = false;
  const ready = () => {
    if (!operation || settled || video.readyState < 2) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      if (frame === null)
        frame = video.requestVideoFrameCallback(() => {
          frame = null;
          if (!settled) {
            settled = true;
            operation?.complete();
          }
        });
    } else {
      settled = true;
      operation.complete();
    }
  };
  const start = () => {
    if (!operation && !settled) operation = beginCurrentWorkflow("playback");
    ready();
  };
  const fail = () => {
    if (!settled) {
      settled = true;
      operation?.fail();
    }
  };
  video.addEventListener("play", start);
  video.addEventListener("loadeddata", ready);
  video.addEventListener("playing", ready);
  video.addEventListener("error", fail);
  if (autoPlay || !video.paused) start();
  return {
    fail,
    dispose: () => {
      settled = true;
      if (frame !== null) video.cancelVideoFrameCallback(frame);
      operation?.abandon();
      video.removeEventListener("play", start);
      video.removeEventListener("loadeddata", ready);
      video.removeEventListener("playing", ready);
      video.removeEventListener("error", fail);
    },
  };
}
export function failWorkflow(operation: WorkflowOperation | null, error: unknown) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status && status >= 400 && status < 500 && status !== 408) operation?.fail();
  else operation?.unverified();
}
