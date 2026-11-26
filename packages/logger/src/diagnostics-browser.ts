/* global globalThis */
import { decodeRosterUI } from "./roster-events.ts";
import type { RosterAction, RosterResult } from "./roster-events.ts";

let rosterWindow = 0;
let rosterSent = 0;
export type RosterIssue = {
  operationId: string;
  path: string;
  observation: { action: RosterAction; result: RosterResult; duration_ms: number; inactivity_ms?: number };
};
let latestRosterIssue: RosterIssue | null = null;
const rosterIssueListeners = new Set<() => void>();
export const getRosterIssue = () => latestRosterIssue;
export function subscribeRosterIssue(listener: () => void) {
  rosterIssueListeners.add(listener);
  return () => {
    rosterIssueListeners.delete(listener);
  };
}

export function beginRosterUI(action: RosterAction) {
  const noTrack = {
    headers: {} as Record<string, string>,
    finish: (_result: RosterResult) => {},
    progress: (_loaded: number) => {},
  };
  try {
    if (typeof window === "undefined" || !globalThis.crypto?.getRandomValues) return noTrack;
    const id = `enr-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const started = performance.now();
    const path = window.location?.pathname || "";
    let terminal = false;
    let loaded = 0;
    let lastProgress = started;
    let longestGap = 0;
    const progress = (next: number) => {
      if (terminal || action !== "import" || !Number.isFinite(next) || next <= loaded) return;
      const now = performance.now();
      longestGap = Math.max(longestGap, now - lastProgress);
      lastProgress = now;
      loaded = next;
    };
    const interrupted = () => finish("interrupted");
    const finish = (result: RosterResult) => {
      if (terminal) return;
      terminal = true;
      try {
        window.removeEventListener("pagehide", interrupted);
        const now = Date.now();
        if (now - rosterWindow >= 60_000) {
          rosterWindow = now;
          rosterSent = 0;
        }
        const settled = performance.now();
        const elapsed = settled - started;
        const event = decodeRosterUI({
          event: "roster.ui.completed",
          action,
          result,
          operation_id: id,
          duration_ms: Math.min(3_600_000, Math.max(0, elapsed)),
          ...(action === "import" && result === "confirmed" && loaded > 0 && elapsed <= 3_600_000
            ? { inactivity_ms: Math.max(longestGap, settled - lastProgress) }
            : {}),
        });
        if (event && path && action !== "export" && action !== "notice-read") {
          const { action, result, duration_ms, inactivity_ms } = event;
          latestRosterIssue = {
            operationId: id,
            path,
            observation: { action, result, duration_ms, ...(inactivity_ms !== undefined ? { inactivity_ms } : {}) },
          };
          for (const listener of rosterIssueListeners) listener();
        }
        if (!event || rosterSent >= 40) return;
        rosterSent++;
        void fetch("/diagnostics/events/", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          keepalive: true,
          headers: { "Content-Type": "application/json", "X-Request-ID": id },
          body: JSON.stringify(event),
        }).catch(() => undefined);
      } catch {
        /* Diagnostics cannot change the UI outcome. */
      }
    };
    window.addEventListener("pagehide", interrupted, { once: true });
    return { headers: { "X-Request-ID": id, "X-Trace-ID": id, "X-Kanavio-Operation-ID": id }, finish, progress };
  } catch {
    return noTrack;
  }
}

export function rosterUIFailure(error: unknown): RosterResult {
  const candidate = error as { code?: string; response?: { status?: number } } | null;
  if (candidate?.code === "ERR_CANCELED") return "interrupted";
  const status = candidate?.response?.status;
  return status && status >= 400 && status < 500 && status !== 408 && status !== 429 ? "failed" : "unverified";
}
const reported = new WeakSet<object>();
let windowStart = 0;
let sent = 0;
const ERROR_TYPES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
]);
const listeners = new Map<string, { count: number; stop: () => void }>();

/** Tiny, best-effort error transport. Never serialize the Error or current page. */
export function reportFrontendFailure(error: unknown, basePath = "", event = "ui.error.boundary") {
  try {
    if (typeof window === "undefined" || !globalThis.fetch) return;
    const endpoint = new URL(`${basePath.replace(/\/$/, "")}/diagnostics/events/`, window.location.origin);
    if (endpoint.origin !== window.location.origin || !endpoint.pathname.endsWith("/diagnostics/events/")) return;
    if (error && typeof error === "object" && reported.has(error)) return;
    const now = Date.now();
    if (now - windowStart >= 60000) {
      windowStart = now;
      sent = 0;
    }
    if (sent >= 3) return;
    const name = error && typeof error === "object" && "name" in error ? error.name : null;
    const errorType = typeof name === "string" && ERROR_TYPES.has(name) ? name : "Other";
    const requestId = globalThis.crypto.randomUUID();
    sent++;
    if (error && typeof error === "object") reported.add(error);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    void fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
      headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
      body: JSON.stringify({ event, error_type: errorType, request_id: requestId }),
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
  } catch {
    /* Even unsupported browser APIs must not break the error fallback. */
  }
}

export function installFrontendDiagnostics(basePath = "") {
  let current = listeners.get(basePath);
  if (!current) {
    const onError = (event: ErrorEvent) => reportFrontendFailure(event.error, basePath, "ui.error.unhandled");
    const onReject = (event: PromiseRejectionEvent) =>
      reportFrontendFailure(event.reason, basePath, "ui.error.rejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    current = {
      count: 0,
      stop: () => {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onReject);
      },
    };
    listeners.set(basePath, current);
  }
  current.count++;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (--current.count === 0) {
      current.stop();
      listeners.delete(basePath);
    }
  };
}
