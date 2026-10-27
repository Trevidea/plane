from unittest.mock import MagicMock, patch

import pytest
import requests
from django.db import transaction
from django.db.utils import ConnectionHandler
from django.test import override_settings

from plane.bgtasks.service_gateway_webhook_task import (
    ServiceGatewaySyncError,
    _sync_error_message,
    _sync_deleted_event,
    _trigger_event_send,
    _trigger_event_send_for_ids,
    service_gateway_event_sync,
)


@pytest.fixture
def notification_connection(django_db_blocker):
    """Exercise real commit/rollback hooks without creating Plane's database."""
    connection = ConnectionHandler({
        "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"},
    })["default"]
    with django_db_blocker.unblock(), patch(
        "django.db.transaction.get_connection", return_value=connection
    ):
        try:
            yield connection
        finally:
            connection.close()


def queue_notifications(session, event_ids):
    _trigger_event_send_for_ids(
        session=session,
        event_api="http://gateway/api/event",
        event_send_api="http://gateway/api/event/send-now",
        service_gateway_event_ids=event_ids,
        issue_id="issue-commit",
        timeout=17,
    )


@pytest.mark.unit
class TestServiceGatewayWebhookTask:
    def test_notification_waits_for_outer_commit_and_uses_fresh_session(self, notification_connection):
        sync_session = MagicMock()
        event_ids = [321, None, 321, 654]
        with patch("plane.bgtasks.service_gateway_webhook_task.requests.Session") as session_factory:
            notification_session = session_factory.return_value.__enter__.return_value
            with transaction.atomic():
                with transaction.atomic():
                    queue_notifications(sync_session, event_ids)
                event_ids[:] = [999]
                sync_session.close()
                sync_session.request.assert_not_called()
                session_factory.assert_not_called()

            assert notification_session.request.call_count == 2
            for call, event_id in zip(notification_session.request.call_args_list, [321, 654]):
                assert call.kwargs == {
                    "method": "POST", "url": "http://gateway/api/event/send-now",
                    "json": {"table": "event", "criteria": [
                        {"field": "id", "type": 0, "value": event_id},
                    ]},
                    "params": None, "timeout": 17,
                }
            session_factory.return_value.__exit__.assert_called_once()
            sync_session.request.assert_not_called()

    def test_rollback_discards_notification(self, notification_connection):
        sync_session = MagicMock()
        with patch("plane.bgtasks.service_gateway_webhook_task.requests.Session") as session_factory:
            with pytest.raises(RuntimeError), transaction.atomic():
                queue_notifications(sync_session, [321])
                raise RuntimeError("save rolled back")
            sync_session.request.assert_not_called()
            session_factory.assert_not_called()

    def test_notification_sends_immediately_without_transaction(self, notification_connection):
        sync_session = MagicMock()
        queue_notifications(sync_session, [321])
        assert sync_session.request.call_count == 1

    @override_settings(
        SERVICE_GATEWAY_WEBHOOK_ENABLED=True,
        SERVICE_GATEWAY_EVENT_API="http://gateway/api/event",
        SERVICE_GATEWAY_EVENT_SEND_API="http://gateway/api/event/send",
        SERVICE_GATEWAY_SCHEDULED_EVENT_API="http://gateway/api/scheduled-event",
    )
    def test_update_sync_finishes_gateway_writes_before_commit(self, notification_connection):
        with patch("plane.bgtasks.service_gateway_webhook_task.requests.Session") as session_factory, patch(
            "plane.bgtasks.service_gateway_webhook_task._set_issue_sg_event_id"
        ):
            sync_session = MagicMock()
            notification_session = MagicMock()
            session_factory.return_value.__enter__.side_effect = [sync_session, notification_session]
            sync_session.request.return_value.json.return_value = {
                "result": [{"id": 765, "event_id": 321}],
            }
            with transaction.atomic():
                service_gateway_event_sync("issue", "updated", {
                    "id": "issue-commit", "start_date": "2026-10-23",
                    "start_time": "2026-10-23T16:00:00Z",
                })
                assert [call.kwargs["method"] for call in sync_session.request.call_args_list] == [
                    "GET", "PUT", "PUT", "PUT",
                ]
                notification_session.request.assert_not_called()
                session_factory.return_value.__exit__.assert_called_once()
            assert notification_session.request.call_count == 1

    @override_settings(
        SERVICE_GATEWAY_WEBHOOK_ENABLED=True,
        SERVICE_GATEWAY_EVENT_API="http://gateway/api/event",
    )
    def test_gateway_write_failure_still_raises_and_discards_notification(self, notification_connection):
        with patch("plane.bgtasks.service_gateway_webhook_task.requests.Session") as session_factory, patch(
            "plane.bgtasks.service_gateway_webhook_task._resolve_existing_gateway_rows",
            return_value=[{"id": 765, "event_id": 321}],
        ):
            sync_session = session_factory.return_value.__enter__.return_value
            sync_session.request.side_effect = requests.HTTPError("write failed")
            with pytest.raises(ServiceGatewaySyncError), transaction.atomic():
                service_gateway_event_sync("issue", "updated", {
                    "id": "issue-commit", "start_date": "2026-10-23",
                    "start_time": "2026-10-23T16:00:00Z",
                })
            assert sync_session.request.call_count == 1
            assert sync_session.request.call_args.kwargs["method"] == "PUT"
            session_factory.assert_called_once()

    def test_deletion_notifies_before_gateway_row_is_removed(self, notification_connection):
        session = MagicMock()
        with patch(
            "plane.bgtasks.service_gateway_webhook_task._resolve_existing_gateway_rows", return_value=[]
        ), patch("plane.bgtasks.service_gateway_webhook_task._set_issue_sg_event_id"):
            with transaction.atomic():
                _sync_deleted_event(
                    session=session, event_api="http://gateway/api/event",
                    event_send_api="", scheduled_event_api="", timeout=17,
                    event_data={"id": "issue-delete", "sg_event_id": 321},
                )
                assert [call.kwargs["method"] for call in session.request.call_args_list] == [
                    "POST", "DELETE",
                ]
            assert session.request.call_count == 2

    @pytest.mark.parametrize("fail_open", [False, True])
    def test_deferred_notification_failure_does_not_fail_commit(
        self, notification_connection, caplog, fail_open
    ):
        sync_session = MagicMock()
        with patch("plane.bgtasks.service_gateway_webhook_task.requests.Session") as session_factory:
            notification_session = session_factory.return_value.__enter__.return_value
            if fail_open:
                session_factory.side_effect = RuntimeError("session unavailable")
            else:
                notification_session.request.side_effect = requests.Timeout("send unavailable")
            with transaction.atomic():
                queue_notifications(sync_session, [321])
                assert not caplog.records
            assert "Could not trigger service-gateway" in caplog.text
            sync_session.request.assert_not_called()
            if not fail_open:
                session_factory.return_value.__exit__.assert_called_once()

    @override_settings(
        SERVICE_GATEWAY_WEBHOOK_ENABLED=True,
        SERVICE_GATEWAY_EVENT_API="https://sports.kanavio.com/sports/api/event",
    )
    def test_coaching_cards_do_not_sync_to_service_gateway(self):
        with patch("plane.bgtasks.service_gateway_webhook_task.requests.Session") as session:
            service_gateway_event_sync(
                event="issue",
                verb="updated",
                event_data={
                    "id": "card-123",
                    "category": "Coaching Card",
                    "sg_event_id": None,
                },
            )

        session.assert_not_called()

    def test_expired_ssl_error_has_user_friendly_message(self):
        error = requests.exceptions.SSLError(
            "certificate verify failed: certificate has expired"
        )

        assert _sync_error_message(error) == (
            "We couldn't reach the event service. Please try again in a few minutes. "
            "If the problem continues, contact your administrator."
        )

    @override_settings(
        SERVICE_GATEWAY_WEBHOOK_ENABLED=True,
        SERVICE_GATEWAY_EVENT_API="https://sports.kanavio.com/sports/api/event",
        SERVICE_GATEWAY_SCHEDULED_EVENT_API="https://sports.kanavio.com/sports/api/scheduled-event",
        SERVICE_GATEWAY_WEBHOOK_TIMEOUT=30,
    )
    def test_sync_raises_api_error_for_expired_certificate(self):
        error = requests.exceptions.SSLError(
            "certificate verify failed: certificate has expired"
        )

        with patch(
            "plane.bgtasks.service_gateway_webhook_task._sync_deleted_event",
            side_effect=error,
        ), pytest.raises(ServiceGatewaySyncError) as exc_info:
            service_gateway_event_sync(
                event="issue",
                verb="deleted",
                event_data={"id": "issue-123", "sg_event_id": 777},
            )

        assert exc_info.value.status_code == 502
        assert str(exc_info.value.detail["code"]) == "service_gateway_sync_failed"
        assert str(exc_info.value.detail["title"]) == "Event service unavailable"
        assert str(exc_info.value.detail["error"]) == (
            "We couldn't reach the event service. Please try again in a few minutes. "
            "If the problem continues, contact your administrator."
        )

    def test_trigger_event_send_uses_derived_send_url(self):
        session = MagicMock()

        with patch("plane.bgtasks.service_gateway_webhook_task._send_request") as mock_send_request:
            _trigger_event_send(
                session=session,
                event_api="http://drake.in:1437/api/event",
                event_send_api="",
                service_gateway_event_id=321,
                issue_id="issue-123",
                timeout=30,
            )

        mock_send_request.assert_called_once_with(
            session=session,
            method="POST",
            url="http://drake.in:1437/api/event/send",
            payload={
                "table": "event",
                "criteria": [
                    {"field": "id", "type": 0, "value": 321},
                ],
            },
            timeout=30,
        )

    def test_trigger_event_send_uses_explicit_send_url(self):
        session = MagicMock()

        with patch("plane.bgtasks.service_gateway_webhook_task._send_request") as mock_send_request:
            _trigger_event_send(
                session=session,
                event_api="http://drake.in:1437/api/event",
                event_send_api="http://drake.in:1437/api/event/send-now",
                service_gateway_event_id=654,
                issue_id="issue-456",
                timeout=45,
            )

        mock_send_request.assert_called_once_with(
            session=session,
            method="POST",
            url="http://drake.in:1437/api/event/send-now",
            payload={
                "table": "event",
                "criteria": [
                    {"field": "id", "type": 0, "value": 654},
                ],
            },
            timeout=45,
        )

    def test_trigger_event_send_swallow_errors(self):
        session = MagicMock()

        with patch(
            "plane.bgtasks.service_gateway_webhook_task._send_request",
            side_effect=requests.HTTPError("boom"),
        ):
            _trigger_event_send(
                session=session,
                event_api="http://drake.in:1437/api/event",
                event_send_api="",
                service_gateway_event_id=999,
                issue_id="issue-789",
                timeout=30,
            )

    def test_trigger_event_send_for_ids_calls_each_unique_event_id(self):
        session = MagicMock()

        with patch("plane.bgtasks.service_gateway_webhook_task._trigger_event_send") as mock_trigger_event_send:
            _trigger_event_send_for_ids(
                session=session,
                event_api="http://drake.in:1437/api/event",
                event_send_api="",
                service_gateway_event_ids=[321, None, 0, 321, 654],
                issue_id="issue-999",
                timeout=30,
            )

        assert mock_trigger_event_send.call_count == 2
        mock_trigger_event_send.assert_any_call(
            session=session,
            event_api="http://drake.in:1437/api/event",
            event_send_api="",
            service_gateway_event_id=321,
            issue_id="issue-999",
            timeout=30,
        )
        mock_trigger_event_send.assert_any_call(
            session=session,
            event_api="http://drake.in:1437/api/event",
            event_send_api="",
            service_gateway_event_id=654,
            issue_id="issue-999",
            timeout=30,
        )

    def test_sync_deleted_event_uses_sg_event_id_without_mapping(self):
        session = MagicMock()

        with patch(
            "plane.bgtasks.service_gateway_webhook_task._resolve_existing_gateway_rows",
            return_value=[],
        ), patch(
            "plane.bgtasks.service_gateway_webhook_task._trigger_event_send_for_ids"
        ) as mock_trigger_event_send_for_ids, patch(
            "plane.bgtasks.service_gateway_webhook_task._send_request"
        ) as mock_send_request, patch(
            "plane.bgtasks.service_gateway_webhook_task._set_issue_sg_event_id"
        ) as mock_set_issue_sg_event_id:
            _sync_deleted_event(
                session=session,
                event_api="http://drake.in:1437/api/event",
                event_send_api="http://drake.in:1437/api/event/send",
                scheduled_event_api="",
                timeout=30,
                event_data={"id": "issue-111", "sg_event_id": 777},
            )

        mock_trigger_event_send_for_ids.assert_called_once_with(
            session=session,
            event_api="http://drake.in:1437/api/event",
            event_send_api="http://drake.in:1437/api/event/send",
            service_gateway_event_ids=[777],
            issue_id="issue-111",
            timeout=30,
            defer_until_commit=False,
        )
        mock_send_request.assert_called_once_with(
            session=session,
            method="DELETE",
            url="http://drake.in:1437/api/event",
            payload={
                "table": "event",
                "criteria": [
                    {"field": "id", "type": 0, "value": 777},
                ],
            },
            timeout=30,
        )
        mock_set_issue_sg_event_id.assert_called_once_with({"id": "issue-111", "sg_event_id": 777}, None)
