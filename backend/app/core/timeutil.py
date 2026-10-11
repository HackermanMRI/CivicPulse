"""Time helpers. All timestamps are stored in UTC; every "day" in the rules is the Asia/Dhaka date."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

DHAKA = ZoneInfo("Asia/Dhaka")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def dhaka_date(dt: datetime | None = None) -> date:
    return (dt or now_utc()).astimezone(DHAKA).date()


def dhaka_day_bounds(day: date) -> tuple[datetime, datetime]:
    """UTC start and end of an Asia/Dhaka calendar day."""
    start = datetime(day.year, day.month, day.day, tzinfo=DHAKA)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)
