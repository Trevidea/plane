import importlib.util
import io
import json
from pathlib import Path
from contextlib import redirect_stdout
import unittest

spec = importlib.util.spec_from_file_location(
    "management", Path(__file__).resolve().parents[3] / "utils/diagnostic_management.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ManagementTests(unittest.TestCase):
    def test_command_result_and_arguments_preserved_without_logging_them(self):
        args = ["manage.py", "migrate", "--private-value"]
        result = object()
        output = io.StringIO()

        def run(actual):
            self.assertIs(actual, args)
            return result

        with redirect_stdout(output):
            self.assertIs(module.observe_management(run, args), result)
        records = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([r["event_name"] for r in records], ["job.started", "job.completed"])
        self.assertNotIn("private", output.getvalue())
        self.assertGreaterEqual(records[1]["duration_ms"], 0)

    def test_error_and_system_exit_are_preserved(self):
        for error in (RuntimeError("private SQL"), SystemExit(0), SystemExit(2)):
            output = io.StringIO()

            def run(_):
                raise error

            with redirect_stdout(output), self.assertRaises(BaseException) as caught:
                module.observe_management(run, ["manage.py", "migrate"])
            self.assertIs(caught.exception, error)
            self.assertNotIn("private", output.getvalue())
            self.assertEqual(
                json.loads(output.getvalue().splitlines()[-1])["event_name"],
                "job.completed" if isinstance(error, SystemExit) and error.code == 0 else "job.failed",
            )

    def test_unrelated_commands_are_not_instrumented(self):
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(module.observe_management(lambda _: 12, ["manage.py", "runserver"]), 12)
        self.assertEqual(output.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
