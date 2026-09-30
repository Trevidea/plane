from rest_framework import serializers

from plane.db.models import CardStageHistory, State
from plane.utils.coaching_card_stages import build_stage_config, next_stage_id


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
        groups = []
        for index in range(len(names)):
            if index < 2:
                groups.append("backlog")
            elif index == len(names) - 1:
                groups.append("completed")
            elif index == 2:
                groups.append("unstarted")
            else:
                groups.append("started")
        colors = tuple(
            "#46A758" if group == "completed" else "#F59E0B" if group == "started" else "#60646C"
            for group in groups
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


def transition_coaching_card(card, target_stage_id, actor):
    config = get_project_card_stage_config(card.project)
    if next_stage_id(config, card.state_id) != str(target_stage_id):
        raise serializers.ValidationError({"stage_id": ["Only the immediate next stage is allowed."]})

    target = State.objects.filter(project=card.project, pk=target_stage_id, is_triage=False).first()
    if target is None:
        raise serializers.ValidationError({"stage_id": ["The stage is not in this sport's board."]})

    previous = card.state
    previous_name = next(stage["name"] for stage in config["stages"] if stage["id"] == str(previous.id))
    target_name = next(stage["name"] for stage in config["stages"] if stage["id"] == str(target.id))
    data = dict(card.coaching_card_data or {})
    data["stage_id"] = str(target.id)
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
