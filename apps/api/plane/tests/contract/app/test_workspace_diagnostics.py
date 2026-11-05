import base64
import hashlib
import hmac
import json
from unittest.mock import MagicMock, patch

import pytest
import requests

from plane.app.views.workspace.diagnostics import (
    MAX_RESPONSE_BYTES,
    _bridge_key,
    _bridge_origin,
    read_diagnostics_overview,
    read_diagnostics_export,
    MAX_EXPORT_BYTES,
)
from plane.db.models import User, WorkspaceMember


@pytest.fixture
def diagnostics_settings(settings, tmp_path, workspace):
    key = tmp_path / "bridge.key"
    key.write_text("a" * 43)
    key.chmod(0o600)
    settings.CUSTOMER_DIAGNOSTICS_ENABLED = True
    settings.CUSTOMER_DIAGNOSTICS_WORKSPACE = workspace.slug
    settings.CUSTOMER_DIAGNOSTICS_URL = "http://plane-coach:3021"
    settings.CUSTOMER_DIAGNOSTICS_BRIDGE_KEY_FILE = str(key)
    return key


def overview():
    return {"version": 1, "current": {}, "automation": {}, "runs": [], "incidents": []}


@pytest.mark.django_db
class TestWorkspaceDiagnostics:
    def test_admin_can_download_a_retained_report_without_starting_analysis(
        self, session_client, workspace, diagnostics_settings
    ):
        run = "b" * 32
        bundle = {
            "format": "kanavio-diagnostic-export",
            "version": 1,
            "analysis_id": run,
            "report": {"evidence": "x" * 300000},
        }
        with patch("plane.app.views.workspace.diagnostics.read_diagnostics_export", return_value=bundle, create=True):
            response = session_client.get(f"/api/workspaces/{workspace.slug}/diagnostics/reports/{run}/export/")
        assert response.status_code == 200
        assert response.json() == bundle
        assert response["Content-Disposition"] == f'attachment; filename="diagnostic-{run}.json"'
        assert response["Cache-Control"] == "private, no-store"

    @pytest.mark.parametrize("role", [5, 15])
    def test_non_admin_cannot_export_global_report(self, api_client, workspace, diagnostics_settings, role):
        user = User.objects.create(email=f"export-{role}@example.test", username=f"export-{role}")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=role, is_active=True)
        api_client.force_authenticate(user=user)
        response = api_client.get(f"/api/workspaces/{workspace.slug}/diagnostics/reports/{'b' * 32}/export/")
        assert response.status_code == 403

    def test_admin_reads_overview_with_existing_plane_session(self, session_client, workspace, diagnostics_settings):
        with patch("plane.app.views.workspace.diagnostics.read_diagnostics_overview", return_value=overview()) as read:
            response = session_client.get(f"/api/workspaces/{workspace.slug}/diagnostics/")
        assert response.status_code == 200
        assert response.json() == overview()
        assert response["Cache-Control"] == "private, no-store"
        assert "Cookie" in response["Vary"]
        assert read.call_args.args[1] == workspace.slug

    def test_anonymous_cannot_read_diagnostics(self, api_client, workspace, diagnostics_settings):
        with patch("plane.app.views.workspace.diagnostics.read_diagnostics_overview") as read:
            response = api_client.get(f"/api/workspaces/{workspace.slug}/diagnostics/")
        assert response.status_code in (401, 403)
        assert "no-store" in response["Cache-Control"]
        read.assert_not_called()

    @pytest.mark.parametrize("role,active", [(15, True), (5, True), (20, False)])
    def test_only_active_workspace_administrators_can_read(
        self, api_client, workspace, diagnostics_settings, role, active
    ):
        user = User.objects.create(
            email=f"diagnostics-{role}-{active}@example.test", username=f"diagnostics-{role}-{active}"
        )
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=role, is_active=active)
        api_client.force_authenticate(user=user)
        with patch("plane.app.views.workspace.diagnostics.read_diagnostics_overview") as read:
            response = api_client.get(f"/api/workspaces/{workspace.slug}/diagnostics/")
        assert response.status_code == 403
        read.assert_not_called()

    def test_disabled_does_not_contact_service(self, session_client, workspace, diagnostics_settings, settings):
        settings.CUSTOMER_DIAGNOSTICS_ENABLED = False
        with patch("plane.app.views.workspace.diagnostics.read_diagnostics_overview") as read:
            response = session_client.get(f"/api/workspaces/{workspace.slug}/diagnostics/")
        assert response.json() == {"version": 1, "enabled": False}
        read.assert_not_called()

    def test_wrong_workspace_is_rejected_before_upstream_access(
        self, session_client, workspace, diagnostics_settings, settings
    ):
        settings.CUSTOMER_DIAGNOSTICS_WORKSPACE = "different-workspace"
        with patch("plane.app.views.workspace.diagnostics.read_diagnostics_overview") as read:
            response = session_client.get(f"/api/workspaces/{workspace.slug}/diagnostics/")
        assert response.status_code == 403
        read.assert_not_called()

    def test_query_cannot_select_sources_or_remote_actions(self, session_client, workspace, diagnostics_settings):
        with patch("plane.app.views.workspace.diagnostics.read_diagnostics_overview") as read:
            response = session_client.get(f"/api/workspaces/{workspace.slug}/diagnostics/?url=http://169.254.169.254")
        assert response.status_code == 400
        read.assert_not_called()

    def test_post_cannot_start_analysis(self, session_client, workspace, diagnostics_settings):
        response = session_client.post(f"/api/workspaces/{workspace.slug}/diagnostics/", {}, format="json")
        assert response.status_code == 405

    def test_upstream_failure_does_not_expose_private_details(self, session_client, workspace, diagnostics_settings):
        with patch(
            "plane.app.views.workspace.diagnostics.read_diagnostics_overview",
            side_effect=requests.Timeout("private key and URL"),
        ):
            response = session_client.get(f"/api/workspaces/{workspace.slug}/diagnostics/")
        assert response.status_code == 503
        assert response.json()["code"] == "DIAGNOSTICS_UNAVAILABLE"
        assert "private key" not in response.content.decode()


