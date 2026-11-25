from unittest.mock import patch
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from plane.db.models import FileAsset, User, Workspace, WorkspaceMember


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class PlayerAvatarTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(email="photo@fixture.test", username="photo")
        self.other = User.objects.create(email="photo-other@fixture.test", username="photo-other")
        self.workspace = Workspace.objects.create(name="Photo", slug="photo-school", owner=self.other)
        WorkspaceMember.objects.create(workspace=self.workspace, member=self.user, role=1)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = "/api/assets/v2/user-assets/"
        storage = self.enterContext(patch("plane.app.views.asset.v2.S3Storage"))
        storage.return_value.generate_presigned_post.return_value = {"url":"https://storage.fixture.test/bucket", "fields":{"key":"photo.jpg"}}
        self.enterContext(patch("plane.app.views.asset.v2.invalidate_cache_directly"))
        self.enterContext(patch("plane.app.views.asset.v2.get_asset_object_metadata.delay"))

    def test_player_can_upload_own_avatar_without_program_membership(self):
        response = self.client.post(self.url, {"name":"photo.jpg","type":"image/jpeg","size":100,"entity_type":"USER_AVATAR"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        asset = FileAsset.objects.get(pk=response.data["asset_id"])
        self.assertEqual(asset.user_id, self.user.pk)
        response = self.client.patch(f"{self.url}{asset.pk}/", {}, format="json")
        self.assertEqual(response.status_code, 204, response.data)
        self.user.refresh_from_db()
        self.assertEqual(self.user.avatar_asset_id, asset.pk)

    def test_new_account_can_add_photo_before_any_workspace_approval(self):
        WorkspaceMember.objects.filter(member=self.user).delete()
        self.test_player_can_upload_own_avatar_without_program_membership()

    def test_player_cannot_finalize_another_users_asset(self):
        asset = FileAsset.objects.create(user=self.other, entity_type="USER_AVATAR", asset="other.jpg")
        response = self.client.patch(f"{self.url}{asset.pk}/", {}, format="json")
        self.assertEqual(response.status_code, 404)
        self.other.refresh_from_db()
        self.assertIsNone(self.other.avatar_asset_id)

    def test_self_avatar_endpoint_cannot_finalize_workspace_assets(self):
        asset = FileAsset.objects.create(user=self.user, entity_type="WORKSPACE_LOGO", asset="logo.jpg")
        self.assertEqual(self.client.patch(f"{self.url}{asset.pk}/", {}, format="json").status_code, 404)
        self.assertEqual(self.client.post(self.url, {"name":"x.jpg","size":100,"type":"image/jpeg","entity_type":"WORKSPACE_LOGO"}, format="json").status_code, 400)
