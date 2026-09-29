"""Project state based lifecycle contract for a sport's coaching board."""

from math import isfinite


def build_stage_config(sport, states):
    sport = (sport or "").strip()
    if not sport:
        raise ValueError("A project sport is required for coaching stages.")

    ordered = sorted(states, key=lambda state: (state["sequence"], str(state["id"])))
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
                "order": index,
                "abbreviation": abbreviation,
                "allowed_next_stage_ids": [str(ordered[index + 1]["id"])] if index + 1 < len(ordered) else [],
            }
        )

    return {"sport": sport, "initial_stage_id": stages[0]["id"], "stages": stages}


def next_stage_id(config, current_stage_id):
    for stage in config["stages"]:
        if stage["id"] == str(current_stage_id):
            return next(iter(stage["allowed_next_stage_ids"]), None)
    return None
