"""Use structured request diagnostics instead of logging raw URLs."""

from uvicorn.workers import UvicornWorker


class DiagnosticUvicornWorker(UvicornWorker):
    CONFIG_KWARGS = {**UvicornWorker.CONFIG_KWARGS, "access_log": False}
