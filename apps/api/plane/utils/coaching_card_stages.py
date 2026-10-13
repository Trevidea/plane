"""Project state based lifecycle contract for a sport's coaching board."""

from math import isfinite


def build_stage_config(sport, states):
    sport = (sport or "").strip()
    if not sport:
        raise ValueError("A project sport is required for coaching stages.")

    # Settings order groups first; sequence values are only comparable within a group.
    group_order = {
        group: index for index, group in enumerate(("backlog", "unstarted", "started", "completed", "cancelled"))
    }
    ordered = sorted(
        states,
        key=lambda state: (group_order.get(state.get("group"), 0), state["sequence"], str(state["id"])),
    )
    if not ordered:
        raise ValueError("At least one coaching stage is required.")

    seen = set()
    stages = []
    for index, state in enumerate(ordered):
        stage_id = str(state["id"])
        name = str(state["name"]).strip()
        sequence = state["sequence"]
        if not stage_id or stage_id in seen or not name or not isfinite(sequence):
            raise ValueError("Coaching stages need unique IDs, names, and finite order values.")
        seen.add(stage_id)
        abbreviation = "".join(part[0].upper() for part in name.split())[:4]
        stages.append(
            {
                "id": stage_id,
                "name": name,
                "lifecycle_role": state.get("lifecycle_role", ""),
                "order": index,
                "abbreviation": abbreviation,
                "allowed_next_stage_ids": [
                    str(ordered[other]["id"]) for other in (index - 1, index + 1) if 0 <= other < len(ordered)
                ],
            }
        )

    initial = next((stage for stage in stages if stage["lifecycle_role"] == "identified"), stages[0])
    config = {"sport": sport, "initial_stage_id": initial["id"], "stages": stages}
    verified = next((stage for stage in stages if stage["lifecycle_role"] == "verified"), None)
    closed = next((stage for stage in stages if stage["lifecycle_role"] == "closed"), None)
    if verified and closed:
        verified["allowed_next_stage_ids"] = list(dict.fromkeys([*verified["allowed_next_stage_ids"], closed["id"]]))
        closed["allowed_next_stage_ids"] = [verified["id"]]
    review_stages = review_stage_ids(config)
    if review_stages:
        assigned_stage = next(stage for stage in stages if stage["id"] == review_stages[0])
        if review_stages[1] in assigned_stage["allowed_next_stage_ids"]:
            assigned_stage["allowed_next_stage_ids"].remove(review_stages[1])
    return config


def review_stage_ids(config):
    stages = config["stages"]
    assigned = next((stage for stage in stages if stage.get("lifecycle_role") == "assigned"), None)
    reviewed = next((stage for stage in stages if stage.get("lifecycle_role") == "reviewed"), None)
    if assigned and reviewed:
        return assigned["id"], reviewed["id"]
    if (
        len(stages) >= 3
        and stages[1]["name"].casefold() == "assigned"
        and stages[2]["name"].casefold() in {"player reviewed", "in work"}
    ):
        return stages[1]["id"], stages[2]["id"]
    return None


def validate_stage_transition(config, current_stage_id, target_stage_id, recipient_ids, reason, is_system=False):
    stages = config["stages"]
    indexes = {stage["id"]: index for index, stage in enumerate(stages)}
    current = indexes.get(str(current_stage_id))
    target = indexes.get(str(target_stage_id))
    if current is None or target is None or current == target:
        raise ValueError("Select a different stage on this coaching board.")
    review_stages = review_stage_ids(config)
    if is_system:
        if not review_stages or (str(current_stage_id), str(target_stage_id)) != review_stages:
            raise ValueError("Only player review can advance a coaching card automatically.")
        return
    if stages[target].get("lifecycle_role") == "closed":
        if stages[current].get("lifecycle_role") != "verified":
            raise ValueError("Verify the card before closing it.")
        return
    if stages[current].get("lifecycle_role") == "closed":
        if stages[target].get("lifecycle_role") != "verified":
            raise ValueError("Reopen the card to its verification state first.")
        if not reason.strip():
            raise ValueError("A reason is required to reopen this coaching card.")
        return
    if target < current:
        if target != current - 1:
            raise ValueError("Reopen the card one stage at a time.")
        if not reason.strip():
            raise ValueError("A reason is required to reopen this coaching card.")
        return
    if review_stages and str(current_stage_id) == review_stages[0]:
        raise ValueError("Player review is automatic. This card cannot be advanced manually from Assigned.")
    if target != current + 1:
        raise ValueError(f"One stage at a time. {stages[current + 1]['name']} comes first.")
    if (
        stages[target].get("lifecycle_role") == "assigned" or stages[target]["name"].casefold() == "assigned"
    ) and not recipient_ids:
        raise ValueError("Assign at least one player or position group before moving to Assigned.")


def next_stage_id(config, current_stage_id):
    for index, stage in enumerate(config["stages"]):
        if stage["id"] == str(current_stage_id):
            return config["stages"][index + 1]["id"] if index + 1 < len(config["stages"]) else None
    return None
