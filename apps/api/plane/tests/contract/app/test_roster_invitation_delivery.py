from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from smtplib import SMTPDataError
from threading import Barrier
from unittest.mock import patch

from django.core import mail
from django.core.mail.backends.locmem import EmailBackend
from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from plane.bgtasks.workspace_invitation_task import roster_player_invitation
from plane.db.models import Project, ProjectMember, RosterInvitationDelivery, RosterPlayer, User, Workspace
from plane.db.models import WorkspaceMember, WorkspaceMemberInvite
from plane.utils.diagnostic_logging import current


@override_settings(PLAYER_APP_API_URL="https://sports.example")
class RosterInvitationDeliveryTests(TestCase):
    def setUp(self):
        self.coach = User.objects.create(email="coach@delivery.test", username="delivery-coach")
        self.workspace = Workspace.objects.create(name="School", slug="delivery-school", owner=self.coach)
        self.project = Project.objects.create(workspace=self.workspace, name="Football", identifier="FB")
        self.membership = WorkspaceMember.objects.create(workspace=self.workspace, member=self.coach, role=20)
        ProjectMember.objects.create(project=self.project, member=self.coach, role=20)
        self.client = APIClient()
        self.client.force_authenticate(self.coach)
        self.url = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.pk}/roster/"
        self.address = "player@delivery.test"
        self.publish = self.enterContext(patch.object(roster_player_invitation, "apply_async"))
        self.backend = EmailBackend()
        self.enterContext(patch("plane.bgtasks.workspace_invitation_task.get_connection", return_value=self.backend))
        self.enterContext(
            patch(
                "plane.bgtasks.workspace_invitation_task.get_email_configuration",
                return_value=("localhost", "smtp-login", "smtp-secret", "587", "1", "0", "staff@delivery.test"),
            )
        )
        self.emit = self.enterContext(patch("plane.utils.roster_invitation_delivery.emit"))

    def create_player(self, **extra):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                self.url, {"player_name": "Practice Player", "email": self.address, **extra}, format="json"
            )
        self.assertEqual(response.status_code, 201, response.data)
        self.player_id = response.data["id"]
        return response.data

    def resend(self, player_id=None):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(f"{self.url}{player_id or self.player_id}/resend-invitation/", {}, format="json")

    def metadata(self):
        return self.client.get(f"{self.url}{self.player_id}/").data["invitation_delivery"]

    def age_delivery(self, minutes=10):
        RosterInvitationDelivery.objects.update(changed_at=timezone.now() - timedelta(minutes=minutes))

    def test_one_tracked_send_with_personal_link_even_on_duplicate_delivery(self):
        created = self.create_player()
        self.assertEqual(created["invitation_delivery"]["status"], "queued")
        self.assertEqual(created["account_status"], "invitation_pending")
        args = self.publish.call_args.kwargs["args"]
        self.assertNotIn(self.address, repr(args))
        roster_player_invitation.run(*args)
        roster_player_invitation.run(*args)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.address])
        self.assertIn("https://sports.example/auth/player-invitation/#token=", mail.outbox[0].body)
        self.assertEqual(self.metadata()["status"], "accepted")
        self.assertEqual(self.client.get(self.url).data[0]["invitation_delivery"]["status"], "accepted")
        self.assertEqual(self.client.get(f"{self.url}{self.player_id}/").data["account_status"], "invitation_pending")
        self.assertIsNone(WorkspaceMemberInvite.objects.get().message)
        self.assertEqual(self.resend().status_code, 200)
        self.publish.assert_called_once()

    def test_broker_failure_keeps_roster_and_allows_cooldown_retry(self):
        self.publish.side_effect = RuntimeError("private broker URL with credentials")
        self.create_player()
        self.assertTrue(RosterPlayer.objects.filter(pk=self.player_id, user__isnull=True).exists())
        self.assertEqual(self.metadata()["status"], "failed")
        self.assertEqual(self.resend().status_code, 200)
        self.publish.assert_called_once()
        self.assertNotIn("private broker", repr(self.emit.call_args_list))
        self.age_delivery()
        self.publish.side_effect = None
        self.assertEqual(self.resend().data["invitation_delivery"]["status"], "queued")
        self.assertEqual(self.publish.call_count, 2)

    def test_retry_ignores_expired_queued_jobs_and_stale_tasks(self):
        self.create_player()
        old_args = self.publish.call_args.kwargs["args"]
        self.age_delivery()
        self.assertEqual(self.metadata(), {"status": "unconfirmed", "retry_after": None})
        roster_player_invitation.run(*old_args)
        self.assertEqual(mail.outbox, [])
        self.assertEqual(self.resend().status_code, 200)
        new_args = self.publish.call_args.kwargs["args"]
        self.assertNotEqual(old_args[1], new_args[1])
        self.assertEqual(self.resend().status_code, 200)
        self.assertEqual(self.publish.call_count, 2)
        roster_player_invitation.run(*old_args)
        roster_player_invitation.run(*new_args)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(self.metadata()["status"], "accepted")

    def test_smtp_rejection_does_not_copy_raw_error_into_diagnostics(self):
        self.create_player()
        with patch.object(self.backend, "send_messages", side_effect=SMTPDataError(550, b"private recipient")):
            roster_player_invitation.run(*self.publish.call_args.kwargs["args"])
        self.assertEqual(self.metadata()["status"], "failed")
        self.assertIn("SMTP_REJECTED", repr(self.emit.call_args_list))
        self.assertNotIn("private recipient", repr(self.emit.call_args_list))

    def test_invitation_carries_operation_and_attempt_across_commit_and_worker(self):
        operation = "enr-" + "b" * 32
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url, {"player_name": "Private player", "email": self.address},
                                        format="json", HTTP_X_KANAVIO_OPERATION_ID=operation)
        self.assertEqual(response.status_code, 201)
        job = self.publish.call_args.kwargs
        context = job["headers"]["kanavio_diagnostics"]
        self.assertEqual(context["operation_id"], operation)
        saved = current.set(context)
        try:
            roster_player_invitation.run(*job["args"])
        finally:
            current.reset(saved)
        logs = {call.args[0]: call.kwargs for call in self.emit.call_args_list}
        for event in ("queued", "published", "accepted"):
            record = logs[f"roster.invitation.{event}"]
            self.assertEqual(record["context_override"]["operation_id"], operation)
            self.assertEqual(record["fields"]["delivery_attempt_id"], job["args"][1])
            self.assertEqual(record["fields"]["channel"], "email")
        self.assertNotIn(self.address, repr(logs))

    def test_disconnect_during_send_is_not_marked_delivered_or_rejected(self):
        self.create_player()
        with patch.object(self.backend, "send_messages", side_effect=TimeoutError("private SMTP response")):
            roster_player_invitation.run(*self.publish.call_args.kwargs["args"])
        self.assertEqual(self.metadata()["status"], "unconfirmed")

    def test_connection_failure_is_not_an_uncertain_send(self):
        self.create_player()
        with patch.object(self.backend, "open", side_effect=ConnectionRefusedError):
            roster_player_invitation.run(*self.publish.call_args.kwargs["args"])
        self.assertEqual(self.metadata()["status"], "failed")
        self.assertIn("SMTP_CONNECT_FAILED", repr(self.emit.call_args_list))

    def test_worker_does_not_send_for_an_inactive_player(self):
        self.create_player()
        RosterPlayer.objects.filter(pk=self.player_id).update(status="inactive")
        roster_player_invitation.run(*self.publish.call_args.kwargs["args"])
        self.assertEqual(mail.outbox, [])
        self.assertIsNone(self.metadata())
        self.assertEqual(self.resend().status_code, 409)

    def test_legacy_player_invitation_has_unknown_delivery_and_can_be_resent(self):
        WorkspaceMemberInvite.objects.create(workspace=self.workspace, email=self.address, role=1, token="legacy")
        self.assertEqual(self.create_player()["invitation_delivery"]["status"], "untracked")
        self.publish.assert_not_called()
        self.assertEqual(self.resend().data["invitation_delivery"]["status"], "queued")
        self.publish.assert_called_once()

    def test_staff_invitation_is_neither_displayed_nor_resendable(self):
        WorkspaceMemberInvite.objects.create(workspace=self.workspace, email=self.address, role=15, token="staff")
        self.assertIsNone(self.create_player()["invitation_delivery"])
        self.assertEqual(self.resend().status_code, 409)
        self.publish.assert_not_called()

    def test_blank_email_has_no_delivery_and_stays_on_roster(self):
        self.assertIsNone(self.create_player(email="")["invitation_delivery"])
        self.assertEqual(self.resend().status_code, 409)
        self.publish.assert_not_called()

    def test_workspace_guest_cannot_read_delivery_status_or_resend(self):
        self.create_player()
        self.publish.reset_mock()
        self.membership.role = 5
        self.membership.save(update_fields=["role"])
        self.assertIsNone(self.metadata())
        self.assertEqual(self.resend().status_code, 403)
        self.publish.assert_not_called()

    def test_same_email_on_two_programs_keeps_one_invite_and_attempt(self):
        created = self.create_player()
        second = Project.objects.create(workspace=self.workspace, name="Basketball", identifier="BB")
        ProjectMember.objects.create(project=second, member=self.coach, role=20)
        self.url = f"/api/workspaces/{self.workspace.slug}/projects/{second.pk}/roster/"
        self.assertEqual(self.resend(created["id"]).status_code, 404)
        another = self.create_player()
        self.assertNotEqual(created["id"], another["id"])
        self.assertEqual(another["invitation_delivery"]["status"], "queued")
        self.assertEqual(WorkspaceMemberInvite.objects.count(), 1)
        self.assertEqual(RosterInvitationDelivery.objects.count(), 1)
        self.publish.assert_called_once()


