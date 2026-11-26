import importlib.util
import logging
from pathlib import Path
import sys
import unittest

SPEC = importlib.util.spec_from_file_location(
    "redaction", Path(__file__).resolve().parents[3] / "utils/diagnostic_redaction.py"
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class RedactionTests(unittest.TestCase):
    def test_codes_and_photo_metadata_are_private_but_operational_codes_survive(self):
        record = logging.makeLogRecord(
            {
                "msg": "reset_code=shared-secret-marker",
                "context": {
                    "avatar_url": "signed-location-marker",
                    "fileName": "athlete-photo-marker.png",
                    "roster_rows": {"full_name": "student-name-marker"},
                    "error_code": "SMTP_REJECTED",
                },
            }
        )
        module.DiagnosticRedactionFilter().filter(record)
        self.assertNotIn("-marker", str(record.__dict__))
        self.assertEqual(record.context["error_code"], "SMTP_REJECTED")

    def test_exception_message_sql_and_credentials_are_not_rendered(self):
        try:
            raise RuntimeError("password=private SELECT customer")
        except RuntimeError:
            record = logging.makeLogRecord({"msg": "private failure", "exc_info": sys.exc_info(), "token": "private"})
        self.assertTrue(module.DiagnosticRedactionFilter().filter(record))
        self.assertEqual(record.exception_type, "RuntimeError")
        self.assertIsNone(record.exc_info)
        self.assertNotIn("private", str(record.__dict__))
        self.assertTrue(record.exception_frames)

    def test_legacy_fields_are_bounded_and_native_identity_is_preserved(self):
        cycle = {}
        cycle["self"] = cycle
        record = logging.makeLogRecord(
            {
                "msg": "GET https://user:private@host/path?token=private for name@example.com",
                "scope": "school:program",
                "payload": cycle,
                "context": cycle,
            }
        )
        module.DiagnosticRedactionFilter().filter(record)
        self.assertEqual(record.scope, "school:program")
        self.assertNotIn("private", str(record.__dict__))
        self.assertLess(len(str(record.__dict__)), 5000)


if __name__ == "__main__":
    unittest.main()
