import re
from datetime import datetime

from django.utils import timezone


def parse_season_year_range(season):
    match = re.fullmatch(r"\s*(\d{4})\s*[-/]\s*(\d{4})\s*", season or "")
    if not match:
        return None
    first, last = map(int, match.groups())
    return (first, last) if first <= last else None


def get_issue_season_date_error(data, instance=None, project_season=None):
    current_start = getattr(instance, "start_date", None)
    current_target = getattr(instance, "target_date", None)
    current_time = getattr(instance, "start_time", None)
    start = data.get("start_date", current_start)
    target = data.get("target_date", current_target)
    # Gateway uses the target date only when a start date has not been set.
    event_date = start or target
    if not event_date:
        return None
    if (
        instance
        and event_date == (current_start or current_target)
        and data.get("start_time", current_time) == current_time
    ):
        return None

    season = instance.year if instance else project_season
    years = parse_season_year_range(season)
    if years and not years[0] <= event_date.year <= years[1]:
        field = "start_date" if start else "target_date"
        return {field: f"Event date must be within the {years[0]}-{years[1]} season."}
    return None


def get_issue_start_datetime(start_date, start_time):
    if start_date is None or start_time is None:
        return None

    current_timezone = timezone.get_current_timezone()
    localized_start_time = (
        timezone.localtime(start_time, current_timezone)
        if timezone.is_aware(start_time)
        else timezone.make_aware(start_time, current_timezone)
    )
    start_datetime = timezone.make_aware(
        datetime.combine(start_date, datetime.min.time()),
        current_timezone,
    )

    return start_datetime.replace(
        hour=localized_start_time.hour,
        minute=localized_start_time.minute,
        second=localized_start_time.second,
        microsecond=localized_start_time.microsecond,
    )


def is_issue_start_datetime_in_past(start_date, start_time):
    start_datetime = get_issue_start_datetime(start_date, start_time)
    if start_datetime is None:
        return False

    return start_datetime < timezone.now()
