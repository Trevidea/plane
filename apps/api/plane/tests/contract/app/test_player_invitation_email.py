"""Player invitation delivery uses the in-memory outbox; no real SMTP is contacted."""

from html import unescape
import re
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from django.core import mail
from django.core.mail.backends.locmem import EmailBackend
from django.test import TestCase, override_settings
from plane.utils.player_invitations import player_app_url, ticket_data

from plane.bgtasks.workspace_invitation_task import workspace_invitation
from plane.db.models import Project, RosterPlayer, User, Workspace, WorkspaceMemberInvite


@override_settings(PLAYER_APP_API_URL="https://sports.example")
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

    def send(self, workspace_id=None, inviter=None):
        workspace_invitation.run(
            self.email,
            workspace_id or self.workspace.id,
            self.invitation.token,
            "https://sports.example/",
            (inviter or self.coach).email,
        )
        return mail.outbox[-1] if mail.outbox else None

    def test_player_invitation_names_actual_inviter_workspace_and_program(self):
        inviter = User.objects.create(
            email="inviting-coach@invite.test", username="inviting-coach", first_name="Taylor", last_name="Coach"
        )
        message = self.send(inviter=inviter)
        expected = "Taylor Coach has invited you to join Football in School as a player."
        self.assertIn(expected, message.body)
        html_text = unescape(re.sub(r"<[^>]+>", "", message.alternatives[0][0]))
        self.assertIn(expected, re.sub(r"\s+", " ", html_text))
        self.assertIn("Hi Jordan Player", message.body)
        # The actual inviter differs from both the workspace owner and SMTP sender.
        self.assertEqual(message.from_email, "Coach <coach@invite.test>")

    def test_inviter_without_personal_name_uses_display_name(self):
        self.coach.first_name = ""
        self.coach.last_name = ""
        self.coach.display_name = "Coaching Staff"
        self.coach.save()
        message = self.send()
        self.assertIn("Coaching Staff has invited you to join Football in School", message.body)

    def test_player_invitation_has_personalized_html_and_plain_text(self):
        message = self.send()
        self.assertIsNotNone(message)
        self.assertIn("player invitation", message.subject.lower())
        html = message.alternatives[0][0]
        for content in (html, message.body):
            self.assertIn("Jordan Player", content)
            self.assertIn("Football", content)
            self.assertIn("School", content)
            self.assertRegex(content, r"Accept (?:invitation|the invite)")
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
        self.assertEqual(url.path, "/auth/player-invitation/")
        ticket = parse_qs(url.query)["token"][0]
        self.assertEqual(ticket_data(ticket)["id"], str(self.invitation.id))
        self.assertEqual(ticket_data(ticket)["nonce"], self.invitation.token)
        self.assertIn(href, message.body)

    @override_settings(PLAYER_APP_API_URL="http://192.168.1.207:8000")
    def test_local_invitation_and_mobile_link_use_local_api_despite_other_current_site(self):
        message = self.send()
        html = message.alternatives[0][0]
        href = unescape(re.search(r'href="([^"]+)"', html).group(1))
        url = urlsplit(href)
        self.assertEqual((url.scheme, url.netloc, url.path), ("http", "192.168.1.207:8000", "/auth/player-invitation/"))
        self.assertIn(href, message.body)
        self.assertNotIn("https://sports.example", message.body)
        self.assertNotIn("https://sports.example", html)
        token = parse_qs(url.query)["token"][0]
        app = urlsplit(player_app_url(token))
        self.assertEqual(app.scheme, "kanavioplayerapp")
        self.assertEqual(parse_qs(app.query)["server"], ["http://192.168.1.207:8000"])
        self.assertEqual(parse_qs(app.query)["token"], [token])

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
