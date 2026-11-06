"""Run without booting Django, Celery, Redis or a database."""

import importlib.util
import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "diagnostic_logging", Path(__file__).resolve().parents[3] / "utils/diagnostic_logging.py"
)
logs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(logs)


class DiagnosticLoggingTests(unittest.TestCase):
    def test_dependency_failure_types_are_classified_without_messages_or_retries(self):
        for error, expected in (
            (TimeoutError("private URL and token"), "UPSTREAM_TIMEOUT"),
            (ConnectionRefusedError("private endpoint"), "UPSTREAM_CONNECTION_FAILED"),
            (RuntimeError("private payload"), "UPSTREAM_REQUEST_FAILED"),
        ):
            calls = []

            def run():
                calls.append(1)
                raise error

            with patch.object(logs.logger, "log") as output:
                with self.assertRaises(type(error)) as caught:
                    logs.dependency_call(run, dependency="gateway", action="get")
            self.assertIs(caught.exception, error)
            self.assertEqual(len(calls), 1)
            record = output.call_args.kwargs["extra"]
            self.assertEqual(record["attributes"]["error_code"], expected)
            self.assertNotIn("private", str(record))

    def test_urllib_style_status_is_measured_without_consuming_the_body(self):
        response = SimpleNamespace(status=503, read=lambda: self.fail("Body must not be consumed"))
        with patch.object(logs.logger, "log") as output:
            self.assertIs(logs.dependency_call(lambda: response, dependency="media", action="urlopen"), response)
        self.assertEqual(output.call_args.kwargs["extra"]["attributes"]["status_code"], 503)
        self.assertEqual(output.call_args.kwargs["extra"]["outcome"], "error")

    def test_dependency_preserves_results_errors_and_only_forwards_internal_ids(self):
        result = SimpleNamespace(status_code=200)
        token = logs.current.set(logs.context({"x-request-id": "dep-1"}))
        try:
            with patch.object(logs.logger, "log") as output:

                def call(**kwargs):
                    self.assertEqual(kwargs["headers"]["Authorization"], "private")
                    self.assertEqual(kwargs["headers"]["X-Request-ID"], "dep-1")
                    return result

                self.assertIs(
                    logs.dependency_call(
                        call,
                        dependency="gateway",
                        action="post",
                        internal_headers=True,
                        headers={"Authorization": "private"},
                    ),
                    result,
                )
            self.assertNotIn("private", str(output.call_args))
        finally:
            logs.current.reset(token)
        original = RuntimeError("private failure")

        def failed():
            raise original

        with patch.object(logs.logger, "log", side_effect=OSError("disk full")):
            with self.assertRaises(RuntimeError) as caught:
                logs.dependency_call(failed, dependency="s3", action="head")
        self.assertIs(caught.exception, original)

    def test_database_wrapper_counts_queries_and_failures_without_query_text(self):
        wrapper = []

        @contextmanager
        def execute_wrapper(run):
            wrapper.append(run)
            yield

        conn = SimpleNamespace(execute_wrapper=execute_wrapper)
        error = RuntimeError("private database failure")

        def failed(*_):
            raise error

        with patch.object(logs.logger, "log") as output:
            with logs.database_observation([conn]):
                self.assertEqual(wrapper[0](lambda *_: "result", "private SQL", ["private"], False, {}), "result")
                with self.assertRaises(RuntimeError):
                    wrapper[0](failed, "private SQL", None, False, {})
        evidence = output.call_args.kwargs["extra"]
        self.assertEqual(evidence["attributes"]["query_count"], 2)
        self.assertEqual(evidence["attributes"]["error_count"], 1)
        self.assertNotIn("private", str(evidence))

    def test_context_ids_preserve_safe_headers_without_credential_forwarding(self):
        ctx = logs.context(
            {
                "x-request-id": "request-1",
                "x-trace-id": "trace-1",
                "authorization": "secret",
                "x-tagging-context": '{"operationId":"operation-1","scope":"https://school.test|project","password":"secret"}',
            }
        )
        token = logs.current.set(ctx)
        try:
            result = logs.outgoing_headers({"Authorization": "existing", "x-request-id": "caller-1"})
            self.assertEqual(result["Authorization"], "existing")
            self.assertEqual(result["x-request-id"], "caller-1")
            self.assertEqual(result["X-Trace-ID"], "trace-1")
            self.assertEqual(result["X-Kanavio-Operation-ID"], "operation-1")
            self.assertNotIn("password", ctx)
            self.assertEqual(ctx["scope"], "https://school.test|project")
        finally:
            logs.current.reset(token)

    def test_emission_is_allowlisted_and_clock_is_process_specific(self):
        with patch.object(logs.logger, "log") as output:
            logs.emit(
                "db.request.completed",
                duration_ms=12,
                fields={"sql": "secret", "error": "secret", "query_count": 3, "status_code": float("nan")},
            )
        record = output.call_args.kwargs["extra"]
        self.assertEqual(record["attributes"], {"query_count": 3})
        self.assertEqual(record["duration_ms"], 12)
        self.assertTrue(record["clock_id"].endswith(":" + str(logs.os.getpid())))
        self.assertNotIn("secret", str(record))

    def test_malformed_ids_and_broken_sinks_never_change_business_exception(self):
        ctx = logs.context({"x-request-id": "invalid\nsecret", "x-tagging-context": "[malformed"})
        self.assertTrue(logs.identity(ctx["request_id"]))
        original = RuntimeError("original")
        with patch.object(logs.logger, "log", side_effect=OSError("disk full")):
            with self.assertRaises(RuntimeError) as caught:
                with logs.measured("api.request.completed"):
                    raise original
        self.assertIs(caught.exception, original)

    def test_job_status_scope_restores_parent_context_and_preserves_business_exception(self):
        parent = {"operation_id": "status-read", "request_id": "request-1"}
        token = logs.current.set(parent)
        error = RuntimeError("business error")
        try:
            with self.assertRaises(RuntimeError) as caught:
                with logs.job_scope("job-1"):
                    self.assertEqual(logs.current.get()["job_id"], "job-1")
                    self.assertEqual(logs.current.get()["operation_id"], "status-read")
                    raise error
            self.assertIs(caught.exception, error)
            self.assertIs(logs.current.get(), parent)
        finally:
            logs.current.reset(token)


if __name__ == "__main__":
    unittest.main()