@pytest.mark.parametrize(
    "origin",
    [
        "http://example.com",
        "http://169.254.169.254",
        "http://0.0.0.0",
        "ftp://localhost",
        "https://u:p@example.com",
        "http://plane-coach:3021/private",
        "http://plane-coach:3021?url=other",
        "http://plane-coach:99999",
    ],
)
def test_unapproved_origin_is_rejected(settings, origin):
    settings.CUSTOMER_DIAGNOSTICS_URL = origin
    with pytest.raises(ValueError):
        _bridge_origin()


@pytest.mark.parametrize(
    "origin",
    ["http://127.0.0.1:3021", "http://[::1]:3021", "http://plane-coach:3021/", "https://diagnostics.example.test"],
)
def test_explicit_local_or_verified_https_origin(settings, origin):
    settings.CUSTOMER_DIAGNOSTICS_URL = origin
    assert _bridge_origin() == origin.rstrip("/")


def test_private_key_validation(settings, tmp_path):
    key = tmp_path / "bridge.key"
    key.write_text("b" * 43)
    settings.CUSTOMER_DIAGNOSTICS_BRIDGE_KEY_FILE = str(key)
    key.chmod(0o644)
    with pytest.raises(ValueError):
        _bridge_key()
    key.chmod(0o600)
    assert _bridge_key() == "b" * 43
    link = tmp_path / "linked.key"
    link.symlink_to(key)
    settings.CUSTOMER_DIAGNOSTICS_BRIDGE_KEY_FILE = str(link)
    with pytest.raises(OSError):
        _bridge_key()


def upstream(body, status=200, content_type="application/json"):
    response = MagicMock()
    response.status_code = status
    response.headers = {"Content-Type": content_type}
    response.iter_content.return_value = [body]
    response.__enter__.return_value = response
    session = MagicMock()
    session.get.return_value = response
    session.__enter__.return_value = session
    return session


