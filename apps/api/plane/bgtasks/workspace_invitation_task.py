# Python imports
import logging
from urllib.parse import urlencode

# Third party imports
from celery import shared_task

# Django imports
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string
from django.utils.html import strip_tags

# Module imports
from plane.db.models import RosterPlayer, User, Workspace, WorkspaceMemberInvite
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.exception_logger import log_exception
from plane.utils.player_invitations import invitation_roster, player_invitation_url


@shared_task
def workspace_invitation(email, workspace_id, token, current_site, inviter):
    try:
        user = User.objects.get(email=inviter)

        workspace = Workspace.objects.get(pk=workspace_id)
        workspace_member_invite = WorkspaceMemberInvite.objects.get(token=token, email=email, workspace_id=workspace.id)

        # Relative link
        relative_link = "/workspace-invitations/?" + urlencode(
            {
                "invitation_id": str(workspace_member_invite.id),
                "email": email,
                "slug": workspace.slug,
            }
        )

        # The complete url including the domain
        abs_url = str(current_site).rstrip("/") + relative_link

        (
            EMAIL_HOST,
            EMAIL_HOST_USER,
            EMAIL_HOST_PASSWORD,
            EMAIL_PORT,
            EMAIL_USE_TLS,
            EMAIL_USE_SSL,
            EMAIL_FROM,
        ) = get_email_configuration()

        # Subject of the email
        subject = f"{user.first_name or user.display_name or user.email} has invited you to join them in {workspace.name} on Plane"  # noqa: E501

        context = {
            "email": email,
            "first_name": user.first_name or user.display_name or user.email,
            "workspace_name": workspace.name,
            "abs_url": abs_url,
        }

        if workspace_member_invite.role == 1:
            context["inviter_name"] = (
                " ".join(part.strip() for part in (user.first_name, user.last_name) if part.strip())
                or user.display_name
                or user.email
            )
            roster = list(
                RosterPlayer.objects.filter(
                    workspace_id=workspace.id,
                    project__workspace_id=workspace.id,
                    email__iexact=email,
                    project__deleted_at__isnull=True,
                    project__archived_at__isnull=True,
                )
                .select_related("project")
                .order_by("project__name", "id")
            )
            context["player_name"] = roster[0].player_name if roster else ""
            context["program_names"] = list(dict.fromkeys(player.project.name for player in roster))
            if invitation_roster(workspace_member_invite).exists():
                context["abs_url"] = player_invitation_url(workspace_member_invite)
            subject = " ".join(f"{workspace.name}: Your player invitation".splitlines())
            html_content = render_to_string("emails/invitations/player_invitation.html", context)
            text_content = render_to_string("emails/invitations/player_invitation.txt", context).strip()
        else:
            html_content = render_to_string("emails/invitations/workspace_invitation.html", context)
            text_content = strip_tags(html_content)

        workspace_member_invite.message = text_content
        workspace_member_invite.save()

        connection = get_connection(
            host=EMAIL_HOST,
            port=int(EMAIL_PORT),
            username=EMAIL_HOST_USER,
            password=EMAIL_HOST_PASSWORD,
            use_tls=EMAIL_USE_TLS == "1",
            use_ssl=EMAIL_USE_SSL == "1",
        )

        msg = EmailMultiAlternatives(
            subject=subject,
            body=text_content,
            from_email=EMAIL_FROM,
            to=[email],
            connection=connection,
        )
        msg.attach_alternative(html_content, "text/html")
        msg.send()
        logging.getLogger("plane.worker").info("Email sent successfully")
        return
    except (Workspace.DoesNotExist, WorkspaceMemberInvite.DoesNotExist):
        return
    except Exception as e:
        log_exception(e)
        return
