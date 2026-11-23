import pytest

from plane.api.serializers.issue import IssueSerializer as APIIssueSerializer
from plane.app.serializers.issue import IssueCreateSerializer as AppIssueSerializer
from plane.db.models import Issue, Project


@pytest.fixture
def program(workspace):
    return Project.objects.create(
        workspace=workspace,
        name="American Football",
        identifier="AFB",
        event_season="2026-2027",
        event_program="Men",
        event_level="Varsity",
    )


@pytest.mark.django_db
@pytest.mark.parametrize("serializer_class", [AppIssueSerializer, APIIssueSerializer])
def test_event_uses_program_metadata_and_ignores_overrides(program, serializer_class):
    context = {"project_id": program.pk, "workspace_id": program.workspace_id, "default_assignee_id": None}
    serializer = serializer_class(
        data={"name": "Season opener", "year": "2020-2021", "program": "Women", "level": "JV"},
        context=context,
    )
    assert serializer.is_valid(), serializer.errors
    event = serializer.save()
    assert (event.year, event.program, event.level) == ("2026-2027", "Men", "Varsity")

    program.event_season = "2027-2028"
    program.save(update_fields=["event_season"])
    serializer = serializer_class(
        event,
        data={"name": "Updated opener", "year": None, "program": "Women", "level": "JV"},
        partial=True,
        context=context,
    )
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    event.refresh_from_db()
    assert event.name == "Updated opener"
    assert (event.year, event.program, event.level) == ("2026-2027", "Men", "Varsity")
    next_event = Issue.objects.create(project=program, name="Next season opener")
    assert (next_event.year, next_event.program, next_event.level) == ("2027-2028", "Men", "Varsity")


@pytest.mark.django_db
def test_event_inherits_unset_values_without_using_client_overrides(workspace):
    program = Project.objects.create(workspace=workspace, name="Legacy", identifier="LEG")
    event = Issue.objects.create(project=program, name="Scheduled event", year="2026-2027", program="Men", level="JV")
    assert (event.year, event.program, event.level) == (None, None, None)


@pytest.mark.django_db
def test_coaching_card_keeps_its_source_metadata(program):
    card = Issue.objects.create(
        project=program,
        name="Historical footage",
        year="2025-2026",
        program="Women",
        level="JV",
        category="Coaching Card",
        coaching_card_data={"metadata": {"season": "2025-2026"}},
    )
    assert (card.year, card.program, card.level) == ("2025-2026", "Women", "JV")
