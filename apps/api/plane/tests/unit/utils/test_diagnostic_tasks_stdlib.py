"""Exercise signal logic without a broker, Django settings or task execution."""

import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3] / "utils"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


logs = load("diagnostic_logging", "diagnostic_logging.py")
monitor = load("diagnostic_job_monitor", "diagnostic_job_monitor.py")
signals = SimpleNamespace(
    **{
        name: SimpleNamespace(connect=lambda **_: lambda fn: fn)
        for name in (
            "before_task_publish",
            "after_task_publish",
            "task_prerun",
            "task_postrun",
            "worker_ready",
            "worker_shutdown",
            "task_revoked",
            "beat_init",
        )
    }
)
with patch.dict(
    sys.modules,
    {
        "celery.signals": signals,
        "plane": ModuleType("plane"),
        "plane.utils": ModuleType("plane.utils"),
        "plane.utils.diagnostic_logging": logs,
        "plane.utils.diagnostic_job_monitor": monitor,
        "django.db": SimpleNamespace(connections=SimpleNamespace(all=lambda: [])),
    },
):
    tasks = load("diagnostic_tasks", "diagnostic_tasks.py")


class TaskDiagnosticTests(unittest.TestCase):
    def test_publish_is_correlated_and_publish_duration_is_local(self):
        token = logs.current.set(logs.context({"x-request-id": "publish-1", "x-kanavio-scope": "school:program"}))
        headers = {"id": "job-1"}
        try:
            with patch.object(tasks, "emit") as output:
                tasks.diagnostic_publish(headers=headers, body="private payload")
                tasks.diagnostic_published(headers=headers)
            self.assertEqual(headers["kanavio_diagnostics"]["request_id"], "publish-1")
            self.assertEqual(output.call_args.kwargs["context_override"]["job_id"], "job-1")
            self.assertGreaterEqual(output.call_args.kwargs["duration_ms"], 0)
            self.assertNotIn("private", str(output.call_args_list))
            self.assertNotIn("job-1", tasks._publishes)
        finally:
            logs.current.reset(token)

    def test_task_terminal_and_context_reset_survive_database_teardown_failure(self):
        old = {"request_id": "parent-1"}
        token = logs.current.set(old)
        task = SimpleNamespace(
            request=SimpleNamespace(
                headers={"kanavio_diagnostics": {"request_id": "child-1", "scope": "school:program"}}, retries=1
            )
        )

        class BrokenDatabase:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                raise OSError("private sink error")

        try:
            with (
                patch.object(tasks, "database_observation", return_value=BrokenDatabase()),
                patch.object(tasks, "emit") as output,
            ):
                tasks.diagnostic_task_started(task_id="job-1", task=task)
                self.assertEqual(logs.current.get()["service"], "plane-worker")
                tasks.diagnostic_task_finished(task=task, state="SUCCESS")
            self.assertEqual(output.call_args.args[0], "job.completed")
            self.assertIs(logs.current.get(), old)
            self.assertFalse(hasattr(task.request, "_diagnostic_token"))
        finally:
            logs.current.reset(token)


if __name__ == "__main__":
    unittest.main()
