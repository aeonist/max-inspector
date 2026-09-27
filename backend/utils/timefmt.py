from datetime import datetime, timedelta, timezone

# Moscow time (Kazan uses it too), no DST since 2014
MSK = timezone(timedelta(hours=3), "MSK")


def to_local(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc).astimezone(MSK)


# Format naive UTC datetime from DB as local HH:MM
def format_local_time(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return to_local(dt).strftime("%H:%M")


# Format naive UTC datetime from DB as local DD.MM.YYYY HH:MM
def format_local_datetime(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return to_local(dt).strftime("%d.%m.%Y %H:%M")


# Naive UTC "now", the format stored in the database
def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
