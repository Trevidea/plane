from plane.db.models import IssueUserProperty, ProjectMember, State
from plane.utils.coaching_card_lifecycle import default_project_state_definitions


def initialize_program(project, actor):
    for user_id in {actor.pk, project.project_lead_id} - {None}:
        ProjectMember.objects.create(project=project, member_id=user_id, role=20)
        IssueUserProperty.objects.create(project=project, user_id=user_id)

    State.objects.bulk_create(
        [
            State(
                name=state["name"],
                color=state["color"],
                project=project,
                sequence=state["sequence"],
                workspace=project.workspace,
                group=state["group"],
                default=state.get("default", False),
                lifecycle_role=state.get("lifecycle_role", ""),
                created_by=actor,
            )
            for state in default_project_state_definitions(project)
        ]
    )
