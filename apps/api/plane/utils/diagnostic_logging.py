"""Bounded operational evidence. Never serialize requests, SQL, task arguments or errors."""

import json
import logging
import math
import os
import re
import time
from contextlib import contextmanager, ExitStack
from contextvars import ContextVar
from datetime import datetime, timezone
from uuid import uuid4

ID = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
LABEL = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
SCOPE = re.compile(r"^[A-Za-z0-9_.:/|\-]{1,400}$")
NUMBERS = {"status_code", "query_count", "error_count", "attempt", "queue_depth", "input_bytes", "output_bytes"}
LABELS = {"error_code", "dependency", "action"}
current = ContextVar("kanavio_diagnostics", default=None)
CLOCK = "plane:" + uuid4().hex
logger = logging.getLogger("plane.api.request")


def identity(value):
    return value if isinstance(value, str) and ID.fullmatch(value) else None


def context(headers=None, scope="unscoped"):
    headers = headers or {}
    legacy = {}
    header = headers.get("x-tagging-context", "")
    if isinstance(header, str) and len(header) <= 4000:
        try:
            value = json.loads(header)
            if isinstance(value, dict):
                legacy = value
        except (ValueError, RecursionError):
            pass
    request_id = identity(headers.get("x-request-id")) or str(uuid4())
    scope_value = headers.get("x-kanavio-scope") or legacy.get("scope")
    kind = headers.get("x-kanavio-operation-kind") or legacy.get("kind")
    environment = headers.get("x-kanavio-environment") or legacy.get("environment")
    return {
        "operation_id": identity(headers.get("x-kanavio-operation-id"))
        or identity(legacy.get("operationId"))
        or request_id,
        "request_id": request_id,
        "trace_id": identity(headers.get("x-trace-id")) or identity(legacy.get("traceId")) or request_id,
        "scope": scope_value
        if isinstance(scope_value, str) and SCOPE.fullmatch(scope_value)
        else identity(scope) or "unscoped",
        "environment": environment
        if isinstance(environment, str) and LABEL.fullmatch(environment)
        else os.environ.get("KANAVIO_ENVIRONMENT", "production"),
        "kind": kind if isinstance(kind, str) and kind in {"tag", "replay"} else "other",
    }


def emit(event, *, duration_ms=None, outcome="ok", service=None, fields=None, context_override=None):
    try:
        if not LABEL.fullmatch(event):
            return
        ctx = context_override if context_override is not None else current.get() or {}
        service = service or ("plane-worker" if ctx.get("service") == "plane-worker" else "plane-api")
        severity = logging.ERROR if outcome == "error" else logging.INFO
        minimum = {"ERROR": logging.ERROR, "WARN": logging.WARNING, "WARNING": logging.WARNING}.get(
            os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO
        )
        if severity < minimum:
            return
        values = {}
        for key, value in (fields or {}).items():
            if (
                key in NUMBERS
                and isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
                and 0 <= value <= 1e15
            ):
                values[key] = value
            elif key in LABELS and isinstance(value, str) and LABEL.fullmatch(value):
                values[key] = value
        record = {
            key: value
            for key, value in ctx.items()
            if key in {"operation_id", "request_id", "trace_id", "scope", "kind", "environment"} and identity(value)
        }
        if isinstance(ctx.get("scope"), str) and SCOPE.fullmatch(ctx["scope"]):
            record["scope"] = ctx["scope"]
        record.update(
            schema_version="1.0",
            timestamp=datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            service=service,
            record_id=str(uuid4()),
            clock_id=f"{CLOCK}:{os.getpid()}",
            event_name=event,
            level="error" if outcome == "error" else "info",
            outcome=outcome,
            attributes=values,
        )
        if isinstance(duration_ms, (int, float)) and math.isfinite(duration_ms) and 0 <= duration_ms <= 1e15:
            record["duration_ms"] = duration_ms
        if identity(ctx.get("job_id")):
            record["context"] = {"job_id": ctx["job_id"]}
        logger.log(logging.ERROR if outcome == "error" else logging.INFO, event, extra=record)
    except Exception:
        pass  # A failed diagnostic sink cannot change request/task results.


def outgoing_headers(initial=None):
    headers = dict(initial or {})
    ctx = current.get() or {}
    for name, key in (
        ("X-Request-ID", "request_id"),
        ("X-Trace-ID", "trace_id"),
        ("X-Kanavio-Operation-ID", "operation_id"),
    ):
        if identity(ctx.get(key)) and not any(value.lower() == name.lower() for value in headers):
            headers[name] = ctx[key]
    for name, key, pattern in (
        ("X-Kanavio-Scope", "scope", SCOPE),
        ("X-Kanavio-Operation-Kind", "kind", re.compile(r"^(tag|replay|other)$")),
        ("X-Kanavio-Environment", "environment", LABEL),
    ):
        value = ctx.get(key)
        if (
            isinstance(value, str)
            and pattern.fullmatch(value)
            and not any(key.lower() == name.lower() for key in headers)
        ):
            headers[name] = value
    return headers


@contextmanager
def measured(event, **fields):
    started, outcome = time.perf_counter(), "ok"
    try:
        yield
    except BaseException:
        outcome = "error"
        raise
    finally:
        emit(event, duration_ms=(time.perf_counter() - started) * 1000, outcome=outcome, fields=fields)


@contextmanager
def database_observation(connections):
    """One aggregate per scope, never SQL, parameters or one log per query."""
    totals = {"count": 0, "errors": 0, "duration": 0.0}

    def observe(execute, sql, params, many, execution_context):
        started = time.perf_counter()
        try:
            return execute(sql, params, many, execution_context)
        except BaseException:
            totals["errors"] += 1
            raise
        finally:
            totals["count"] += 1
            totals["duration"] += (time.perf_counter() - started) * 1000

    try:
        with ExitStack() as stack:
            for connection in connections:
                stack.enter_context(connection.execute_wrapper(observe))
            yield
    finally:
        if totals["count"]:
            emit(
                "db.request.completed",
                duration_ms=totals["duration"],
                outcome="error" if totals["errors"] else "ok",
                fields={"query_count": totals["count"], "error_count": totals["errors"], "dependency": "postgres"},
            )


def dependency_call(run, *args, dependency, action, internal_headers=False, **kwargs):
    """Observe existing calls without changing timeouts, retries, bodies or failures."""
    if internal_headers:
        kwargs["headers"] = outgoing_headers(kwargs.get("headers"))
    started, outcome, status = time.perf_counter(), "ok", None
    try:
        result = run(*args, **kwargs)
        try:
            status = getattr(result, "status_code", None)
            if status is None:
                status = getattr(result, "status", None)
        except Exception:
            status = None
        outcome = "error" if isinstance(status, int) and status >= 400 else "ok"
        return result
    except BaseException:
        outcome = "error"
        raise
    finally:
        emit(
            "api.dependency.completed",
            duration_ms=(time.perf_counter() - started) * 1000,
            outcome=outcome,
            fields={"dependency": dependency, "action": action, "status_code": status},
        )
