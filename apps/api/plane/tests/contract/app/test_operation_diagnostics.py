import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from plane.app.views.workspace.operation_diagnostics import product_request
from plane.db.models import Project, ProjectMember, User, WorkspaceMember


@pytest.fixture
def program(workspace, create_user, settings, tmp_path):
    cache.clear()
    project = Project.objects.create(workspace=workspace, name="Diagnostics", identifier="DIAG", created_by=create_user)
    ProjectMember.objects.create(workspace=workspace, project=project, member=create_user, role=20)
    key = tmp_path / "bridge.key"
    key.write_text("a" * 43)
    key.chmod(0o600)
    settings.CUSTOMER_DIAGNOSTICS_ENABLED = True
    settings.CUSTOMER_DIAGNOSTICS_WORKSPACE = workspace.slug
    settings.CUSTOMER_DIAGNOSTICS_URL = "http://plane-coach:3021"
    settings.CUSTOMER_DIAGNOSTICS_BRIDGE_KEY_FILE = str(key)
    return project


def endpoint(workspace, program, view="capabilities", identity=""):
    return f"/api/workspaces/{workspace.slug}/projects/{program.id}/diagnostics/operations/?view={view}" + (
        f"&id={identity}" if identity else ""
    )


def measurement():
    return {
        "action": "playback",
        "event_name": "playback.ready",
        "operation_id": "11111111-1111-4111-8111-111111111111",
        "occurred_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "duration_ms": 1200,
        "offset_ms": 0,
        "policy_id": "b" * 64,
    }


@pytest.mark.django_db
class TestOperationDiagnostics:
    def test_background_live_conversion_preserves_payload_and_propagates_internal_context(self, settings):
        from plane.bgtasks.copy_s3_object import sync_with_external_service
        from plane.utils.diagnostic_logging import context, current

        settings.LIVE_URL = "http://plane-live:3000"
        token = current.set(context({"x-request-id": "background-request", "x-kanavio-operation-id": "background-op"}))
        try:
            expected = {"description": "private document"}
            with patch("plane.bgtasks.copy_s3_object.requests.post") as post:
                post.return_value.status_code = 200
                post.return_value.json.return_value = expected
                assert sync_with_external_service("ISSUE", "private document") is expected
            assert post.call_count == 1
            assert post.call_args.kwargs["headers"]["X-Kanavio-Operation-ID"] == "background-op"
            assert post.call_args.kwargs["headers"]["X-Request-ID"] == "background-request"
            assert post.call_args.kwargs["json"] == {"description_html": "private document", "variant": "document"}
            assert "timeout" not in post.call_args.kwargs
        finally:
            current.reset(token)

    def test_capabilities_are_project_scoped_and_private(self, session_client, workspace, program):
        with patch(
            "plane.app.views.workspace.operation_diagnostics.product_request",
            return_value=({"enabled": True, "can_report": True}, 200),
        ) as upstream:
            response = session_client.get(endpoint(workspace, program))
        assert response.status_code == 200
        assert response["Cache-Control"] == "private, no-store"
        assert upstream.call_args.args[1:4] == (workspace.slug, program.id, "/api/product/capabilities")

    @pytest.mark.parametrize("role,active", [(5, True), (15, False)])
    def test_guests_and_inactive_members_cannot_report(self, workspace, program, role, active):
        user = User.objects.create(username=f"member-{role}-{active}", email=f"member-{role}-{active}@example.test")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
        ProjectMember.objects.create(workspace=workspace, project=program, member=user, role=role, is_active=active)
        client = APIClient()
        client.force_authenticate(user=user)
        with patch("plane.app.views.workspace.operation_diagnostics.product_request") as upstream:
            response = client.get(endpoint(workspace, program))
        assert response.status_code == 403
        upstream.assert_not_called()

    def test_anonymous_access_is_rejected(self, api_client, workspace, program):
        assert api_client.get(endpoint(workspace, program)).status_code in (401, 403)

    def test_disabled_or_other_workspace_does_not_contact_service(self, session_client, workspace, program, settings):
        settings.CUSTOMER_DIAGNOSTICS_ENABLED = False
        with patch("plane.app.views.workspace.operation_diagnostics.product_request") as upstream:
            assert session_client.get(endpoint(workspace, program)).json()["enabled"] is False
        upstream.assert_not_called()
        settings.CUSTOMER_DIAGNOSTICS_ENABLED = True
        settings.CUSTOMER_DIAGNOSTICS_WORKSPACE = "another-workspace"
        assert session_client.get(endpoint(workspace, program)).status_code == 403

    def test_report_and_submit_use_fixed_paths_without_business_retries(self, session_client, workspace, program):
        body = {
            "action": "upload",
            "operation_id": measurement()["operation_id"],
            "occurred_at": measurement()["occurred_at"],
            "elapsed_ms": 15000,
            "reason": "slow",
            "share": False,
        }
        with patch(
            "plane.app.views.workspace.operation_diagnostics.product_request",
            return_value=({"incident": {"id": "a" * 32, "submission_status": "not-submitted"}}, 202),
        ) as upstream:
            response = session_client.post(
                endpoint(workspace, program, "report"), body, format="json", HTTP_ORIGIN="https://testserver"
            )
        assert response.status_code == 202
        assert upstream.call_args.args[3:] == ("/api/product/incidents", body)
        assert upstream.call_count == 1
        with patch(
            "plane.app.views.workspace.operation_diagnostics.product_request", return_value=({"incident": {}}, 200)
        ) as upstream:
            response = session_client.post(
                endpoint(workspace, program, "submit", "a" * 32),
                {"consent": True},
                format="json",
                HTTP_ORIGIN="https://testserver",
            )
        assert response.status_code == 200
        assert upstream.call_args.args[3] == "/api/product/incidents/" + "a" * 32 + "/submit"

    @pytest.mark.parametrize("origin", [None, "https://evil.example", "null"])
    def test_write_requires_trusted_origin(self, session_client, workspace, program, origin):
        headers = {} if origin is None else {"HTTP_ORIGIN": origin}
        with patch("plane.app.views.workspace.operation_diagnostics.product_request") as upstream:
            response = session_client.post(endpoint(workspace, program, "report"), {}, format="json", **headers)
        assert response.status_code == 403
        upstream.assert_not_called()

    def test_typed_measurement_is_logged_without_private_fields(self, session_client, workspace, program):
        body = measurement()
        with patch("plane.app.views.workspace.operation_diagnostics.logger.info") as emit:
            response = session_client.post(
                endpoint(workspace, program, "measurement"), body, format="json", HTTP_ORIGIN="https://testserver"
            )
        assert response.status_code == 200
        record = emit.call_args.kwargs["extra"]
        assert record["scope"] == f"{workspace.slug}/{program.id}"
        assert record["clock_id"] == "browser:" + body["operation_id"]
        assert record["context"] == {"measurement_origin": "browser", "operation_policy_id": "b" * 64}
        assert record["duration_ms"] == 1200

    @pytest.mark.parametrize(
        "change",
        [
            {"duration_ms": -1},
            {"duration_ms": True},
            {"duration_ms": 3600001},
            {"event_name": "arbitrary"},
            {"action": []},
            {"file_name": "private.mp4"},
            {"scope": "other/program"},
        ],
    )
    def test_invalid_measurement_never_reaches_logger(self, session_client, workspace, program, change):
        with patch("plane.app.views.workspace.operation_diagnostics.logger.info") as emit:
            response = session_client.post(
                endpoint(workspace, program, "measurement"),
                {**measurement(), **change},
                format="json",
                HTTP_ORIGIN="https://testserver",
            )
        assert response.status_code == 400
        emit.assert_not_called()

    def test_oversized_and_arbitrary_remote_actions_are_rejected(self, session_client, workspace, program):
        assert (
            session_client.post(
                endpoint(workspace, program, "report"),
                {"data": "x" * 4096},
                format="json",
                HTTP_ORIGIN="https://testserver",
            ).status_code
            == 413
        )
        for view in ("overview", "generate", "http://169.254.169.254", "submit"):
            assert session_client.get(endpoint(workspace, program, view)).status_code == 400

    def test_upstream_failure_does_not_expose_credentials(self, session_client, workspace, program):
        with patch(
            "plane.app.views.workspace.operation_diagnostics.product_request",
            side_effect=ValueError("password=private"),
        ):
            response = session_client.get(endpoint(workspace, program))
        assert response.status_code == 503
        assert "private" not in response.content.decode()


