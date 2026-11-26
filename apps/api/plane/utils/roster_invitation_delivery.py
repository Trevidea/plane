"""Durable delivery state and retry windows for roster invitations."""

from datetime import timedelta
from uuid import uuid4

from django.db import transaction
from django.utils import timezone

from plane.db.models import RosterInvitationDelivery
from plane.utils.diagnostic_logging import current, emit

State = RosterInvitationDelivery.State
RETRY_DELAYS = {
    State.QUEUED: timedelta(minutes=5),
    State.SENDING: timedelta(minutes=5),
    State.ACCEPTED: timedelta(minutes=1),
    State.FAILED: timedelta(seconds=30),
    State.UNCONFIRMED: timedelta(minutes=1),
}


def delivery_details(state, changed_at):
    if state is None or changed_at is None:
        return {"status": "untracked", "retry_after": None}
    retry_after = changed_at + RETRY_DELAYS[state]
    if retry_after <= timezone.now():
        if state in (State.QUEUED, State.SENDING):
            state = State.UNCONFIRMED
        retry_after = None
    return {"status": state, "retry_after": retry_after}


def change_state(invitation_id, attempt_id, previous, state):
    return RosterInvitationDelivery.objects.filter(
        invitation_id=invitation_id, attempt_id=attempt_id, state=previous
    ).update(state=state, changed_at=timezone.now())


def claim_queued_invitation(invitation_id, attempt_id):
    now = timezone.now()
    return RosterInvitationDelivery.objects.filter(
        invitation_id=invitation_id,
        attempt_id=attempt_id,
        state=State.QUEUED,
        changed_at__gt=now - RETRY_DELAYS[State.QUEUED],
    ).update(state=State.SENDING, changed_at=now)


def log_delivery(attempt_id, *, service, state, error_code=None, duration_ms=None, context_override=None):
    ctx = context_override if context_override is not None else current.get() or {}
    emit(
        "roster.invitation." + state,
        service=service,
        outcome="error" if error_code else "ok",
        duration_ms=duration_ms,
        fields={
            "error_code": error_code,
            "dependency": "rabbitmq"
            if state in ("queued", "published", "publish_failed", "retry", "retry_blocked")
            else "smtp",
            "channel": "email",
            "result": state,
            "delivery_attempt_id": str(attempt_id),
        },
        context_override={**ctx, "operation_id": ctx.get("operation_id") or str(attempt_id)},
    )


def queue_roster_invitation(invitation, actor_id):
    """The caller holds the workspace lock; resends also lock the current attempt."""
    from plane.bgtasks.workspace_invitation_task import roster_player_invitation

    delivery = RosterInvitationDelivery.objects.select_for_update().filter(invitation=invitation).first()
    if delivery and delivery_details(delivery.state, delivery.changed_at)["retry_after"]:
        log_delivery(delivery.attempt_id, service="plane-api", state="retry_blocked")
        return
    attempt_id = uuid4()
    operation = dict(current.get() or {})
    RosterInvitationDelivery.objects.update_or_create(
        invitation=invitation,
        defaults={"attempt_id": attempt_id, "state": State.QUEUED, "changed_at": timezone.now()},
    )

    def enqueue():
        def log(state, error_code=None):
            log_delivery(
                attempt_id, service="plane-api", state=state, error_code=error_code, context_override=operation
            )

        if delivery:
            log("retry")
        log("queued")
        try:
            roster_player_invitation.apply_async(
                args=(str(invitation.pk), str(attempt_id), str(actor_id)),
                retry=False,
                **({"headers": {"kanavio_diagnostics": operation}} if operation else {}),
            )
        except Exception:
            # A broker failure must not undo or misreport the already committed roster save.
            try:
                change_state(invitation.pk, attempt_id, State.QUEUED, State.FAILED)
            except Exception:
                # The durable attempt becomes unconfirmed after its retry window.
                log("unconfirmed", "DELIVERY_STATE_WRITE")
            log("publish_failed", "INVITE_QUEUE_PUBLISH")
        else:
            log("published")

    transaction.on_commit(enqueue)
