# Python imports
import logging
from smtplib import SMTPRecipientsRefused, SMTPResponseException
from time import perf_counter
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
from plane.utils.player_invitation_email import attach_player_invitation_images
from plane.utils.roster_invitation_delivery import State, change_state, claim_queued_invitation, log_delivery


def invitation_message(invitation, user, current_site="", *, roster=None):
    workspace, email = invitation.workspace, invitation.email
    first_name = user.first_name or user.display_name or user.email
    tracked = roster is not None
    context = {"email": email, "first_name": first_name, "workspace_name": workspace.name}
    if roster is None:
        context["abs_url"] = (
            str(current_site).rstrip("/")
            + "/workspace-invitations/?"
            + urlencode({"invitation_id": str(invitation.pk), "email": email, "slug": workspace.slug})
        )
    if invitation.role == 1:
        context["inviter_name"] = (
            " ".join(part.strip() for part in (user.first_name, user.last_name) if part.strip())
            or user.display_name
            or user.email
        )
        if roster is not None:
            context["abs_url"] = player_invitation_url(invitation)
        else:
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
            if invitation_roster(invitation).exists():
                context["abs_url"] = player_invitation_url(invitation)
        context["player_name"] = roster[0].player_name if roster else ""
        context["program_names"] = list(dict.fromkeys(player.project.name for player in roster))
        subject = " ".join(f"{workspace.name}: Your player invitation".splitlines())
        html = render_to_string("emails/invitations/player_invitation.html", context)
        body = render_to_string("emails/invitations/player_invitation.txt", context).strip()
    else:
        subject = f"{first_name} has invited you to join them in {workspace.name} on Plane"
        html = render_to_string("emails/invitations/workspace_invitation.html", context)
        body = strip_tags(html)

    host, username, password, port, use_tls, use_ssl, from_email = get_email_configuration()
    connection = get_connection(
        host=host,
        port=int(port),
        username=username,
        password=password,
        use_tls=use_tls == "1",
        use_ssl=use_ssl == "1",
        **({"timeout": 10} if tracked else {}),
    )
    msg = EmailMultiAlternatives(subject=subject, body=body, from_email=from_email, to=[email], connection=connection)
    msg.attach_alternative(html, "text/html")
    if invitation.role == 1:
        attach_player_invitation_images(msg, html)
    return msg


@shared_task
def workspace_invitation(email, workspace_id, token, current_site, inviter):
    try:
        user = User.objects.get(email=inviter)
        invitation = WorkspaceMemberInvite.objects.select_related("workspace").get(
            token=token, email=email, workspace_id=workspace_id
        )
        msg = invitation_message(invitation, user, current_site)
        # Player email bodies contain a live ticket and roster details.
        WorkspaceMemberInvite.objects.filter(pk=invitation.pk).update(
            message="" if invitation.role == 1 else msg.body
        )
        msg.send()
        logging.getLogger("plane.worker").info("Email sent successfully")
        return
    except (Workspace.DoesNotExist, WorkspaceMemberInvite.DoesNotExist):
        return
    except Exception as e:
        log_exception(e)
        return


@shared_task(soft_time_limit=45, time_limit=60, ignore_result=True)
def roster_player_invitation(invitation_id, attempt_id, actor_id):
    if not claim_queued_invitation(invitation_id, attempt_id):
        return
    started = perf_counter()
    state, error_code = State.FAILED, "INVITE_PREPARATION"
    try:
        invitation = WorkspaceMemberInvite.objects.select_related("workspace").get(
            pk=invitation_id, role=1, accepted=False, responded_at__isnull=True, workspace__deleted_at__isnull=True
        )
        roster = list(invitation_roster(invitation).filter(user__isnull=True).order_by("project__name", "id"))
        if roster:
            actor = User.objects.get(pk=actor_id, is_active=True, is_bot=False)
            message = invitation_message(invitation, actor, roster=roster)
            # Recheck eligibility after preparing the email. No roster edits wait on SMTP.
            if invitation_roster(invitation).filter(user__isnull=True).exists() and (
                WorkspaceMemberInvite.objects.filter(
                    pk=invitation_id,
                    role=1,
                    accepted=False,
                    responded_at__isnull=True,
                    roster_delivery__attempt_id=attempt_id,
                    roster_delivery__state=State.SENDING,
                ).exists()
            ):
                error_code = "SMTP_CONNECT_FAILED"
                with message.connection:
                    try:
                        if message.send() == 1:
                            state, error_code = State.ACCEPTED, None
                        else:
                            error_code = "SMTP_NOT_ACCEPTED"
                    except (SMTPRecipientsRefused, SMTPResponseException):
                        error_code = "SMTP_REJECTED"
                    except Exception:
                        # A disconnect can happen after the remote server accepts the message.
                        state, error_code = State.UNCONFIRMED, "SMTP_UNCONFIRMED"
            else:
                error_code = "INVITE_NO_LONGER_ELIGIBLE"
        else:
            error_code = "INVITE_NO_LONGER_ELIGIBLE"
    except WorkspaceMemberInvite.DoesNotExist:
        error_code = "INVITE_NO_LONGER_ELIGIBLE"
    except Exception:
        pass  # Do not log SMTP errors, addresses, credentials, or invitation links.
    if change_state(invitation_id, attempt_id, State.SENDING, state):
        log_delivery(
            attempt_id,
            service="plane-worker",
            state=state,
            error_code=error_code,
            duration_ms=(perf_counter() - started) * 1000,
        )
