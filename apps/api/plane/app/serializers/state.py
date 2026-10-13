# Module imports
from .base import BaseSerializer
from rest_framework import serializers

from plane.db.models import State


class StateSerializer(BaseSerializer):
    order = serializers.FloatField(required=False)

    def validate(self, data):
        role = getattr(self.instance, "lifecycle_role", "")
        required_group = {"verified": "completed", "closed": "cancelled"}.get(role)
        if required_group and "group" in data and data["group"] != required_group:
            raise serializers.ValidationError({"group": "This lifecycle state must retain its terminal group."})
        return data

    class Meta:
        model = State
        fields = [
            "id",
            "project_id",
            "workspace_id",
            "name",
            "lifecycle_role",
            "color",
            "group",
            "default",
            "description",
            "sequence",
            "order",
        ]
        read_only_fields = ["workspace", "project", "lifecycle_role"]


class StateLiteSerializer(BaseSerializer):
    class Meta:
        model = State
        fields = ["id", "name", "color", "group", "lifecycle_role"]
        read_only_fields = fields
