from rest_framework import serializers
from datetime import timedelta
from django.utils.dateparse import parse_datetime
from django.utils import timezone

from plane.db.models import CardStageHistory, State
from plane.utils.coaching_card_stages import build_stage_config


DEFAULT_COACHING_NAMES = (
    "Identified",
    "Assigned",
    "In Work",
    "Ready for Coach Review",
    "Resolved",
)


def default_project_state_definitions(project):
    """Create visible coaching defaults for sport programs, preserving legacy defaults otherwise."""
    if not project.sport:
        names = ("Backlog", "Todo", "In Progress", "Done")
        groups = ("backlog", "unstarted", "started", "completed")
        colors = ("#60646C", "#60646C", "#F59E0B", "#46A758")
        first_sequence = 15000
    else:
        names = DEFAULT_COACHING_NAMES
        groups = ("backlog", "unstarted", "started", "started", "completed")
        colors = tuple(
            "#46A758" if group == "completed" else "#F59E0B" if group == "started" else "#60646C" for group in groups
        )
        first_sequence = 5000

    states = [
        {
            "name": name,
            "color": colors[index],
            "sequence": first_sequence + index * 10000,
            "group": groups[index],
            "default": index == 0,
        }
        for index, name in enumerate(names)
    ]
    states.append(
        {
            "name": "Cancelled",
            "color": "#9AA4BC",
            "sequence": first_sequence + len(names) * 10000,
            "group": "cancelled",
            "default": False,
        }
    )
    return states


def get_project_card_stage_config(project):
    if not (project.sport or "").strip():
        raise serializers.ValidationError({"sport": ["The program needs a sport for coaching stages."]})

    states = list(
        State.objects.filter(project=project, is_triage=False, deleted_at__isnull=True)
        .exclude(group="cancelled")
        .order_by("sequence", "id")
    )
    try:
        return build_stage_config(
            project.sport,
            [{"id": state.id, "name": state.name, "sequence": state.sequence} for state in states],
        )
    except ValueError as exc:
        raise serializers.ValidationError({"stages": [str(exc)]}) from exc


def review_stage_ids(config):
    stages = config["stages"]
    if (
        len(stages) >= 3
        and stages[1]["name"].casefold() == "assigned"
        and stages[2]["name"].casefold() in {"player reviewed", "in work"}
    ):
        return stages[1]["id"], stages[2]["id"]
    return None


def transition_coaching_card(card, target_stage_id, actor):
    config = get_project_card_stage_config(card.project)
    current = next((stage for stage in config["stages"] if stage["id"] == str(card.state_id)), None)
    if current is None or str(target_stage_id) not in current["allowed_next_stage_ids"]:
        raise serializers.ValidationError({"stage_id": ["Select a different stage on this coaching board."]})

    target = State.objects.filter(project=card.project, pk=target_stage_id, is_triage=False).first()
    if target is None:
        raise serializers.ValidationError({"stage_id": ["The stage is not in this sport's board."]})

    previous = card.state
    previous_name = next(stage["name"] for stage in config["stages"] if stage["id"] == str(previous.id))
    target_name = next(stage["name"] for stage in config["stages"] if stage["id"] == str(target.id))
    data = dict(card.coaching_card_data or {})
    data["stage_id"] = str(target.id)
    review_stages = review_stage_ids(config)
    if review_stages and str(target.id) == review_stages[0] and data.get("recipient_ids"):
        assigned_at = timezone.now()
        data["review"] = {
            "assigned_at": assigned_at.isoformat(),
            "deadline_at": (assigned_at + timedelta(days=3)).isoformat(),
            "viewed_by": {},
        }
    elif actor is not None and review_stages and str(previous.id) == review_stages[0]:
        review = dict(data.get("review") or {})
        if review.get("assigned_at") and not review.get("completed_at"):
            review["completed_at"] = timezone.now().isoformat()
            review["completion_reason"] = "coach_override"
            data["review"] = review
    card.state = target
    card.coaching_card_data = data
    card.save()
    CardStageHistory.objects.create(
        issue=card,
        from_stage_id=previous.id,
        from_stage_name=previous_name,
        to_stage_id=target.id,
        to_stage_name=target_name,
        changed_by=actor,
    )
    return card


def advance_card_after_review(card, now):
    """Advance only an assigned broadcast card whose viewers or deadline satisfy review."""
    data = dict(card.coaching_card_data or {})
    recipient_ids = data.get("recipient_ids") or []
    review = dict(data.get("review") or {})
    config = get_project_card_stage_config(card.project)
    review_stages = review_stage_ids(config)
    if not review_stages or str(card.state_id) != review_stages[0] or not recipient_ids:
        return False

    viewed_by = review.get("viewed_by") or {}
    all_viewed = all(player_id in viewed_by for player_id in recipient_ids)
    deadline_at = review.get("deadline_at")
    deadline = parse_datetime(deadline_at) if deadline_at else None
    if not all_viewed and (deadline is None or deadline > now):
        return False

    review["completed_at"] = now.isoformat()
    review["completion_reason"] = "all_viewed" if all_viewed else "three_day_timeout"
    data["review"] = review
    card.coaching_card_data = data
    transition_coaching_card(card, review_stages[1], None)
    return True
