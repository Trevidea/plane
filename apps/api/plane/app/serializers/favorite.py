from django.db.models import Q
from rest_framework import serializers

from plane.db.models import UserFavorite, Cycle, Module, Issue, IssueView, Page, Project


class ProjectFavoriteLiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ["id", "name", "logo_props"]


class PageFavoriteLiteSerializer(serializers.ModelSerializer):
    project_id = serializers.SerializerMethodField()

    class Meta:
        model = Page
        fields = ["id", "name", "logo_props", "project_id"]

    def get_project_id(self, obj):
        project = obj.projects.first()  # This gets the first project related to the Page
        return project.id if project else None


class CycleFavoriteLiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cycle
        fields = ["id", "name", "logo_props", "project_id"]


class ModuleFavoriteLiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Module
        fields = ["id", "name", "logo_props", "project_id"]


class ViewFavoriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = IssueView
        fields = ["id", "name", "logo_props", "project_id"]


def get_entity_model_and_serializer(entity_type):
    entity_map = {
        "cycle": (Cycle, CycleFavoriteLiteSerializer),
        "issue": (Issue, None),
        "module": (Module, ModuleFavoriteLiteSerializer),
        "view": (IssueView, ViewFavoriteSerializer),
        "page": (Page, PageFavoriteLiteSerializer),
        "project": (Project, ProjectFavoriteLiteSerializer),
        "folder": (None, None),
    }
    return entity_map.get(entity_type, (None, None))


class UserFavoriteSerializer(serializers.ModelSerializer):
    entity_data = serializers.SerializerMethodField()

    class Meta:
        model = UserFavorite
        fields = [
            "id",
            "entity_type",
            "entity_identifier",
            "entity_data",
            "name",
            "is_folder",
            "sequence",
            "parent",
            "workspace_id",
            "project_id",
        ]
        read_only_fields = ["workspace", "created_by", "updated_by"]

    def get_entity_data(self, obj):
        entity_type = obj.entity_type
        entity_identifier = obj.entity_identifier

        entity_model, entity_serializer = get_entity_model_and_serializer(entity_type)
        if entity_model and entity_serializer:
            try:
                entities = entity_model.objects.filter(pk=entity_identifier)
                if "readonly_project_ids" in self.context:
                    project_ids = self.context["readonly_project_ids"]
                    if entity_type == "project":
                        entities = entities.filter(pk__in=project_ids)
                    elif entity_type == "page":
                        entities = entities.filter(projects__id__in=project_ids).filter(
                            Q(access=0) | Q(owned_by=self.context["readonly_user"])
                        )
                    else:
                        entities = entities.filter(project_id__in=project_ids)
                        if entity_type == "view":
                            entities = entities.filter(Q(access=1) | Q(owned_by=self.context["readonly_user"]))
                entity = entities.get()
                return entity_serializer(entity).data
            except entity_model.DoesNotExist:
                return None
        return None
