from html import escape
from uuid import UUID, uuid4
from urllib.parse import quote

from django.db import transaction
from django.db.models import Min
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.exceptions import NotFound

from plane.app.permissions import ROLE, allow_permission
from plane.db.models import Issue, Project, RosterPlayer, State
from plane.utils.coaching_card import COACHING_CARD_CATEGORY, COACHING_CARD_KIND
from plane.utils.coaching_card_media import build_uploaded_video_card_source, choose_card_context_value
from plane.utils.media_library import manifest_path, read_manifest, resolve_artifact_metadata, validate_segment

from .. import BaseAPIView


class CoachingCardClipSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=512)
    id = serializers.CharField(max_length=255)
    title = serializers.CharField(max_length=255)
    thumbnail = serializers.CharField(max_length=2048, allow_blank=True, allow_null=True, required=False)
    duration_seconds = serializers.FloatField(min_value=0, allow_null=True, required=False)
    timecode = serializers.CharField(max_length=100, allow_blank=True, required=False)
    team = serializers.CharField(max_length=100, allow_blank=True, required=False)
    detail = serializers.CharField(max_length=255, allow_blank=True, required=False)
    result = serializers.CharField(max_length=255, allow_blank=True, required=False)
    secondary_detail = serializers.CharField(max_length=255, allow_blank=True, required=False)
    group = serializers.CharField(max_length=255, allow_blank=True, required=False)


class CoachingCardPlaylistSerializer(serializers.Serializer):
    id = serializers.CharField(max_length=255)
    name = serializers.CharField(max_length=255)
    clips = CoachingCardClipSerializer(many=True, allow_empty=False, max_length=500)


class CoachingCardMediaSourceSerializer(serializers.Serializer):
    package_id = serializers.CharField(max_length=255)
    artifact_id = serializers.CharField(max_length=255)

    def validate_package_id(self, value):
        return validate_segment(value, "package_id")

    def validate_artifact_id(self, value):
        return validate_segment(value, "artifact_id")


class CoachingCardContextSerializer(serializers.Serializer):
    sport = serializers.CharField(max_length=100, allow_blank=True, allow_null=True, required=False)
    level = serializers.CharField(max_length=100, allow_blank=True, allow_null=True, required=False)
    program = serializers.CharField(max_length=100, allow_blank=True, allow_null=True, required=False)
    season = serializers.CharField(max_length=20, allow_blank=True, allow_null=True, required=False)


class CoachingCardBulkCreateSerializer(serializers.Serializer):
    request_id = serializers.UUIDField()
    source_issue_id = serializers.UUIDField(required=False)
    source_media = CoachingCardMediaSourceSerializer(required=False)
    player_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=False,
        max_length=50,
    )
    title = serializers.CharField(max_length=255, trim_whitespace=True)
    feedback = serializers.CharField(max_length=5000, allow_blank=True, required=False, default="")
    card_type = serializers.ChoiceField(
        choices=(
            "Correction",
            "Positive Reinforcement",
            "Opponent Scout",
            "S&C Connection",
            "Multi-Week Development",
        )
    )
    priority = serializers.ChoiceField(choices=("Game Plan Critical", "Standard", "Developmental"))
    sport_label = serializers.CharField(max_length=100, allow_blank=True, required=False, default="")
    context = CoachingCardContextSerializer(required=False)
    playlists = CoachingCardPlaylistSerializer(many=True, allow_empty=False, max_length=25, required=False)

    def validate(self, attrs):
        if bool(attrs.get("source_issue_id")) == bool(attrs.get("source_media")):
            raise serializers.ValidationError("Provide exactly one source event or uploaded video.")
        if attrs.get("source_media") and "playlists" in attrs:
            raise serializers.ValidationError({"playlists": "Uploaded video clips are resolved from saved media."})
        if attrs.get("source_issue_id") and not attrs.get("playlists"):
            raise serializers.ValidationError({"playlists": "At least one playlist is required."})
        return attrs

    def validate_player_ids(self, player_ids):
        if len(player_ids) != len(set(player_ids)):
            raise serializers.ValidationError("Each player can only receive one card per request.")
        return player_ids


