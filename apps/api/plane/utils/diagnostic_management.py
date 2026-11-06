"""Observe one-shot management commands without subprocesses or argument logging."""

import json
import os
import time
from datetime import datetime, timezone
from uuid import uuid4


def observe_management(run, argv):
    action = argv[1] if len(argv) > 1 else None
    if action not in {"migrate", "wait_for_db"}:
        return run(argv)
    job = str(uuid4())
    started = time.perf_counter()

    def emit(event, outcome="ok", error_code=None):
        try:
            if os.environ.get("LOG_LEVEL", "INFO").upper() in {"ERROR", "WARN", "WARNING"} and outcome != "error":
                return
            record = {
                "schema_version": "1.0",
                "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "service": "plane-migrator",
                "event_name": event,
                "level": "error" if outcome == "error" else "info",
                "outcome": outcome,
                "record_id": str(uuid4()),
                "clock_id": f"plane-migrator:{os.getpid()}:{job}",
                "scope": "unscoped",
                "kind": "other",
                "environment": os.environ.get("KANAVIO_ENVIRONMENT", "production"),
                "operation_id": job,
                "context": {"job_id": job},
                "attributes": {"action": action},
            }
            if error_code:
                record["attributes"]["error_code"] = error_code
            if event != "job.started":
                record["duration_ms"] = max(0, (time.perf_counter() - started) * 1000)
            print(json.dumps(record, separators=(",", ":")), flush=True)
        except Exception:
            pass

    emit("job.started")
    try:
        result = run(argv)
    except SystemExit as error:
        successful = error.code is None or type(error.code) is int and error.code == 0
        emit(
            "job.completed" if successful else "job.failed",
            "ok" if successful else "error",
            None if successful else "COMMAND_EXIT_FAILED",
        )
        raise
    except KeyboardInterrupt:
        emit("job.cancelled", "cancelled")
        raise
    except BaseException:
        emit("job.failed", "error", "MIGRATION_FAILED")
        raise
    emit("job.completed")
    return result
