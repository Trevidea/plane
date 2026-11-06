/* global globalThis */
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
