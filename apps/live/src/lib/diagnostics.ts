import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export type DiagnosticContext = Record<string, string>;
type Context = DiagnosticContext;
const contexts = new AsyncLocalStorage<Context>();
const headerContexts = new WeakMap<object, Context>();
const identity = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const clock = `plane-live:${randomUUID()}`;

/** Only typed operational metadata; never URLs, documents, Redis keys or errors. */
export function diagnostic(
  event: string,
  fields: Record<string, unknown> = {},
  outcome = "ok",
  duration?: number,
  detail = false,
  warning = false
) {
  try {
    if (!identity(event)) return;
    const level = outcome === "error" ? "error" : warning ? "warn" : detail ? "debug" : "info";
    const configured = (process.env.LOG_LEVEL || "INFO").toUpperCase();
    if (configured === "ERROR" && level !== "error") return;
    if (["WARN", "WARNING"].includes(configured) && level !== "error" && level !== "warn") return;
    if (level === "debug" && !["DEBUG", "TRACE"].includes(configured)) return;
    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (
        ["status_code", "attempt", "connections"].includes(key) &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0
      )
        attributes[key] = value;
      if (["error_code", "dependency", "action"].includes(key) && identity(value)) attributes[key] = value;
    }
    console.info(
      JSON.stringify({
        schema_version: "1.0",
        timestamp: new Date().toISOString(),
        service: "plane-live",
        record_id: randomUUID(),
        clock_id: clock,
        environment: process.env.KANAVIO_ENVIRONMENT || "production",
        scope: "unscoped",
        kind: "other",
        ...contexts.getStore(),
        event_name: event,
        level,
        outcome,
        attributes,
        ...(typeof duration === "number" && Number.isFinite(duration) && duration >= 0
          ? { duration_ms: duration }
          : {}),
      })
    );
  } catch {
    /* Diagnostics cannot affect collaboration or shutdown. */
  }
}

export function legacyLiveLog(level: "info" | "warn" | "error" | "debug", code: string, ..._values: unknown[]) {
  diagnostic(
    level === "error"
      ? "collaboration.runtime.failed"
      : level === "warn"
        ? "collaboration.runtime.warning"
        : "collaboration.runtime.detail",
    { error_code: code },
    level === "error" ? "error" : "unknown",
    undefined,
    level === "debug" || level === "info",
    level === "warn"
  );
}

export function createDiagnosticContext(headers: Record<string, unknown>): DiagnosticContext {
  const existing = headerContexts.get(headers);
  if (existing) return existing;
  const read = (name: string) => (identity(headers[name]) ? (headers[name] as string) : undefined);
  const requestId = read("x-request-id") || randomUUID();
  const scope = headers["x-kanavio-scope"];
  const kind = read("x-kanavio-operation-kind");
  const context = {
    request_id: requestId,
    trace_id: read("x-trace-id") || requestId,
    operation_id: read("x-kanavio-operation-id") || requestId,
    environment: read("x-kanavio-environment") || process.env.KANAVIO_ENVIRONMENT || "production",
    kind: kind === "tag" || kind === "replay" ? kind : "other",
    scope: typeof scope === "string" && /^[A-Za-z0-9_.:/|\-]{1,400}$/.test(scope) ? scope : "unscoped",
  };
  headerContexts.set(headers, context);
  return context;
}

export async function observeLiveOperation<T>(
  event: string,
  context: DiagnosticContext | undefined,
  run: () => Promise<T>
): Promise<T> {
  return contexts.run(context || contexts.getStore() || createDiagnosticContext({}), async () => {
    const started = performance.now();
    let failed = false;
    try {
      return await run();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      diagnostic(
        event,
        failed ? { error_code: "COLLABORATION_OPERATION_FAILED" } : {},
        failed ? "error" : "ok",
        performance.now() - started
      );
    }
  });
}

export function observeWebSocket(
  socket: { once: (event: string, callback: (code: number) => void) => unknown },
  headers: Record<string, unknown>
) {
  const context = createDiagnosticContext(headers);
  const started = performance.now();
  contexts.run(context, () => diagnostic("collaboration.connection.accepted"));
  socket.once("close", (code) =>
    contexts.run(context, () =>
      diagnostic(
        "collaboration.connection.closed",
        { action: code === 1000 ? "normal" : code === 1001 ? "going-away" : "abnormal" },
        code === 1000 || code === 1001 ? "ok" : "unknown",
        performance.now() - started
      )
    )
  );
  return context;
}

export function diagnosticHeaders() {
  const context = contexts.getStore();
  if (!context) return {};
  return Object.fromEntries(
    ["request_id", "trace_id", "operation_id", "scope", "kind", "environment"].map((key) => [
      {
        request_id: "x-request-id",
        trace_id: "x-trace-id",
        operation_id: "x-kanavio-operation-id",
        scope: "x-kanavio-scope",
        kind: "x-kanavio-operation-kind",
        environment: "x-kanavio-environment",
      }[key]!,
      context[key],
    ])
  );
}

export async function diagnosticCall<T>(run: () => Promise<T>, action: string) {
  const started = performance.now();
  let outcome = "ok";
  try {
    return await run();
  } catch (error) {
    outcome = "error";
    throw error;
  } finally {
    const elapsed = performance.now() - started;
    diagnostic(
      "cache.request.completed",
      { action, dependency: "redis", ...(outcome === "error" ? { error_code: "REDIS_REQUEST_FAILED" } : {}) },
      outcome,
      elapsed,
      elapsed < 500
    );
  }
}

export const diagnosticRequest: RequestHandler = (request, response, next) => {
  const started = performance.now();
  const context = createDiagnosticContext(request.headers);
  let finished = false;
  response.setHeader("X-Request-ID", context.request_id);
  response.setHeader("X-Trace-ID", context.trace_id);
  const finish = (closed: boolean) => {
    if (finished || request.path.startsWith("/health")) return;
    finished = true;
    contexts.run(context, () =>
      diagnostic(
        "api.request.completed",
        { status_code: response.statusCode },
        closed ? "cancelled" : response.statusCode >= 400 ? "error" : "ok",
        performance.now() - started
      )
    );
  };
  response.once("finish", () => finish(false));
  response.once("close", () => finish(true));
  contexts.run(context, next);
};
