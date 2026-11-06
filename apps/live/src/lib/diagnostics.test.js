import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  diagnostic,
  diagnosticRequest,
  diagnosticHeaders,
  diagnosticCall,
  createDiagnosticContext,
  observeLiveOperation,
  observeWebSocket,
  legacyLiveLog,
} from "./diagnostics.ts";

test("websocket context and document operations keep correlation without serializing content", async (t) => {
  const lines = [];
  t.mock.method(console, "info", (line) => lines.push(JSON.parse(line)));
  const headers = { cookie: "private", "x-request-id": "socket-1" };
  const socket = new EventEmitter();
  const context = observeWebSocket(socket, headers);
  assert.equal(context, createDiagnosticContext(headers));
  const result = { document: "private" };
  assert.equal(await observeLiveOperation("document.load.completed", context, async () => result), result);
  const original = new Error("private-document-and-token");
  await assert.rejects(
    observeLiveOperation("document.store.completed", context, async () => {
      throw original;
    }),
    (actual) => actual === original
  );
  socket.emit("close", 1006, Buffer.from("private-close-reason"));
  assert.equal(lines.length, 4);
  assert.ok(lines.every((record) => record.request_id === "socket-1"));
  assert.doesNotMatch(JSON.stringify(lines), /private/);
});

test("legacy Live output honors WARN and never serializes values", (t) => {
  const lines = [];
  t.mock.method(console, "info", (line) => lines.push(JSON.parse(line)));
  const old = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "WARN";
  try {
    legacyLiveLog("info", "LIVE_000000000000", { private: "token" });
    legacyLiveLog("warn", "LIVE_111111111111", { private: "token" });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, "warn");
    assert.doesNotMatch(JSON.stringify(lines), /private/);
  } finally {
    if (old === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = old;
  }
});

test("cache observations preserve values/errors and internal correlation", async (t) => {
  const lines = [];
  t.mock.method(console, "info", (line) => lines.push(JSON.parse(line)));
  const error = new Error("private key and value");
  const response = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: () => {} });
  let work;
  diagnosticRequest({ path: "/fixture", headers: { "x-request-id": "internal-1" } }, response, () => {
    work = (async () => {
      assert.equal(diagnosticHeaders()["x-request-id"], "internal-1");
      const result = { value: "private" };
      assert.equal(await diagnosticCall(async () => result, "get"), result);
      await assert.rejects(
        diagnosticCall(async () => {
          throw error;
        }, "set"),
        (actual) => actual === error
      );
    })();
  });
  await work;
  assert.equal(lines[0].event_name, "cache.request.completed");
  assert.equal(lines[0].request_id, "internal-1");
  assert.doesNotMatch(JSON.stringify(lines), /private/);
});

test("Live request logs are correlated, private and emitted once on finish/close", (t) => {
  const lines = [];
  t.mock.method(console, "info", (line) => lines.push(JSON.parse(line)));
  const response = Object.assign(new EventEmitter(), { statusCode: 403, setHeader: () => {} });
  const request = {
    path: "/private-document?token=private",
    headers: { "x-request-id": "live-1", authorization: "private" },
  };
  let next = 0;
  diagnosticRequest(request, response, () => {
    next++;
    diagnostic("cache.connection.retry", { attempt: 1, password: "private" });
  });
  response.emit("finish");
  response.emit("close");
  assert.equal(next, 1);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.request_id === "live-1"));
  assert.equal(lines[1].attributes.status_code, 403);
  assert.doesNotMatch(JSON.stringify(lines), /private/);
});

test("Live sink failures do not prevent routing", (t) => {
  t.mock.method(console, "info", () => {
    throw Error("sink down");
  });
  const response = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: () => {} });
  let called = false;
  diagnosticRequest({ path: "/fixture", headers: {} }, response, () => {
    called = true;
  });
  response.emit("finish");
  assert.equal(called, true);
});
