"""Last-line handler protection for legacy emitters; exports remain allowlisted."""

import logging
import math
import re
from itertools import islice

PRIVATE = re.compile(
    r"authorization|password|secret|token|cookie|headers|private.?key|signed|body|payload|sql|params|parameters|email|player_name|full_name",
    re.I,
)
BUILTINS = frozenset(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}


def clean(value, depth=0, budget=None):
    budget = budget if budget is not None else [300]
    budget[0] -= 1
    if depth > 5 or budget[0] < 0:
        return "[TRUNCATED]"
    if isinstance(value, str):
        value = value[:4096]
        value = re.sub(r"\b(?:Bearer|Basic)\s+[^\s,;]+", "[REDACTED]", value, flags=re.I)
        value = re.sub(r"([a-z][a-z0-9+.-]*://)[^/@\s]+@", r"\1[REDACTED]@", value, flags=re.I)
        value = re.sub(r"(https?://[^?\s]+)\?[^\s]+", r"\1?[REDACTED]", value)
        value = re.sub(r"\b[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}\b", "[REDACTED EMAIL]", value)
        value = re.sub(
            r"\b(?:password|secret|token|authorization|cookie|body|payload|sql|params|parameters)\s*[:=].*",
            "[REDACTED FIELDS]",
            value,
            flags=re.I | re.S,
        )
        return value
    if isinstance(value, dict):
        return {
            str(key)[:100]: "[REDACTED]" if PRIVATE.search(str(key)) else clean(item, depth + 1, budget)
            for key, item in islice(value.items(), 40)
            if budget[0] > 0
        }
    if isinstance(value, (tuple, list)):
        return [clean(item, depth + 1, budget) for item in value[:40] if budget[0] > 0]
    if value is None or isinstance(value, (bool, int)) or isinstance(value, float) and math.isfinite(value):
        return value
    return "[OMITTED]"


class DiagnosticRedactionFilter(logging.Filter):
    def filter(self, record):
        try:
            if record.exc_info:
                error_type, _error, frame = record.exc_info
                record.exception_type = error_type.__name__[:100]
                frames = []
                while frame is not None and len(frames) < 12:
                    frames.append({"function": frame.tb_frame.f_code.co_name[:100], "line": frame.tb_lineno})
                    frame = frame.tb_next
                record.exception_frames = frames
                record.msg = "Exception captured; see exception_type and exception_frames."
            elif (record.name or "").startswith("django.db.backends"):
                record.msg = "Database diagnostic details omitted."
            else:
                record.msg = clean(record.getMessage())
            record.args = ()
            record.exc_info = record.exc_text = record.stack_info = None
            budget = [300]
            for key in tuple(record.__dict__):
                if key not in BUILTINS:
                    record.__dict__[key] = (
                        "[REDACTED]" if PRIVATE.search(key) else clean(record.__dict__[key], budget=budget)
                    )
        except Exception:
            record.msg, record.args = "Diagnostic record could not be sanitized.", ()
            record.exc_info = record.exc_text = record.stack_info = None
            for key in tuple(record.__dict__):
                if key not in BUILTINS:
                    del record.__dict__[key]
        return True
