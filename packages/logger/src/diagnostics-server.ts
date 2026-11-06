/* global globalThis */
import { randomUUID } from "node:crypto";

type FrontendService = "plane-web" | "plane-admin" | "plane-space";
const TYPES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "Other",
]);
const clock = `frontend-runtime:${randomUUID()}`;

export function emitFrontendDiagnostic(
  service: FrontendService,
  event: string,
  errorCode?: string,
  requestId?: string
) {
  try {
    if (process.env.LOG_LEVEL?.toUpperCase() === "ERROR" && !errorCode) return;
    console.info(
      JSON.stringify({
        schema_version: "1.0",
        timestamp: new Date().toISOString(),
        service,
        environment: process.env.KANAVIO_ENVIRONMENT || "production",
        scope: "unscoped",
        kind: "other",
        record_id: randomUUID(),
        clock_id: clock,
        event_name: event,
        level: errorCode ? "error" : "info",
        outcome: errorCode ? "error" : "ok",
        ...(requestId ? { request_id: requestId, operation_id: requestId, trace_id: requestId } : {}),
        attributes: errorCode ? { error_code: errorCode } : {},
      })
    );
  } catch {
    /* Do not interfere with rendering or process exit. */
  }
}

export function createFrontendReceiver(service: FrontendService) {
  let windowStart = 0;
  let received = 0;
  return async (request: Request) => {
    const origin = request.headers.get("origin");
    try {
      if (
        !origin ||
        new URL(origin).host !== new URL(request.url).host ||
        !["http:", "https:"].includes(new URL(origin).protocol)
      )
        return new Response(null, { status: 403 });
      if (request.method !== "POST" || request.headers.get("content-type")?.split(";")[0] !== "application/json")
        return new Response(null, { status: 415 });
      const now = Date.now();
      if (now - windowStart >= 60000) {
        windowStart = now;
        received = 0;
      }
      if (received >= 32) return new Response(null, { status: 429 });
      received++;
      const reader = request.body?.getReader();
      if (!reader) return new Response(null, { status: 400 });
      const chunks: Uint8Array[] = [];
      let length = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void reader.cancel().catch(() => undefined);
          reject(new Error("body-timeout"));
        }, 2000);
      });
      try {
        while (true) {
          const chunk = await Promise.race([reader.read(), expired]);
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 1024 || chunks.length >= 64) {
            void reader.cancel().catch(() => undefined);
            return new Response(null, { status: 413 });
          }
          chunks.push(chunk.value);
        }
      } finally {
        clearTimeout(timer);
        reader.releaseLock();
      }
      const bytes = new Uint8Array(length);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (
        !body ||
        typeof body !== "object" ||
        Object.keys(body).sort().join(",") !== "error_type,event,request_id" ||
        !["ui.error.boundary", "ui.error.unhandled", "ui.error.rejection"].includes(body.event) ||
        typeof body.error_type !== "string" ||
        !TYPES.has(body.error_type) ||
        typeof body.request_id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.request_id) ||
        (request.headers.has("x-request-id") && request.headers.get("x-request-id") !== body.request_id)
      )
        return new Response(null, { status: 400 });
      emitFrontendDiagnostic(service, body.event, `FRONTEND_${body.error_type.toUpperCase()}`, body.request_id);
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    } catch {
      return new Response(null, { status: 400 });
    }
  };
}

export function registerFrontendRuntime(service: FrontendService) {
  const state = globalThis as typeof globalThis & { __kanavioDiagnosticRuntimes?: Set<string> };
  const active = (state.__kanavioDiagnosticRuntimes ||= new Set());
  if (active.has(service)) return;
  active.add(service);
  emitFrontendDiagnostic(service, "service.initialized");
  process.on("uncaughtExceptionMonitor", () => emitFrontendDiagnostic(service, "service.failed", "UNCAUGHT_EXCEPTION"));
  process.once("exit", (code) =>
    emitFrontendDiagnostic(service, "service.stopping", code ? "PROCESS_EXIT_FAILED" : undefined)
  );
}