def _resolve_media_source(project, slug, source):
    package_id, artifact_id = source["package_id"], source["artifact_id"]
    path = manifest_path(str(project.id), package_id)
    if not path.exists():
        raise NotFound("The uploaded video is unavailable in this program.")
    manifest = read_manifest(path)
    artifacts = manifest.get("artifacts") or []
    artifact = next((item for item in artifacts if isinstance(item, dict) and item.get("name") == artifact_id), None)
    if artifact is None:
        raise NotFound("The uploaded video is unavailable in this program.")
    metadata = resolve_artifact_metadata(artifact, manifest.get("metadata"))
    thumbnail = next(
        (
            item
            for item in artifacts
            if isinstance(item, dict)
            and item.get("link") == artifact_id
            and (item.get("format") == "thumbnail" or item.get("action") == "preview")
        ),
        None,
    )
    thumbnail_url = None
    if thumbnail and isinstance(thumbnail.get("name"), str):
        thumbnail_url = (
            f"/api/workspaces/{quote(slug, safe='')}/projects/{project.id}/media-library/"
            f"packages/{quote(package_id, safe='')}/artifacts/{quote(thumbnail['name'], safe='')}/file/"
        )
    try:
        resolved = build_uploaded_video_card_source(artifact, metadata, package_id, thumbnail_url)
    except ValueError as error:
        raise serializers.ValidationError({"source_media": str(error)}) from error
    linked_id = artifact.get("work_item_id") or metadata.get("work_item_id") or metadata.get("workItemId")
    try:
        linked_id = UUID(str(linked_id)) if linked_id else None
    except (ValueError, TypeError, AttributeError):
        linked_id = None
    resolved["source_issue"] = Issue.issue_objects.filter(project=project, pk=linked_id).first() if linked_id else None
    return resolved


def _get_or_create_new_state(project):
    state = State.objects.filter(project=project, name__iexact="New").first()
    if state:
        return state

    first_sequence = (
        State.objects.filter(project=project, is_triage=False).aggregate(first=Min("sequence"))["first"] or 15000
    )
    state = State.objects.create(
        project=project,
        name="New",
        color="#60646C",
        group="backlog",
        default=False,
    )
    state.sequence = first_sequence - 15000
    State.objects.filter(pk=state.pk).update(sequence=state.sequence)
    return state


def _card_response(card):
    return {
        "id": card.id,
        "name": card.name,
        "sequence_id": card.sequence_id,
        "project_id": card.project_id,
        "state_id": card.state_id,
        "parent_id": card.parent_id,
        "category": card.category,
        "roster_player_id": card.roster_player_id,
        "coaching_card_data": card.coaching_card_data,
    }


class CoachingCardBulkCreateEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    @transaction.atomic
    def post(self, request, slug, project_id):
        serializer = CoachingCardBulkCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        project = Project.objects.select_for_update().get(pk=project_id, workspace__slug=slug)
        request_id = str(payload["request_id"])
        existing_cards = list(
            Issue.issue_objects.filter(
                project=project,
                category=COACHING_CARD_CATEGORY,
                coaching_card_data__request_id=request_id,
            ).order_by("sequence_id")
        )
        if existing_cards:
            return Response(
                {
                    "created_count": 0,
                    "idempotent_replay": True,
                    "cards": [_card_response(card) for card in existing_cards],
                },
                status=status.HTTP_200_OK,
            )

        media_source = (
            _resolve_media_source(project, slug, payload["source_media"]) if payload.get("source_media") else None
        )
        source_issue = (
            media_source["source_issue"]
            if media_source
            else Issue.issue_objects.filter(project=project, pk=payload["source_issue_id"]).first()
        )
        if not media_source and source_issue is None:
            return Response(
                {"source_issue_id": ["The source event does not exist in this program."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        source_context = media_source["context"] if media_source else {}
        selected_context = payload.get("context") or {}

        level = choose_card_context_value(
            "level", source_context, selected_context, getattr(source_issue, "level", None)
        )
        program = choose_card_context_value(
            "program", source_context, selected_context, getattr(source_issue, "program", None) or project.name
        )
        season = choose_card_context_value(
            "season", source_context, selected_context, getattr(source_issue, "year", None)
        )

        players_by_id = {
            player.id: player for player in RosterPlayer.objects.filter(project=project, id__in=payload["player_ids"])
        }
        missing_player_ids = [player_id for player_id in payload["player_ids"] if player_id not in players_by_id]
        if missing_player_ids:
            return Response(
                {"player_ids": ["One or more selected players do not belong to this program."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        state = _get_or_create_new_state(project)
        playlists = media_source["playlists"] if media_source else payload["playlists"]
        first_clip = playlists[0]["clips"][0]
        clip_count = sum(len(playlist["clips"]) for playlist in playlists)
        feedback = payload["feedback"].strip()
        description_html = f"<p>{escape(feedback)}</p>" if feedback else "<p></p>"
        created_at = timezone.now().isoformat()
        sport = choose_card_context_value(
            "sport",
            source_context,
            selected_context,
            ("" if media_source else payload["sport_label"]) or project.sport or getattr(source_issue, "sport", None),
        )
        cards = []

        for player_id in payload["player_ids"]:
            player = players_by_id[player_id]
            player_snapshot = {
                "id": str(player.id),
                "name": player.player_name,
                "jersey_number": player.jersey_number or "",
                "position": player.position or "",
            }
            card_data = {
                "schema_version": 3 if media_source else 2,
                "kind": COACHING_CARD_KIND,
                "request_id": request_id,
                "title": payload["title"],
                "source_issue": {
                    "id": str(source_issue.id),
                    "name": source_issue.name,
                    "sequence_id": source_issue.sequence_id,
                    "sg_event_id": source_issue.sg_event_id,
                }
                if source_issue
                else None,
                **({"source_media": media_source["source_media"]} if media_source else {}),
                "player": player_snapshot,
                "sport": sport,
                "feedback": feedback,
                "card_type": payload["card_type"],
                "priority": payload["priority"],
                "playlists": playlists,
                "metadata": {
                    "serial_number": f"CC-{uuid4()}",
                    "sport": sport,
                    "season": season or "",
                    "program": program,
                    "level": level or "",
                    **(
                        {
                            "category": media_source["source_media"]["metadata"]["category"],
                            "location": media_source["source_media"]["metadata"]["location"],
                            "tags": media_source["source_media"]["metadata"]["tags"],
                            "start_date": media_source["source_media"]["metadata"]["start_date"],
                            "start_time": media_source["source_media"]["metadata"]["start_time"],
                            "uploaded_by": media_source["source_media"]["metadata"]["created_by"],
                        }
                        if media_source
                        else {}
                    ),
                    "created_at": created_at,
                    "author": {
                        "id": str(request.user.id),
                        "name": request.user.display_name or request.user.email,
                        "email": request.user.email or "",
                    },
                    "project": {
                        "id": str(project.id),
                        "name": project.name,
                        "identifier": project.identifier,
                    },
                },
                "summary": {
                    "playlist_count": len(playlists),
                    "clip_count": clip_count,
                    "primary_thumbnail": first_clip.get("thumbnail"),
                    "primary_clip_title": first_clip["title"],
                },
            }
            cards.append(
                Issue.objects.create(
                    project=project,
                    parent=source_issue,
                    state=state,
                    name=payload["title"],
                    description_html=description_html,
                    sport=sport,
                    level=level,
                    program=program,
                    year=season,
                    category=COACHING_CARD_CATEGORY,
                    roster_player=player,
                    coaching_card_data=card_data,
                )
            )

        return Response(
            {
                "created_count": len(cards),
                "idempotent_replay": False,
                "cards": [_card_response(card) for card in cards],
            },
            status=status.HTTP_201_CREATED,
        )