@pytest.mark.django_db
def test_signed_request_matches_existing_product_contract_and_forwards_no_cookies(diagnostics_settings, workspace):
    session = upstream(json.dumps(overview()).encode())
    with patch("plane.app.views.workspace.diagnostics.requests.Session", return_value=session):
        assert read_diagnostics_overview("user-id", workspace.slug) == overview()
    assert session.trust_env is False
    args, kwargs = session.get.call_args
    assert args == ("http://plane-coach:3021/api/product/overview",)
    assert kwargs["allow_redirects"] is False
    assert kwargs["timeout"] == (2, 5)
    headers = kwargs["headers"]
    assert "Cookie" not in headers and "Authorization" not in headers
    claims = headers["X-Kanavio-Product-Claims"]
    principal = json.loads(base64.urlsafe_b64decode(claims + "=" * (-len(claims) % 4)))
    assert principal["role"] == "admin" and principal["project"] is None
    assert principal["workspace"] == workspace.slug and principal["actor"] != "user-id"
    message = "\n".join(
        [
            "GET",
            "/api/product/overview",
            headers["X-Kanavio-Product-Time"],
            headers["X-Kanavio-Product-Nonce"],
            claims,
            hashlib.sha256(b"").hexdigest(),
        ]
    )
    assert headers["X-Kanavio-Product-Signature"] == hmac.new(b"a" * 43, message.encode(), hashlib.sha256).hexdigest()


@pytest.mark.django_db
@pytest.mark.parametrize(
    "body,status,content_type",
    [
        (b"{}", 200, "application/json"),
        (b"invalid", 200, "application/json"),
        (b"{}", 302, "application/json"),
        (b"{}", 200, "text/html"),
        (b"x" * (MAX_RESPONSE_BYTES + 1), 200, "application/json"),
        (b'{"version":NaN}', 200, "application/json"),
    ],
)
def test_malformed_redirected_or_oversized_response_is_rejected(
    diagnostics_settings, workspace, body, status, content_type
):
    with patch(
        "plane.app.views.workspace.diagnostics.requests.Session", return_value=upstream(body, status, content_type)
    ):
        with pytest.raises(ValueError):
            read_diagnostics_overview("user-id", workspace.slug)


@pytest.mark.django_db
def test_export_transport_has_separate_bounds_and_checks_identity_and_checksum(diagnostics_settings, workspace):
    run = "b" * 32
    report = {"evidence": "x" * 2000000}
    report_bytes = json.dumps(report, sort_keys=True, separators=(",", ":")).encode()
    bundle = {
        "format": "kanavio-diagnostic-export",
        "version": 1,
        "installation_id": "a" * 32,
        "analysis_id": run,
        "incident_id": None,
        "report_sha256": hashlib.sha256(report_bytes).hexdigest(),
        "report": report,
    }
    for change, valid in [
        ({}, True),
        ({"analysis_id": "c" * 32}, False),
        ({"report_sha256": "0" * 64}, False),
        ({"version": True}, False),
        ({"extra": 1}, False),
    ]:
        body = json.dumps({**bundle, **change}).encode()
        session = upstream(body)
        with patch("plane.app.views.workspace.diagnostics.requests.Session", return_value=session):
            if valid:
                assert read_diagnostics_export("user-id", workspace.slug, run) == bundle
                assert session.get.call_args.args[0].endswith(f"/api/product/reports/{run}/export")
                assert "Cookie" not in session.get.call_args.kwargs["headers"]
                assert session.get.call_args.kwargs["timeout"] == (2, 18)
            else:
                with pytest.raises(ValueError):
                    read_diagnostics_export("user-id", workspace.slug, run)
    for body, status, kind in [
        (b"{}", 302, "application/json"),
        (b"{}", 200, "text/html"),
        (b'{"report":', 200, "application/json"),
        (b"x" * (MAX_EXPORT_BYTES + 1), 200, "application/json"),
    ]:
        with patch("plane.app.views.workspace.diagnostics.requests.Session", return_value=upstream(body, status, kind)):
            with pytest.raises(ValueError):
                read_diagnostics_export("user-id", workspace.slug, run)
