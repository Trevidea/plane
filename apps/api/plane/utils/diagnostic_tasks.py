"""Celery signal hooks: propagate IDs, never arguments/results, and measure local execution."""

import time
import threading

from celery.signals import (
    before_task_publish,
    after_task_publish,
    task_prerun,
    task_postrun,
    worker_ready,
    worker_shutdown,
    task_revoked,
    beat_init,
)

from plane.utils.diagnostic_logging import SCOPE, context, current, emit, identity, database_observation

_publishes = {}
_publish_lock = threading.Lock()


@before_task_publish.connect(weak=False)
def diagnostic_publish(headers=None, **kwargs):
    try:
        if not isinstance(headers, dict):
            return
        ctx = current.get() or context()
        safe = {key: value for key, value in ctx.items() if identity(value)}
        if isinstance(ctx.get("scope"), str) and SCOPE.fullmatch(ctx["scope"]):
            safe["scope"] = ctx["scope"]
        headers.setdefault("kanavio_diagnostics", safe)
        target = identity(headers.get("id"))
        if target:
            ctx = {**ctx, "job_id": target}
            with _publish_lock:
                if len(_publishes) >= 256:
                    _publishes.pop(next(iter(_publishes)))
                _publishes[target] = (time.perf_counter(), dict(ctx))
        emit("queue.publish.requested", fields={"dependency": "rabbitmq"}, context_override=ctx)
    except Exception:
        pass


@after_task_publish.connect(weak=False)
def diagnostic_published(headers=None, **kwargs):
    try:
        headers = headers if isinstance(headers, dict) else {}
        target = identity(headers.get("id"))
        with _publish_lock:
            pending = _publishes.pop(target, None)
        started, ctx = pending if pending is not None else (None, current.get() or context())
        if target:
            ctx = {**ctx, "job_id": target}
        emit(
            "queue.published",
            duration_ms=(time.perf_counter() - started) * 1000 if started is not None else None,
            fields={"dependency": "rabbitmq"},
            context_override=ctx,
        )
    except Exception:
        pass


@task_prerun.connect(weak=False)
def diagnostic_task_started(task_id=None, task=None, **kwargs):
    try:
        headers = getattr(task.request, "headers", None) or {}
        incoming = headers.get("kanavio_diagnostics", {})
        ctx = context()
        if isinstance(incoming, dict):
            for key in ("operation_id", "request_id", "trace_id", "scope", "environment", "kind"):
                if identity(incoming.get(key)):
                    ctx[key] = incoming[key]
            if isinstance(incoming.get("scope"), str) and SCOPE.fullmatch(incoming["scope"]):
                ctx["scope"] = incoming["scope"]
        ctx["job_id"] = identity(task_id)
        ctx["service"] = "plane-worker"
        task.request._diagnostic_token = current.set(ctx)
        task.request._diagnostic_start = time.perf_counter()
        emit("job.started", service="plane-worker", fields={"attempt": getattr(task.request, "retries", 0)})
        from django.db import connections

        database = database_observation(connections.all())
        database.__enter__()
        task.request._diagnostic_database = database
    except Exception:
        pass


@task_postrun.connect(weak=False)
def diagnostic_task_finished(task=None, state=None, **kwargs):
    try:
        database = getattr(task.request, "_diagnostic_database", None)
        if database is not None:
            try:
                database.__exit__(None, None, None)
            except Exception:
                pass
            finally:
                del task.request._diagnostic_database
        start = getattr(task.request, "_diagnostic_start", None)
        if start is not None:
            emit(
                "job.completed" if state == "SUCCESS" else "job.retry" if state == "RETRY" else "job.failed",
                service="plane-worker",
                outcome="ok" if state == "SUCCESS" else "error",
                duration_ms=(time.perf_counter() - start) * 1000,
                fields={
                    "attempt": getattr(task.request, "retries", 0),
                    "error_code": "TASK_FAILED" if state != "SUCCESS" else "NONE",
                },
            )
    except Exception:
        pass
    finally:
        request = getattr(task, "request", None)
        token = getattr(request, "_diagnostic_token", None)
        if token is not None:
            try:
                current.reset(token)
                del request._diagnostic_token
            except (ValueError, AttributeError):
                pass


@worker_ready.connect(weak=False)
def diagnostic_worker_ready(**kwargs):
    emit("service.ready", service="plane-worker")


@worker_shutdown.connect(weak=False)
def diagnostic_worker_stopping(**kwargs):
    emit("service.stopping", service="plane-worker")


@task_revoked.connect(weak=False)
def diagnostic_task_cancelled(request=None, **kwargs):
    ctx = context()
    task_id = identity(getattr(request, "id", None))
    if task_id:
        ctx["job_id"] = task_id
    emit("job.cancelled", service="plane-worker", outcome="cancelled", context_override=ctx)


@beat_init.connect(weak=False)
def diagnostic_beat_ready(**kwargs):
    emit("service.ready", service="plane-beat", context_override={})
