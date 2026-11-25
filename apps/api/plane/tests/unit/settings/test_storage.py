from urllib.parse import urlparse

from plane.settings.storage import S3Storage


class RequestStub:
    scheme = "http"

    def __init__(self, host="localhost:8000"):
        self.host = host

    def get_host(self):
        return self.host


def _configure_minio(monkeypatch, *, external_endpoint, internal_endpoint):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "access-key")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret-key")
    monkeypatch.setenv("AWS_S3_BUCKET_NAME", "uploads")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setenv("AWS_S3_ENDPOINT_URL", external_endpoint)
    if internal_endpoint:
        monkeypatch.setenv("AWS_S3_INTERNAL_ENDPOINT_URL", internal_endpoint)
    else:
        monkeypatch.delenv("AWS_S3_INTERNAL_ENDPOINT_URL", raising=False)
        monkeypatch.delenv("MINIO_INTERNAL_ENDPOINT_URL", raising=False)
    monkeypatch.setenv("USE_MINIO", "1")
    monkeypatch.setenv("MINIO_ENDPOINT_SSL", "0")
    monkeypatch.delenv("PLAYER_APP_STORAGE_ENDPOINT_URL", raising=False)


def test_presigned_upload_uses_distinct_external_minio_endpoint(monkeypatch):
    _configure_minio(
        monkeypatch,
        external_endpoint="http://localhost:9100",
        internal_endpoint="http://plane-local-minio:9000",
    )

    storage = S3Storage(request=RequestStub())
    upload = storage.generate_presigned_post("workspace/file.txt", "text/plain", 100)

    target = urlparse(upload["url"])
    assert (target.scheme, target.netloc, target.path) == ("http", "localhost:9100", "/uploads")


def test_presigned_upload_uses_request_host_for_proxied_minio(monkeypatch):
    _configure_minio(
        monkeypatch,
        external_endpoint="http://plane-minio:9000/",
        internal_endpoint="http://plane-minio:9000",
    )

    storage = S3Storage(request=RequestStub())
    upload = storage.generate_presigned_post("workspace/file.txt", "text/plain", 100)

    target = urlparse(upload["url"])
    assert (target.scheme, target.netloc, target.path) == ("http", "localhost:8000", "/uploads")


def test_presigned_upload_uses_request_host_without_internal_endpoint(monkeypatch):
    _configure_minio(
        monkeypatch,
        external_endpoint="http://plane-minio:9000",
        internal_endpoint=None,
    )

    storage = S3Storage(request=RequestStub())
    upload = storage.generate_presigned_post("workspace/file.txt", "text/plain", 100)

    target = urlparse(upload["url"])
    assert (target.scheme, target.netloc, target.path) == ("http", "localhost:8000", "/uploads")


def test_player_api_origin_uses_its_public_storage_for_upload_and_display(monkeypatch):
    _configure_minio(
        monkeypatch,
        external_endpoint="http://localhost:9100",
        internal_endpoint="http://plane-local-minio:9000",
    )
    monkeypatch.setenv("PLAYER_APP_API_URL", "http://192.168.1.207:8000/")
    monkeypatch.setenv("PLAYER_APP_STORAGE_ENDPOINT_URL", "http://192.168.1.207:9100")

    player_storage = S3Storage(request=RequestStub("192.168.1.207:8000"))
    upload = player_storage.generate_presigned_post("avatar.png", "image/png", 100)
    assert upload["url"] == "http://192.168.1.207:9100/uploads"
    assert urlparse(player_storage.generate_presigned_url("avatar.png")).netloc == "192.168.1.207:9100"

    desktop_storage = S3Storage(request=RequestStub())
    assert desktop_storage.generate_presigned_post("avatar.png", "image/png", 100)["url"] == (
        "http://localhost:9100/uploads"
    )
    assert S3Storage().s3_client.meta.endpoint_url == "http://plane-local-minio:9000"
