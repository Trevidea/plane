import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "diagnostic_job_monitor", Path(__file__).resolve().parents[3] / "utils/diagnostic_job_monitor.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class JobMonitorTests(unittest.TestCase):
    def test_local_runtime_and_limits_do_not_cancel_or_retry_tasks(self):
        events, now = [], [10]
        monitor = module.JobMonitor(lambda *args, **kwargs: events.append((args, kwargs)), clock=lambda: now[0])
        with patch("threading.Thread.start"):
            monitor.start("task", {"operation_id": "original", "job_id": "task"}, 2, 120000, 3)
        now[0] = 131
        monitor.sample()
        self.assertEqual(events[0][0], ("job.runtime.sample",))
        self.assertEqual(
            events[0][1]["fields"],
            {"attempt": 2, "running_duration_ms": 121000, "timeout_ms": 120000, "retry_limit": 3},
        )
        self.assertEqual(events[0][1]["context_override"]["operation_id"], "original")
        monitor.finish("task")
        monitor.sample()
        self.assertEqual(len(events), 1)

    def test_bounds_missing_deadlines_and_failed_sinks_are_safe(self):
        records = []
        monitor = module.JobMonitor(lambda *args, **kwargs: records.append(kwargs), clock=lambda: 1)
        with patch("threading.Thread.start"):
            for index in range(100):
                monitor.start(str(index), {}, 0)
        self.assertEqual(len(monitor.records), 64)
        for _ in range(65):
            monitor.sample()
        self.assertEqual(len(records), 64 * 60)
        self.assertTrue(all("timeout_ms" not in item["fields"] for item in records))
        task = SimpleNamespace(request=SimpleNamespace(timelimit=(None, None)), max_retries=None)
        self.assertEqual(module.task_limits(task), (None, None))
        task.request.timelimit = (300, 120)
        task.max_retries = 5
        self.assertEqual(module.task_limits(task), (120000, 5))


if __name__ == "__main__":
    unittest.main()