@pytest.mark.django_db
@pytest.mark.parametrize("separate_identity", [False, True])
def test_signed_project_bridge_has_no_cookie_and_binds_method_body_path(
    program, workspace, settings, tmp_path, separate_identity
):
    if separate_identity:
        path = tmp_path / "identity.key"
        path.write_text("c" * 43)
        path.chmod(0o600)
        settings.CUSTOMER_DIAGNOSTICS_IDENTITY_KEY_FILE = str(path)
    response = MagicMock()
    response.status_code = 202
    response.headers = {"Content-Type": "application/json"}
    response.iter_content.return_value = [b'{"incident":{}}']
    response.__enter__.return_value = response
    session = MagicMock()
    session.__enter__.return_value = session
    session.request.return_value = response
    with patch("plane.app.views.workspace.operation_diagnostics.requests.Session", return_value=session):
        assert (
            product_request("private-user", workspace.slug, program.id, "/api/product/incidents", {"share": False})[1]
            == 202
        )
    args, options = session.request.call_args
    assert args == ("POST", "http://plane-coach:3021/api/product/incidents")
    headers = options["headers"]
    assert "Cookie" not in headers and "Authorization" not in headers
    claims = headers["X-Kanavio-Product-Claims"]
    principal = json.loads(base64.urlsafe_b64decode(claims + "=" * (-len(claims) % 4)))
    assert principal["role"] == "coach" and principal["project"] == str(program.id)
    assert principal["actor"] != "private-user"
    assert (
        principal["actor"]
        == hmac.new(
            (b"c" if separate_identity else b"a") * 43, b"product-actor:private-user", hashlib.sha256
        ).hexdigest()
    )
    message = "\n".join(
        [
            "POST",
            "/api/product/incidents",
            headers["X-Kanavio-Product-Time"],
            headers["X-Kanavio-Product-Nonce"],
            claims,
            hashlib.sha256(options["data"]).hexdigest(),
        ]
    )
    assert headers["X-Kanavio-Product-Signature"] == hmac.new(b"a" * 43, message.encode(), hashlib.sha256).hexdigest()
    assert options["allow_redirects"] is False and session.trust_env is False
