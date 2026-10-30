"""Player invitation delivery uses the in-memory outbox; no real SMTP is contacted."""

from html import unescape
import re
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from django.core import mail
from django.core.mail.backends.locmem import EmailBackend
from django.test import TestCase

from plane.bgtasks.workspace_invitation_task import workspace_invitation
from plane.db.models import Project, RosterPlayer, User, Workspace, WorkspaceMemberInvite


class PlayerInvitationEmailTests(TestCase):
    def setUp(self):
        self.coach = User.objects.create(email="coach@invite.test", username="invite-coach", first_name="Coach")
        self.workspace = Workspace.objects.create(name="School", slug="invitation-school", owner=self.coach)
        self.project = Project.objects.create(workspace=self.workspace, name="Football", identifier="FB")
        self.email = "player+football@invite.test"
        self.player = RosterPlayer.objects.create(project=self.project, player_name="Jordan Player", email=self.email)
        self.invitation = WorkspaceMemberInvite.objects.create(
            workspace=self.workspace, email=self.email, role=1, token="player-invitation"
        )
        self.connection = self.enterContext(
            patch("plane.bgtasks.workspace_invitation_task.get_connection", return_value=EmailBackend())
        )
        self.enterContext(
            patch(
                "plane.bgtasks.workspace_invitation_task.get_email_configuration",
                return_value=(
                    "smtp-relay.brevo.com",
                    "smtp-login",
                    "smtp-key",
                    "587",
                    "1",
                    "0",
                    "Coach <coach@invite.test>",
                ),
            )
        )

    def send(self, workspace_id=None):
        workspace_invitation.run(
            self.email,
            workspace_id or self.workspace.id,
            self.invitation.token,
            "https://sports.example/",
            self.coach.email,
        )
        return mail.outbox[-1] if mail.outbox else None

    def test_player_invitation_has_personalized_html_and_plain_text(self):
        message = self.send()
        self.assertIsNotNone(message)
        self.assertIn("player invitation", message.subject.lower())
        html = message.alternatives[0][0]
        for content in (html, message.body):
            self.assertIn("Jordan Player", content)
            self.assertIn("Football", content)
            self.assertIn("School", content)
            self.assertIn("Accept invitation", content)
            self.assertIn(self.email, content)
        self.assertEqual(message.to, [self.email])
        self.assertEqual(message.from_email, "Coach <coach@invite.test>")
        self.connection.assert_called_once_with(
            host="smtp-relay.brevo.com",
            port=587,
            username="smtp-login",
            password="smtp-key",
            use_tls=True,
            use_ssl=False,
        )
        self.invitation.refresh_from_db()
        self.assertEqual(self.invitation.message, message.body)

    def test_invitation_url_preserves_plus_email_and_has_one_path_separator(self):
        message = self.send()
        html = message.alternatives[0][0]
        href = unescape(re.search(r'href="([^"]+)"', html).group(1))
        url = urlsplit(href)
        self.assertEqual(url.scheme, "https")
        self.assertEqual(url.netloc, "sports.example")
        self.assertEqual(url.path, "/workspace-invitations/")
        self.assertEqual(
            parse_qs(url.query),
            {"email": [self.email], "slug": [self.workspace.slug], "invitation_id": [str(self.invitation.id)]},
        )
        self.assertIn(href, message.body)

    def test_programs_are_limited_to_invited_workspace_and_email(self):
        basketball = Project.objects.create(workspace=self.workspace, name="Basketball", identifier="BB")
        RosterPlayer.objects.create(project=basketball, player_name="Jordan Player", email=self.email)
        other = Workspace.objects.create(name="Other school", slug="other-invite-school", owner=self.coach)
        private = Project.objects.create(workspace=other, name="Other private team", identifier="OT")
        RosterPlayer.objects.create(project=private, player_name="Jordan Player", email=self.email)
        RosterPlayer.objects.create(project=self.project, player_name="Other Player", email="other@invite.test")
        message = self.send()
        for content in (message.body, message.alternatives[0][0]):
            self.assertIn("Football", content)
            self.assertIn("Basketball", content)
            self.assertNotIn("Other private team", content)
            self.assertNotIn("Other Player", content)

    def test_user_invitation_without_roster_has_a_generic_player_greeting(self):
        RosterPlayer.objects.filter(pk=self.player.pk).delete()
        message = self.send()
        self.assertIn("Hi there", message.body)
        self.assertIn("Accept invitation", message.body)
        self.assertNotIn("Jordan Player", message.body)

    def test_guest_invitation_keeps_the_existing_workspace_email(self):
        self.invitation.role = 5
        self.invitation.save()
        message = self.send()
        self.assertEqual(message.subject, "Coach has invited you to join them in School on Plane")
        self.assertNotIn("Your player invitation", message.alternatives[0][0])

    def test_player_template_escapes_names_and_sends_single_line_subject(self):
        self.workspace.name = "School\n<script>private</script>"
        self.workspace.save()
        message = self.send()
        self.assertIsNotNone(message)
        self.assertNotIn("\n", message.subject)
        self.assertNotIn("<script>", message.alternatives[0][0])
        self.assertIn("&lt;script&gt;", message.alternatives[0][0])

    def test_invitation_from_another_workspace_is_not_sent(self):
        other = Workspace.objects.create(name="Other", slug="wrong-email-workspace", owner=self.coach)
        self.assertIsNone(self.send(workspace_id=other.id))
