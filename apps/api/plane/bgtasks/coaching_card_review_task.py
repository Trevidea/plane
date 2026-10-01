from celery import shared_task
from django.db import transaction
from django.utils import timezone

from plane.db.models import Issue
from plane.utils.coaching_card import COACHING_CARD_CATEGORY
from plane.utils.coaching_card_lifecycle import advance_card_after_review


@shared_task
def advance_expired_coaching_card_reviews():
    due_ids = Issue.issue_objects.filter(
        category=COACHING_CARD_CATEGORY,
        coaching_card_data__schema_version=3,
        coaching_card_data__review__deadline_at__lte=timezone.now().isoformat(),
        coaching_card_data__review__completed_at__isnull=True,
    ).values_list("id", flat=True)
    for card_id in due_ids.iterator(chunk_size=200):
        with transaction.atomic():
            card = (
                Issue.issue_objects.select_for_update(of=("self",))
                .select_related("project")
                .filter(pk=card_id, archived_at__isnull=True)
                .first()
            )
            if card:
                advance_card_after_review(card, timezone.now())
