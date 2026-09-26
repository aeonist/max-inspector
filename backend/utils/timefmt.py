from datetime import datetime, timedelta, timezone

# Moscow time (Kazan uses it too), no DST since 2014
MSK = timezone(timedelta(hours=3), "MSK")


# Format naive UTC datetime from DB as local HH:MM
def format_local_time(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).astimezone(MSK).strftime("%H:%M")
