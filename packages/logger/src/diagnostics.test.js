import assert from "node:assert/strict";
import test from "node:test";
import { createFrontendReceiver } from "./diagnostics-server.ts";
import { beginRosterUI, reportFrontendFailure, installFrontendDiagnostics } from "./diagnostics-browser.ts";

const payload = {
  event: "ui.error.boundary",
  error_type: "TypeError",
  request_id: "00000000-0000-4000-8000-000000000001",
};
const request = (body = payload, origin = "https://school.test") =>
  new Request("https://school.test/diagnostics/events/", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("roster confirmations share the request ID and report one interruption without form data", async (t) => {
  const old = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(() => {
    globalThis.window = old;
  });
  const packets = [];
  const logs = [];
  t.mock.method(console, "info", (line) => logs.push(JSON.parse(line)));
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    packets.push(options);
    return new Response(null, { status: 204 });
  });
  const operation = beginRosterUI("import");
  globalThis.window.dispatchEvent(new Event("pagehide"));
  operation.finish("confirmed");
  assert.equal(packets.length, 1);
  const packet = JSON.parse(packets[0].body);
  const receive = createFrontendReceiver("plane-web");
  const accepted = request(packet);
  accepted.headers.set("X-Request-ID", operation.headers["X-Kanavio-Operation-ID"]);
  assert.equal((await receive(accepted)).status, 204);
  assert.deepEqual(logs[0].attributes, { action: "import", result: "interrupted" });
  assert.equal(logs[0].outcome, "unknown");
  assert.equal((await receive(request({ ...packet, email: "private@example.test" }))).status, 400);
});

test("import timing tracks byte progress and the final receipt gap, not total time", async (t) => {
  const old = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(() => { globalThis.window = old; });
  let now = 100;
  t.mock.method(globalThis.performance, "now", () => now);
  const packets = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    packets.push(JSON.parse(options.body));
    return new Response(null, { status: 204 });
  });
  const active = beginRosterUI("import");
  now += 500;
  active.progress(100);
  now += 2_000;
  active.progress(100); // Duplicate callback is not progress.
  now += 1_000;
  active.progress(200);
  now += 1_200;
  active.finish("confirmed");
  assert.equal(packets[0].duration_ms, 4_700);
  assert.equal(packets[0].inactivity_ms, 3_000);
  assert.ok(!JSON.stringify(packets[0]).includes("loaded"));
  const logs = [];
  t.mock.method(console, "info", (line) => logs.push(JSON.parse(line)));
  const receive = createFrontendReceiver("plane-web");
  const message = request(packets[0]);
  message.headers.set("X-Request-ID", packets[0].operation_id);
  assert.equal((await receive(message)).status, 204);
  assert.equal(logs[0].attributes.roster_timing, "import-inactivity.v1");
  assert.equal(logs[0].attributes.roster_inactivity_ms, 3000);
  beginRosterUI("import").finish("confirmed");
  assert.equal(packets[1].inactivity_ms, undefined);
  const unverified = beginRosterUI("import");
  unverified.progress(1);
  unverified.finish("unverified");
  assert.equal(packets[2].inactivity_ms, undefined);
});

test("frontend ingestion accepts only typed same-origin metadata and bounds rate/size", async (t) => {
  const logs = [];
  t.mock.method(console, "info", (line) => logs.push(JSON.parse(line)));
  const receive = createFrontendReceiver("plane-web");
  assert.equal((await receive(request())).status, 204);
  assert.equal(logs[0].request_id, payload.request_id);
  assert.equal(logs[0].attributes.error_code, "FRONTEND_TYPEERROR");
  assert.equal((await receive(request(payload, "https://other.test"))).status, 403);
  assert.equal((await receive(request({ ...payload, message: "password=private" }))).status, 400);
  assert.equal((await receive(request({ ...payload, extra: "x".repeat(1100) }))).status, 413);
  const mismatched = request();
  mismatched.headers.set("X-Request-ID", "different-id");
  assert.equal((await receive(mismatched)).status, 400);
  assert.equal((await receive(request({ ...payload, request_id: "-".repeat(36) }))).status, 400);
  for (let i = 0; i < 40; i++) await receive(request());
  assert.equal((await receive(request())).status, 429);
  assert.doesNotMatch(JSON.stringify(logs), /private/);
});

test("sink failures cannot change the accepted frontend response", async (t) => {
  t.mock.method(console, "info", () => {
    throw Error("disk full");
  });
  assert.equal((await createFrontendReceiver("plane-admin")(request())).status, 204);
});

test("browser reports do not serialize messages and listeners are reference-counted", async (t) => {
  const old = globalThis.window;
  const events = new EventTarget();
  events.location = { origin: "https://school.test" };
  globalThis.window = events;
  t.after(() => {
    globalThis.window = old;
  });
  const packets = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    packets.push(JSON.parse(options.body));
    return new Response(null, { status: 204 });
  });
  const first = installFrontendDiagnostics("/spaces");
  const second = installFrontendDiagnostics("/spaces");
  const error = new TypeError("private password and customer name");
  reportFrontendFailure(error, "/spaces");
  reportFrontendFailure(error, "/spaces");
  first();
  const rejection = new Event("unhandledrejection");
  rejection.reason = new Error("private token");
  events.dispatchEvent(rejection);
  second();
  second();
  const last = new Event("error");
  last.error = new Error("private");
  events.dispatchEvent(last);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(packets.length, 2);
  assert.doesNotMatch(JSON.stringify(packets), /private|password|customer/);
  assert.equal(packets[1].event, "ui.error.rejection");
});