class RosterInvitationRetryConcurrencyTests(TransactionTestCase):
    available_apps = ["plane.db"]

    def test_concurrent_resends_share_one_attempt(self):
        actor = User.objects.create(email="retry@delivery.test", username="retry-coach")
        workspace = Workspace.objects.create(name="School", slug="retry-school", owner=actor)
        project = Project.objects.create(workspace=workspace, name="Football", identifier="FB")
        WorkspaceMember.objects.create(workspace=workspace, member=actor, role=20)
        ProjectMember.objects.create(project=project, member=actor, role=20)
        player = RosterPlayer.objects.create(project=project, player_name="Retry Player", email="player@delivery.test")
        WorkspaceMemberInvite.objects.create(workspace=workspace, email=player.email, role=1, token="legacy")
        url = f"/api/workspaces/{workspace.slug}/projects/{project.pk}/roster/{player.pk}/resend-invitation/"
        simultaneous = Barrier(2, timeout=5)

        def resend():
            try:
                client = APIClient()
                client.force_authenticate(actor)
                simultaneous.wait()
                response = client.post(url, {}, format="json")
                return response.status_code, response.data["invitation_delivery"]["status"]
            finally:
                close_old_connections()

        with patch.object(roster_player_invitation, "apply_async") as publish, ThreadPoolExecutor(2) as threads:
            requests = [threads.submit(resend) for _ in range(2)]
            self.assertEqual([request.result(timeout=10) for request in requests], [(200, "queued"), (200, "queued")])
        self.assertEqual(RosterInvitationDelivery.objects.count(), 1)
        publish.assert_called_once()
