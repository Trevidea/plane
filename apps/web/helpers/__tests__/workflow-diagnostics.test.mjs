import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { build } = require(process.env.ESBUILD_MODULE || "esbuild");
const directory = await mkdtemp(join(tmpdir(), "workflow-observer-"));
const output = join(directory, "observer.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("../workflow-diagnostics.ts", import.meta.url))],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
});
const { WorkflowObserver, activateWorkflowDiagnostics, beginWorkflow, validWorkflowPolicy, observeVideoReadiness } =
  await import(pathToFileURL(output));
await rm(directory, { recursive: true, force: true });
const policy = {
  version: 2,
  revision: "2.0.0",
  policy_id: "a".repeat(64),
  notice_cooldown_ms: 60000,
  operations: Object.fromEntries(
    ["upload", "playback", "coaching-card", "media-finalization"].map((kind) => [
      kind,
      {
        warning_after_ms: kind === "upload" ? 15000 : 3000,
        finding_after_ms: kind === "upload" ? 30000 : 10000,
        tracking_expiry_ms: 3600000,
        request_timeout_ms: null,
        measurement: kind === "upload" ? "inactivity" : "elapsed",
      },
    ])
  ),
};
function setup() {
  let now = 0,
    counter = 0,
    visible = true;
  const timers = new Map(),
    events = [];
  const clock = {
    now: () => now,
    wall: () => 1793592000000 + now,
    visible: () => visible,
    id: () => `11111111-1111-4111-8111-${String(++counter).padStart(12, "0")}`,
    timer: (callback, delay) => {
      const id = ++counter;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clear: (id) => timers.delete(id),
  };
  const observer = new WorkflowObserver("workspace", "program", policy, (event) => events.push(event), clock);
  const advance = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(id);
        timer.callback();
      }
  };
  return {
    observer,
    clock,
    events,
    timers,
    advance,
    hide: () => {
      visible = false;
      observer.suspend();
    },
    show: () => {
      visible = true;
    },
  };
}
test("large progressing uploads are not marked slow by total duration", () => {
  const value = setup(),
    operation = value.observer.start("upload");
  for (let count = 1; count <= 100; count++) {
    value.advance(10000);
    operation.progress(count * 100);
  }
  assert.equal(value.observer.getSnapshot(), null);
  operation.complete();
  assert.deepEqual(
    value.events.map((event) => event.event_name),
    ["upload.acknowledged"]
  );
  assert.equal(value.events[0].duration_ms, 1000000);
  assert.equal(value.timers.size, 0);
});
test("upload warning and stalled evidence use inactivity; progress does not retry writes", () => {
  const value = setup(),
    operation = value.observer.start("upload");
  value.advance(15000);
  assert.equal(value.observer.getSnapshot().status, "slow");
  value.advance(15000);
  assert.equal(value.events[1].event_name, "upload.stalled");
  assert.equal(value.events[1].duration_ms, 30000);
  operation.progress(100);
  operation.complete();
  operation.complete();
  assert.equal(value.observer.getSnapshot().status, "completed-late");
  assert.equal(value.events.filter((event) => event.event_name === "upload.acknowledged").length, 1);
});
for (const action of ["playback", "coaching-card", "media-finalization"])
  test(`${action} has one terminal and Ignore never cancels it`, () => {
    const value = setup(),
      operation = value.observer.start(action);
    value.advance(3000);
    assert.equal(value.observer.getSnapshot().action, action);
    value.observer.ignore();
    operation.complete();
    operation.fail();
    assert.equal(value.observer.getSnapshot(), null);
    assert.equal(value.events.length, 2);
    assert.equal(value.timers.size, 0);
  });
test("hidden completion and expiry are unverified, never successful durations", () => {
  const value = setup(),
    operation = value.observer.start("playback");
  value.hide();
  value.advance(5000);
  operation.complete();
  assert.equal(value.events[0].event_name, "playback.confirmation-unverified");
  value.show();
  value.observer.start("media-finalization");
  value.advance(3600000);
  assert.equal(value.events.at(-1).event_name, "media-finalization.confirmation-unverified");
});
test("scope cleanup and cancellation do not show a failure popup or accept stale actions", () => {
  const value = setup(),
    release = activateWorkflowDiagnostics(value.observer);
  assert.equal(beginWorkflow("other", "program", "upload"), null);
  const operation = beginWorkflow("workspace", "program", "upload");
  operation.abandon();
  assert.equal(value.observer.getSnapshot(), null);
  release();
  assert.equal(value.timers.size, 0);
  assert.equal(beginWorkflow("workspace", "program", "upload"), null);
  assert.equal(value.observer.start("upload"), null);
});
test("invalid policy and telemetry exceptions cannot break operations", () => {
  assert.equal(validWorkflowPolicy({ ...policy, version: 1 }), false);
  const value = setup();
  const observer = new WorkflowObserver(
    "w",
    "p",
    policy,
    () => {
      throw Error("sink failed");
    },
    value.clock
  );
  assert.doesNotThrow(() => observer.start("coaching-card").complete());
});

test("inactivity evidence retains the actual gap offset and reporting uses current elapsed time", () => {
  const value = setup(),
    operation = value.observer.start("upload");
  value.advance(10000);
  operation.progress(100);
  value.advance(30000);
  const event = value.events.find((item) => item.event_name === "upload.stalled");
  assert.equal(event.offset_ms, 10000);
  assert.equal(event.duration_ms, 30000);
  assert.equal(value.observer.elapsed(event.operation_id), 40000);
  operation.abandon();
});
test("playback completes only at an actual frame, not metadata", () => {
  const value = setup(),
    release = activateWorkflowDiagnostics(value.observer);
  let frame;
  const video = new EventTarget();
  Object.assign(video, {
    readyState: 1,
    paused: false,
    requestVideoFrameCallback: (callback) => {
      frame = callback;
      return 1;
    },
    cancelVideoFrameCallback: () => {},
  });
  const monitor = observeVideoReadiness(video, true);
  video.dispatchEvent(new Event("loadeddata"));
  assert.equal(value.events.length, 0);
  video.readyState = 2;
  video.dispatchEvent(new Event("loadeddata"));
  assert.equal(value.events.length, 0);
  frame();
  assert.equal(value.events[0].event_name, "playback.ready");
  monitor.dispose();
  release();
});
