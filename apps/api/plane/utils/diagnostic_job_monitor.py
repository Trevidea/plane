"""Bounded process-local task observations; never a task cancellation mechanism."""

import os
import threading
import time


class JobMonitor:
    def __init__(self, emit, *, clock=time.perf_counter):
        self.emit, self.clock = emit, clock
        self.lock = threading.Lock()
        self.records = {}
        self.thread = None
        self.pid = os.getpid()

    def start(self, identity, context, attempt, deadline_ms=None, retry_limit=None):
        # Celery prefork children must never inherit a locked parent registry.
        if self.pid != os.getpid():
            self.lock, self.records, self.thread = threading.Lock(), {}, None
            self.pid = os.getpid()
        with self.lock:
            if len(self.records) >= 64:
                return
            self.records[identity] = {
                "started": self.clock(),
                "context": dict(context),
                "attempt": attempt,
                "deadline_ms": deadline_ms,
                "retry_limit": retry_limit,
                "count": 0,
            }
            if self.thread is None or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._loop, daemon=True, name="diagnostic-task-runtime")
                self.thread.start()

    def finish(self, identity):
        with self.lock:
            self.records.pop(identity, None)

    def sample(self):
        with self.lock:
            for record in self.records.values():
                # Cap each task's output at 60 samples; absence afterward is unknown.
                if record["count"] >= 60:
                    continue
                record["count"] += 1
                elapsed = max(0, (self.clock() - record["started"]) * 1000)
                fields = {"attempt": record["attempt"], "running_duration_ms": elapsed}
                if record["deadline_ms"] is not None:
                    fields["timeout_ms"] = record["deadline_ms"]
                if record["retry_limit"] is not None:
                    fields["retry_limit"] = record["retry_limit"]
                try:
                    self.emit(
                        "job.runtime.sample", service="plane-worker", fields=fields, context_override=record["context"]
                    )
                except Exception:
                    pass

    def _loop(self):
        while True:
            time.sleep(60)
            with self.lock:
                if not self.records:
                    self.thread = None
                    return
            self.sample()


def task_limits(task):
    """Only actual Celery limits; no guessed universal execution deadline."""
    limits = getattr(task.request, "timelimit", None) or (
        getattr(task, "time_limit", None),
        getattr(task, "soft_time_limit", None),
    )
    if not isinstance(limits, (list, tuple)):
        limits = ()
    valid = [value for value in limits if type(value) in (int, float) and 0 < value <= 86400]
    retry = getattr(task, "max_retries", None)
    return min(valid) * 1000 if valid else None, retry if type(retry) is int and 0 <= retry <= 10000 else None
